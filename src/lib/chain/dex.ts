import "server-only";
import { parseAbi, type Address } from "viem";
import { clients, pool, type ChainKey } from "./clients";

const factoryAbi = parseAbi([
  "function allPairsLength() view returns (uint256)",
  "function allPairs(uint256) view returns (address)",
]);
const pairAbi = parseAbi([
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
  "function totalSupply() view returns (uint256)",
]);
const erc20 = parseAbi([
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
]);

export interface TokenMeta { address: Address; symbol: string; decimals: number }
export interface RawPool { chain: ChainKey; pair: Address; t0: TokenMeta; t1: TokenMeta; r0: number; r1: number }

const metaCache = new Map<string, TokenMeta>();
async function tokenMeta(chain: ChainKey, a: Address, blockNumber: bigint): Promise<TokenMeta> {
  const k = `${chain}:${a.toLowerCase()}`;
  const hit = metaCache.get(k);
  if (hit) return hit;
  const c = clients[chain];
  const [symbol, decimals] = await Promise.all([
    c.readContract({ address: a, abi: erc20, functionName: "symbol", blockNumber }).catch(() => "?"),
    c.readContract({ address: a, abi: erc20, functionName: "decimals", blockNumber }),
  ]);
  const m = { address: a, symbol: String(symbol), decimals: Number(decimals) };
  metaCache.set(k, m);
  return m;
}

/** Read every pair of a Uniswap V2 style factory at one block. */
export async function readUniV2(chain: ChainKey, factory: Address) {
  const c = clients[chain];
  const block = await c.getBlock();
  const at = { blockNumber: block.number };
  const n = Number(await c.readContract({ address: factory, abi: factoryAbi, functionName: "allPairsLength", ...at }));
  const idx = Array.from({ length: n }, (_, i) => BigInt(i));
  const pairs = await pool(idx, 8, (i) => c.readContract({ address: factory, abi: factoryAbi, functionName: "allPairs", args: [i], ...at }));
  const pools = await pool(pairs.filter(Boolean) as Address[], 6, async (pair) => {
    const [a0, a1, res] = await Promise.all([
      c.readContract({ address: pair, abi: pairAbi, functionName: "token0", ...at }),
      c.readContract({ address: pair, abi: pairAbi, functionName: "token1", ...at }),
      c.readContract({ address: pair, abi: pairAbi, functionName: "getReserves", ...at }),
    ]);
    const [t0, t1] = await Promise.all([tokenMeta(chain, a0, block.number), tokenMeta(chain, a1, block.number)]);
    const p: RawPool = { chain, pair, t0, t1, r0: Number(res[0]) / 10 ** t0.decimals, r1: Number(res[1]) / 10 ** t1.decimals };
    return p;
  });
  return { chain, block: Number(block.number), timestamp: Number(block.timestamp), pairCount: n, pools: pools.filter((p): p is RawPool => p !== null) };
}

/** Token balances held by one contract (single-contract AMMs such as KasDex). */
export async function readBalances(chain: ChainKey, holder: Address, tokens: Address[]) {
  const c = clients[chain];
  const block = await c.getBlock();
  const at = { blockNumber: block.number };
  const rows = await pool(tokens, 4, async (t) => {
    const meta = await tokenMeta(chain, t, block.number);
    const bal = await c.readContract({ address: t, abi: erc20, functionName: "balanceOf", args: [holder], ...at });
    return { token: meta, amount: Number(bal) / 10 ** meta.decimals };
  });
  return { chain, block: Number(block.number), timestamp: Number(block.timestamp), balances: rows.filter((r): r is NonNullable<typeof r> => r !== null) };
}

/* ---------- pricing ---------- */
const KAS_SYMBOLS = /^(w?i?kas|wikas|ikas|wkas)$/i;
const STABLES = /^(usdc|usdt|usdt0|usdc\.e|dai|usd₮)$/i;

export type PriceBook = Map<string, number>; // lowercased symbol → USD

/**
 * Price every token in the pool set. Anchors: KAS wrappers at the KAS market price,
 * stablecoins and majors from the external book. Other tokens take their price from
 * the deepest pool that pairs them with an anchored token.
 */
export function pricePools(pools: RawPool[], kasUsd: number, book: PriceBook) {
  const px = new Map<string, number>(); // chain:address → usd
  const key = (p: RawPool, t: TokenMeta) => `${p.chain}:${t.address.toLowerCase()}`;
  const anchor = (t: TokenMeta) => {
    if (KAS_SYMBOLS.test(t.symbol)) return kasUsd;
    if (STABLES.test(t.symbol)) return book.get(t.symbol.toLowerCase()) ?? 1;
    return book.get(t.symbol.toLowerCase());
  };
  for (const p of pools) for (const t of [p.t0, p.t1]) { const a = anchor(t); if (a != null) px.set(key(p, t), a); }
  // two passes of derivation through the deepest anchored pair
  for (let pass = 0; pass < 2; pass++) {
    const best = new Map<string, { depth: number; price: number }>();
    for (const p of pools) {
      const k0 = key(p, p.t0), k1 = key(p, p.t1);
      const p0 = px.get(k0), p1 = px.get(k1);
      if (p0 != null && p1 == null && p.r1 > 0) { const depth = p.r0 * p0; const cand = (p.r0 * p0) / p.r1; if ((best.get(k1)?.depth ?? 0) < depth) best.set(k1, { depth, price: cand }); }
      if (p1 != null && p0 == null && p.r0 > 0) { const depth = p.r1 * p1; const cand = (p.r1 * p1) / p.r0; if ((best.get(k0)?.depth ?? 0) < depth) best.set(k0, { depth, price: cand }); }
    }
    // ignore prices derived from dust pools (< $500 on the anchored side)
    best.forEach((v, k) => { if (v.depth >= 500) px.set(k, v.price); });
  }
  return pools.map((p) => {
    const p0 = px.get(key(p, p.t0)), p1 = px.get(key(p, p.t1));
    // value a pool by its priced side ×2, preferring the anchor-priced side
    let usd = 0;
    if (p0 != null && p1 != null) usd = Math.min(p.r0 * p0, p.r1 * p1) * 2;
    else if (p0 != null) usd = p.r0 * p0 * 2;
    else if (p1 != null) usd = p.r1 * p1 * 2;
    return { ...p, p0: p0 ?? null, p1: p1 ?? null, usd };
  });
}
export type PricedPool = ReturnType<typeof pricePools>[number];
