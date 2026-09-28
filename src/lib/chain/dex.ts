import "server-only";
import { parseAbi, parseAbiItem, type Address } from "viem";
import { clients, pool, type ChainKey } from "./clients";

const factoryAbi = parseAbi([
  "function allPairsLength() view returns (uint256)",
  "function allPairs(uint256) view returns (address)",
  "function feeTo() view returns (address)",
]);
const slot0Abi = parseAbi(["function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)"]);
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
/** lpShare: part of the trading fee that stays with liquidity providers, read on-chain (V2 feeTo switch, V3 slot0.feeProtocol). */
export interface RawPool { chain: ChainKey; kind: "v2" | "v3"; pair: Address; t0: TokenMeta; t1: TokenMeta; r0: number; r1: number; fee?: number; lpShare?: number | null }

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
  // UniswapV2 protocol fee switch: when feeTo is set, 1/6 of fee growth is minted to it
  const feeTo = await c.readContract({ address: factory, abi: factoryAbi, functionName: "feeTo", ...at }).catch(() => null);
  const lpShare = feeTo == null ? null : /^0x0{40}$/i.test(feeTo) ? 1 : 5 / 6;
  const idx = Array.from({ length: n }, (_, i) => BigInt(i));
  const pairs = await pool(idx, 8, (i) => c.readContract({ address: factory, abi: factoryAbi, functionName: "allPairs", args: [i], ...at }));
  const pools = await pool(pairs.filter(Boolean) as Address[], 6, async (pair) => {
    const [a0, a1, res] = await Promise.all([
      c.readContract({ address: pair, abi: pairAbi, functionName: "token0", ...at }),
      c.readContract({ address: pair, abi: pairAbi, functionName: "token1", ...at }),
      c.readContract({ address: pair, abi: pairAbi, functionName: "getReserves", ...at }),
    ]);
    const [t0, t1] = await Promise.all([tokenMeta(chain, a0, block.number), tokenMeta(chain, a1, block.number)]);
    const p: RawPool = { chain, kind: "v2", pair, t0, t1, r0: Number(res[0]) / 10 ** t0.decimals, r1: Number(res[1]) / 10 ** t1.decimals, lpShare };
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


const poolCreated = parseAbiItem("event PoolCreated(address indexed token0, address indexed token1, uint24 indexed fee, int24 tickSpacing, address pool)");
const bondingAbi = parseAbi(["function getAllBondingCurves() view returns (address[])"]);

/** Read every pool of a Uniswap V3 style factory: pools from PoolCreated logs, value from token balances. */
export async function readUniV3(chain: ChainKey, factory: Address) {
  const c = clients[chain];
  const block = await c.getBlock();
  const logs = await c.getLogs({ address: factory, event: poolCreated, fromBlock: BigInt(0), toBlock: block.number });
  const at = { blockNumber: block.number };
  const pools = await pool(logs, 6, async (l) => {
    const { token0, token1, fee, pool: addr } = l.args as { token0: Address; token1: Address; fee: number; pool: Address };
    const [t0, t1] = await Promise.all([tokenMeta(chain, token0, block.number), tokenMeta(chain, token1, block.number)]);
    const [b0, b1, s0] = await Promise.all([
      c.readContract({ address: token0, abi: erc20, functionName: "balanceOf", args: [addr], ...at }),
      c.readContract({ address: token1, abi: erc20, functionName: "balanceOf", args: [addr], ...at }),
      c.readContract({ address: addr, abi: slot0Abi, functionName: "slot0", ...at }).catch(() => null),
    ]);
    // feeProtocol packs two 4-bit denominators: the protocol takes 1/n of fees (0 = off)
    const fp = s0 ? Number(s0[5]) : null;
    const den = fp == null ? null : Math.max(fp % 16, fp >> 4);
    const lpShare = fp == null ? null : den ? 1 - 1 / den : 1;
    const p: RawPool = { chain, kind: "v3", pair: addr, t0, t1, r0: Number(b0) / 10 ** t0.decimals, r1: Number(b1) / 10 ** t1.decimals, fee: Number(fee), lpShare };
    return p;
  });
  return { chain, block: Number(block.number), timestamp: Number(block.timestamp), pairCount: logs.length, pools: pools.filter((p): p is RawPool => p !== null) };
}

/** Native KAS held by a bonding-curve factory and every curve it created (launchpads). */
export async function readBondingNative(chain: ChainKey, factory: Address) {
  const c = clients[chain];
  const block = await c.getBlock();
  const at = { blockNumber: block.number };
  const curves = await c.readContract({ address: factory, abi: bondingAbi, functionName: "getAllBondingCurves", ...at });
  const owners = [factory, ...curves];
  const bals = await pool(owners, 8, (o) => c.getBalance({ address: o, ...at }));
  const kas = bals.reduce<number>((s, b) => s + (b == null ? 0 : Number(b) / 1e18), 0);
  return { chain, block: Number(block.number), timestamp: Number(block.timestamp), curves: curves.length, kas };
}

/* ---------- pricing ---------- */
const KAS_SYMBOLS = /^(w?i?kas|wikas|ikas|wkas)$/i;
const STABLES = /^(usdc|usdt|usdt0|usdc\.e|dai|usd₮)$/i;
const MAJORS = /^(weth|eth|btc|wbtc|cbbtc|wsteth)$/i;

export type PriceBook = Map<string, number>; // lowercased symbol → USD

/**
 * Build a token price map from V2 pools. Anchors: KAS wrappers at the KAS market price,
 * stablecoins and majors from the external book. Other tokens take their price from
 * the deepest V2 pool that pairs them with an already-priced token.
 */
export function buildPriceMap(pools: RawPool[], kasUsd: number, book: PriceBook, poolOnly = false) {
  const px = new Map<string, number>(); // chain:address → usd
  const key = (p: RawPool, t: TokenMeta) => `${p.chain}:${t.address.toLowerCase()}`;
  const anchor = (t: TokenMeta) => {
    if (KAS_SYMBOLS.test(t.symbol)) return kasUsd;
    if (STABLES.test(t.symbol)) return book.get(t.symbol.toLowerCase()) ?? 1;
    // pool-only: ecosystem tokens (NACHO, ZEAL, IGRA, KSKD…) take the price of their own pool on
    // that chain; only majors whose real market is elsewhere keep an external anchor
    if (poolOnly && !MAJORS.test(t.symbol)) return undefined;
    return book.get(t.symbol.toLowerCase());
  };
  for (const p of pools) for (const t of [p.t0, p.t1]) { const a = anchor(t); if (a != null) px.set(key(p, t), a); }
  const v2 = pools.filter((p) => p.kind === "v2");
  for (let pass = 0; pass < 3; pass++) {
    const best = new Map<string, { depth: number; price: number }>();
    for (const p of v2) {
      const k0 = key(p, p.t0), k1 = key(p, p.t1);
      const p0 = px.get(k0), p1 = px.get(k1);
      if (p0 != null && p1 == null && p.r1 > 0) { const depth = p.r0 * p0; if ((best.get(k1)?.depth ?? 0) < depth) best.set(k1, { depth, price: depth / p.r1 }); }
      if (p1 != null && p0 == null && p.r0 > 0) { const depth = p.r1 * p1; if ((best.get(k0)?.depth ?? 0) < depth) best.set(k0, { depth, price: depth / p.r0 }); }
    }
    // ignore prices derived from dust pools (< $500 on the priced side)
    best.forEach((v, k) => { if (v.depth >= 500) px.set(k, v.price); });
  }
  return px;
}

/** Value pools with a price map. V2: 2 × the smaller priced side. V3: sum of priced balances. */
export function valuePools(pools: RawPool[], px: Map<string, number>) {
  const key = (p: RawPool, t: TokenMeta) => `${p.chain}:${t.address.toLowerCase()}`;
  return pools.map((p) => {
    const p0 = px.get(key(p, p.t0)) ?? null, p1 = px.get(key(p, p.t1)) ?? null;
    let usd = 0;
    if (p.kind === "v3") usd = (p0 != null ? p.r0 * p0 : 0) + (p1 != null ? p.r1 * p1 : 0);
    else if (p0 != null && p1 != null) usd = Math.min(p.r0 * p0, p.r1 * p1) * 2;
    else if (p0 != null) usd = p.r0 * p0 * 2;
    else if (p1 != null) usd = p.r1 * p1 * 2;
    return { ...p, p0, p1, usd };
  });
}
export type PricedPool = ReturnType<typeof valuePools>[number];
