import "server-only";
import { unstable_cache } from "next/cache";
import { getAddress, parseAbi, parseAbiItem, type Address } from "viem";
import { clients, explorerAddress, type ChainKey } from "./clients";
import { KASKAD } from "./kaskad";
import type { Opportunity, ProtocolView } from "../types";
import { plainAppUrl, type ActPlan, type ActToken } from "../act";

/**
 * How to take an opportunity from dawns: which contract the wallet calls, and why dawns
 * trusts that it is the right one. Every contract is found and checked on-chain, never
 * typed from a list: Kaskad's pool is the one its addresses provider names; a DEX router
 * is the contract that minted this pool's recent liquidity and whose factory() is the
 * pool's own factory. Anything dawns cannot check ends in the protocol's app instead.
 */

const papAbi = parseAbi(["function getPool() view returns (address)"]);
const pairAbi = parseAbi(["function factory() view returns (address)", "function token0() view returns (address)", "function token1() view returns (address)"]);
const routerAbi = parseAbi(["function factory() view returns (address)", "function WETH() view returns (address)"]);
const MINT = parseAbiItem("event Mint(address indexed sender, uint256 amount0, uint256 amount1)");

type Router = { router: Address; weth: Address | null; factory: Address; mints: number; blocks: number; others: number } | { error: string };

/** The router of a V2 pair: the contract that minted its liquidity most often, if its factory() is the pair's. */
async function findRouter(chain: ChainKey, pair: Address): Promise<Router> {
  const c = clients[chain];
  const factory = await c.readContract({ address: pair, abi: pairAbi, functionName: "factory" });
  const tip = await c.getBlockNumber();
  const counts = new Map<string, number>();
  let blocks = 0;
  for (const span of [BigInt(50_000), BigInt(500_000), BigInt(5_000_000)]) {
    const from = tip > span ? tip - span : BigInt(0);
    const logs = await c.getLogs({ address: pair, event: MINT, fromBlock: from, toBlock: tip }).catch(() => null);
    if (!logs) continue;
    blocks = Number(tip - from);
    for (const l of logs) if (l.args.sender) counts.set(getAddress(l.args.sender), (counts.get(getAddress(l.args.sender)) ?? 0) + 1);
    if (counts.size) break;
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  for (const [cand, n] of ranked.slice(0, 4)) {
    const code = await c.getCode({ address: cand as Address }).catch(() => undefined);
    if (!code || code === "0x") continue;
    const f = await c.readContract({ address: cand as Address, abi: routerAbi, functionName: "factory" }).catch(() => null);
    if (!f || getAddress(f) !== getAddress(factory)) continue;
    const weth = await c.readContract({ address: cand as Address, abi: routerAbi, functionName: "WETH" }).catch(() => null);
    return { router: cand as Address, weth: weth ? getAddress(weth) : null, factory: getAddress(factory), mints: n, blocks, others: ranked.length - 1 };
  }
  return { error: ranked.length ? "none of the contracts that added liquidity here answers factory() with this pool's factory" : "no liquidity was added to this pool in the blocks dawns could read" };
}
const routerOf = unstable_cache(findRouter, ["dawns-act-router-v1"], { revalidate: 6 * 3600 });

async function kaskadPool(): Promise<Address> {
  return getAddress(await clients.igra.readContract({ address: KASKAD.poolAddressesProvider, abi: papAbi, functionName: "getPool" }));
}
const kaskadPoolOf = unstable_cache(kaskadPool, ["dawns-act-kaskad-v1"], { revalidate: 3600 });

/** The wrapped native token of a chain, as a verified router of that chain reports it. */
async function wrappedOf(chain: ChainKey, protocols: ProtocolView[]): Promise<Address | null> {
  const pools = protocols.flatMap((p) => (p.dex?.pools ?? []).filter((x) => x.chain === chain && x.kind === "v2")).sort((a, b) => b.usd - a.usd).slice(0, 2);
  for (const x of pools) {
    const r = await routerOf(chain, x.pair as Address).catch(() => null);
    if (r && "router" in r && r.weth) return r.weth;
  }
  return null;
}

export async function planFor(o: Opportunity, protocols: ProtocolView[]): Promise<ActPlan> {
  const p = protocols.find((x) => x.id === o.protocol);
  const app = plainAppUrl(p?.site ?? null);
  const base = { oppId: o.id, chain: o.chain, protocol: o.protocol, pname: o.pname, app, name: o.name };

  if (o.farm) return { ...base, mode: "app", why: `Staking in the ${o.pname} farm goes through its farm contract, which is not verified on the explorer: dawns will not build calls to a contract it cannot read. Add liquidity here first if you like, then stake the LP in ${o.pname}'s app.`, trail: [] };

  if (o.kind === "supply") {
    const m = p?.lending?.markets.find((x) => `${o.protocol}:${x.symbol}` === o.id);
    if (!m) return { ...base, mode: "app", why: "This market is not in dawns' latest read.", trail: [] };
    if (m.frozen) return { ...base, mode: "blocked", why: "The market is frozen: the protocol accepts no new deposits.", trail: [] };
    let pool: Address;
    try { pool = await kaskadPoolOf(); } catch { return { ...base, mode: "app", why: "dawns could not read Kaskad's addresses provider just now, so it cannot confirm which pool to call.", trail: [] }; }
    const token: ActToken = { address: getAddress(m.asset), symbol: m.symbol, decimals: m.decimals };
    const weth = await wrappedOf("igra", protocols).catch(() => null);
    return {
      ...base, mode: "supply", pool, tokens: [token], aToken: getAddress(m.aToken),
      wrap: weth && weth === token.address ? weth : null,
      exitNowUsd: o.exitNow, utilization: m.utilization,
      trail: [
        ["Pool", `${pool}: the address Kaskad's PoolAddressesProvider (${KASKAD.poolAddressesProvider}) returns from getPool(), read now`, explorerAddress("igra", pool)],
        ["Receipt", `${m.symbol} supplied mints k${m.symbol} (${m.aToken}) to your address; it grows with interest and is what you withdraw`, explorerAddress("igra", m.aToken)],
        ["Calls", `approve(pool, amount) on ${m.symbol}, then supply(${m.symbol}, amount, you, 0) on the pool. Both are simulated before your wallet is asked.`, null],
      ],
    };
  }

  // liquidity
  const pool = p?.dex?.pools.find((x) => x.pair.toLowerCase() === o.pair?.toLowerCase() && x.chain === o.chain);
  if (!pool) return { ...base, mode: "app", why: "This pool is not in dawns' latest read.", trail: [] };
  if (pool.kind === "v3") return { ...base, mode: "app", why: "A concentrated-liquidity position needs a price range you choose, and earns only while the price stays inside it. Pick the range in the protocol's own app, where you can see it on the chart.", trail: [] };
  const r = await routerOf(o.chain, getAddress(pool.pair)).catch((e: Error) => ({ error: `the chain could not be read (${e.message.slice(0, 80)})` }));
  if ("error" in r) return { ...base, mode: "app", why: `dawns could not confirm this pool's router: ${r.error}. Use the protocol's app.`, trail: [] };
  const c = clients[o.chain];
  const [t0, t1] = await Promise.all([
    c.readContract({ address: getAddress(pool.pair), abi: pairAbi, functionName: "token0" }),
    c.readContract({ address: getAddress(pool.pair), abi: pairAbi, functionName: "token1" }),
  ]).catch(() => [null, null]);
  if (!t0 || !t1) return { ...base, mode: "app", why: "dawns could not read the pool's tokens just now.", trail: [] };
  const tokens: [ActToken, ActToken] = [
    { address: getAddress(t0), symbol: pool.symbols[0], decimals: pool.tk[0].d },
    { address: getAddress(t1), symbol: pool.symbols[1], decimals: pool.tk[1].d },
  ];
  if (tokens[0].address.toLowerCase() !== pool.tk[0].a.toLowerCase()) return { ...base, mode: "app", why: "The pool's token order read now differs from dawns' snapshot; try again in a few minutes.", trail: [] };
  return {
    ...base, mode: "lp", pair: getAddress(pool.pair), router: r.router, weth: r.weth, tokens,
    trail: [
      ["Router", `${r.router}: the contract that added liquidity to this pool ${r.mints} time${r.mints === 1 ? "" : "s"} in the last ${r.blocks.toLocaleString("en-US")} blocks${r.others ? ` (${r.others} other sender${r.others === 1 ? "" : "s"} fewer times)` : ""}; its factory() returns ${r.factory}, the pool's own factory`, explorerAddress(o.chain, r.router)],
      ["Pool", `${pool.pair}: ${tokens[0].symbol} is token0 and ${tokens[1].symbol} token1, read now`, explorerAddress(o.chain, pool.pair)],
      ["Calls", `approve(router, amount) for each token you add, then ${r.weth && tokens.some((t) => t.address === r.weth) ? "addLiquidityETH (the KAS side is sent as native KAS) or " : ""}addLiquidity with minimum amounts at your slippage. Simulated before your wallet is asked.`, null],
    ],
  };
}
