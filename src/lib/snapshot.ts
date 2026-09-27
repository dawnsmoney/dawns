import "server-only";
import { unstable_cache } from "next/cache";
import type { Address } from "viem";
import { readKaskad, KASKAD, type KaskadState } from "./chain/kaskad";
import { readUniV2, readBalances, pricePools, type PriceBook, type PricedPool } from "./chain/dex";
import { explorerAddress, explorerBlock, type ChainKey } from "./chain/clients";
import { kaspaProtocols, llamaProtocol, llamaPrices, llamaChange24h, dexSummary, feesSummary, type LlamaProtocol, type LlamaListItem } from "./llama";
import { usd, usdFull, pct } from "./format";
import type { Status, RuleKey, Signal, Provenance, ProtocolView, Snapshot, PoolView, MarketView, Pt } from "./types";

/* ---------- static registry: what dawns reads directly ---------- */
const ZEALOUS_FACTORY = "0x98Bb580A77eE329796a79aBd05c6D2F2b3D5E1bD" as Address;
const KASDEX = "0xEA4c25D1e8111e74F7c1d3C92dA840e78D5e67E7" as Address;
const KASDEX_TOKENS: Address[] = [
  "0xCfEa894a9a6745719D72C5dE2002AbC1e6626551", // WKAS
  "0xA5b8BF902b2844dA17d4506cc827F7F1681735E7", // USDC
  "0x46346F49b4fe8c640c5FCdbed2d6741056FEB959", // USDT
  "0x69790024D44504F05973E127197E6df17e283859", // WETH
];
const FLOOR = 10_000;
const DAY = 86_400;

/* ---------- small helpers ---------- */
const day = (t: number) => Math.floor(t / DAY) * DAY;
const initials = (name: string) => {
  const w = name.replace(/[^A-Za-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  return (w.length > 1 && /^[A-Z]/.test(w[1]) && !/^V\d$/.test(w[1]) ? w[0][0] + w[1][0] : w[0].slice(0, 1)).toUpperCase();
};
const normSym = (s: string) => (/^(w?i?kas|wikas|ikas|wkas)$/i.test(s) ? "KAS" : s.toUpperCase().replace(/^CBBTC$/, "BTC").replace(/^WBTC$/, "BTC"));
const category = (c: string): ProtocolView["kind"] => (/lend/i.test(c) ? "lending" : /dex/i.test(c) ? "dex" : "other");

function dailySeries(pts: { date: number; totalLiquidityUSD: number }[] | undefined): Pt[] {
  if (!pts?.length) return [];
  const m = new Map<number, number>();
  for (const p of pts) m.set(day(p.date), p.totalLiquidityUSD);
  return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([t, v]) => ({ t: t * 1000, v }));
}
function change(series: Pt[], days: number): number | null {
  if (series.length < days + 1) return null;
  const now = series[series.length - 1].v, then = series[series.length - 1 - days].v;
  return then > 0 ? now / then - 1 : null;
}

/** Split a protocol's TVL change into price and quantity effects using DefiLlama token history. */
function tokenFlows(lp: LlamaProtocol) {
  const keys = Object.keys(lp.chainTvls).filter((k) => !k.includes("-") && !["borrowed", "staking", "pool2", "vesting"].includes(k));
  type Day = { amt: Record<string, number>; usd: Record<string, number> };
  const byDay = new Map<number, Day>();
  let latest: { t: number; d: Day } | null = null;
  let prev: { t: number; d: Day } | null = null;
  for (const k of keys) {
    const ct = lp.chainTvls[k];
    const amts = ct.tokens ?? [], usds = ct.tokensInUsd ?? [];
    const usdByDate = new Map(usds.map((u) => [u.date, u.tokens]));
    for (const a of amts) {
      const u = usdByDate.get(a.date);
      if (!u) continue;
      const d = day(a.date);
      const slot = byDay.get(d) ?? { amt: {}, usd: {} };
      for (const [s, v] of Object.entries(a.tokens)) { const key = `${k}:${s}`; slot.amt[key] = v; slot.usd[key] = u[s] ?? 0; }
      byDay.set(d, slot);
    }
  }
  const days = [...byDay.keys()].sort((a, b) => a - b);
  const flows: Pt[] = [];
  for (let i = 1; i < days.length; i++) {
    const a = byDay.get(days[i - 1])!, b = byDay.get(days[i])!;
    let f = 0;
    for (const k of new Set([...Object.keys(a.amt), ...Object.keys(b.amt)])) {
      const amtB = b.amt[k] ?? 0, amtA = a.amt[k] ?? 0;
      const px = amtB ? (b.usd[k] ?? 0) / amtB : amtA ? (a.usd[k] ?? 0) / amtA : 0;
      f += (amtB - amtA) * px;
    }
    flows.push({ t: days[i] * 1000, v: f });
  }
  if (days.length >= 2) { latest = { t: days[days.length - 1], d: byDay.get(days[days.length - 1])! }; prev = { t: days[days.length - 2], d: byDay.get(days[days.length - 2])! }; }
  let priceEffect = 0, qtyEffect = 0;
  if (latest && prev) {
    for (const k of new Set([...Object.keys(prev.d.amt), ...Object.keys(latest.d.amt)])) {
      const a0 = prev.d.amt[k] ?? 0, a1 = latest.d.amt[k] ?? 0;
      const p0 = a0 ? (prev.d.usd[k] ?? 0) / a0 : 0, p1 = a1 ? (latest.d.usd[k] ?? 0) / a1 : p0;
      priceEffect += a0 * (p1 - p0);
      qtyEffect += (a1 - a0) * p1;
    }
  }
  // latest composition
  const comp: Record<string, number> = {};
  if (latest) for (const [k, v] of Object.entries(latest.d.usd)) { const s = normSym(k.split(":")[1]); comp[s] = (comp[s] ?? 0) + v; }
  return { flows: flows.slice(-30), priceEffect, qtyEffect, comp };
}

/* ---------- builders ---------- */
function lendingView(k: KaskadState, book: PriceBook): { markets: MarketView[]; view: NonNullable<ProtocolView["lending"]> } {
  const markets: MarketView[] = k.markets.map((m) => {
    const mkt = book.get(normSym(m.symbol).toLowerCase()) ?? null;
    return {
      symbol: m.symbol, asset: m.asset, price: m.price, marketPrice: mkt,
      oracleDeviation: mkt ? m.price / mkt - 1 : null,
      supplied: m.supplied, borrowed: m.borrowed, cash: m.cash,
      suppliedUsd: m.suppliedUsd, borrowedUsd: m.borrowedUsd, cashUsd: m.cashUsd,
      utilization: m.utilization, supplyApy: m.supplyApy, borrowApr: m.borrowApr,
      ltv: m.ltv, liquidationThreshold: m.liquidationThreshold, frozen: m.frozen, paused: m.paused, borrowingEnabled: m.borrowingEnabled,
      supplyCap: m.supplyCap, borrowCap: m.borrowCap, aToken: m.aToken,
    };
  });
  return {
    markets,
    view: {
      markets,
      suppliedUsd: k.totals.suppliedUsd, borrowedUsd: k.totals.borrowedUsd, cashUsd: k.totals.cashUsd,
      utilization: k.totals.utilization, coverage: k.totals.coverage,
      aclAdmin: k.aclAdmin, aclAdminIsContract: k.aclAdminIsContract, owner: k.owner, ownerIsContract: k.ownerIsContract,
      poolImplementation: k.poolImplementation, oracle: k.oracle, dataProvider: k.dataProvider,
    },
  };
}

function poolViews(pools: PricedPool[], total: number): PoolView[] {
  return pools
    .filter((p) => p.usd > 0)
    .sort((a, b) => b.usd - a.usd)
    .map((p) => ({
      chain: p.chain, pair: p.pair, symbols: [p.t0.symbol, p.t1.symbol] as [string, string], usd: p.usd, share: total ? p.usd / total : 0,
      reserves: [p.r0, p.r1] as [number, number],
      impact10k: p.usd > 0 ? 1e4 / (p.usd / 2 + 1e4) : null,
    }));
}

async function build(): Promise<Snapshot> {
  const errors: string[] = [];
  const t0 = Date.now();
  const safe = async <T,>(label: string, f: () => Promise<T>): Promise<T | null> => {
    try { return await f(); } catch (e) { errors.push(`${label}: ${(e as Error).message?.slice(0, 160)}`); return null; }
  };

  // external market data first (anchors prices for on-chain valuation)
  const [list, coins, kas24] = await Promise.all([
    safe("DefiLlama protocols", kaspaProtocols),
    safe("DefiLlama prices", () => llamaPrices(["coingecko:kaspa", "coingecko:usd-coin", "coingecko:tether", "coingecko:weth", "coingecko:bitcoin", "coingecko:zeal", "coingecko:nacho-the-kat", "coingecko:kaskad", "coingecko:igra"])),
    safe("KAS 24h", () => llamaChange24h("coingecko:kaspa")),
  ]);
  const kasUsd = coins?.["coingecko:kaspa"]?.price ?? null;
  const book: PriceBook = new Map();
  const put = (sym: string, id: string) => { const p = coins?.[id]?.price; if (p != null) book.set(sym, p); };
  put("kas", "coingecko:kaspa"); put("usdc", "coingecko:usd-coin"); put("usdt", "coingecko:tether"); put("weth", "coingecko:weth");
  put("eth", "coingecko:weth"); put("btc", "coingecko:bitcoin"); put("cbbtc", "coingecko:bitcoin"); put("wbtc", "coingecko:bitcoin");
  put("zeal", "coingecko:zeal"); put("nacho", "coingecko:nacho-the-kat"); put("kskd", "coingecko:kaskad"); put("igra", "coingecko:igra");

  // on-chain reads
  const [kaskad, zIgra, zKasplex, kasdex] = await Promise.all([
    safe("Kaskad on-chain", () => readKaskad((sym) => book.get(normSym(sym).toLowerCase()) ?? null)),
    safe("Zealous Igra on-chain", () => readUniV2("igra", ZEALOUS_FACTORY)),
    safe("Zealous Kasplex on-chain", () => readUniV2("kasplex", ZEALOUS_FACTORY)),
    safe("KasDex on-chain", () => readBalances("igra", KASDEX, KASDEX_TOKENS)),
  ]);
  const kasPx = kasUsd ?? (kaskad?.markets.find((m) => /kas/i.test(m.symbol))?.price ?? null);

  // DefiLlama detail for every protocol in the ecosystem (history + composition)
  const items: LlamaListItem[] = (list ?? []).sort((a, b) => b.tvl - a.tvl);
  const details = await Promise.all(items.map((p) => safe(`DefiLlama ${p.slug}`, () => llamaProtocol(p.slug))));
  const volZ = await dexSummary("zealousswap");
  const feesZ = await feesSummary("zealousswap");

  const prov: Record<string, Provenance> = {};
  const signals: Signal[] = [];
  const blocks: Snapshot["blocks"] = {};
  if (kaskad) blocks.igra = { block: kaskad.block, timestamp: kaskad.timestamp };
  else if (zIgra) blocks.igra = { block: zIgra.block, timestamp: zIgra.timestamp };
  if (zKasplex) blocks.kasplex = { block: zKasplex.block, timestamp: zKasplex.timestamp };

  const protocols: ProtocolView[] = items.map((it, i) => {
    const lp = details[i];
    const history = dailySeries(lp?.tvl).slice(-90);
    const tf = lp ? tokenFlows(lp) : { flows: [], priceEffect: 0, qtyEffect: 0, comp: {} };
    const llamaTvl = it.tvl;
    const borrowedLlama = lp?.currentChainTvls?.borrowed ?? null;
    const kind = category(it.category);
    const base: ProtocolView = {
      id: it.slug, name: it.name, letter: initials(it.name), category: it.category, kind,
      chains: it.chains.filter((c) => c === "Igra" || c === "Kasplex"), site: it.url ? it.url.replace(/^https?:\/\//, "").replace(/\/.*$/, "") : null,
      tvl: llamaTvl, llamaTvl, d24: change(history, 1), d7: change(history, 7), history,
      tokens: Object.entries(tf.comp).map(([sym, v]) => ({ sym, usd: v })).sort((a, b) => b.usd - a.usd),
      flows: tf.flows, priceEffect24: tf.priceEffect, qtyEffect24: tf.qtyEffect,
      borrowed: borrowedLlama, source: "defillama", verifiedShare: null,
      status: "info", statusText: "DefiLlama data", flags: [], floor: llamaTvl < FLOOR,
      contracts: [], canVerify: [], cannotVerify: [], asOf: null, audits: lp?.audit_links ?? [],
    };

    /* --- Kaskad: full on-chain read --- */
    if (it.slug === "kaskad" && kaskad) {
      const { view } = lendingView(kaskad, book);
      base.source = "onchain";
      base.tvl = view.cashUsd;
      base.borrowed = view.borrowedUsd;
      base.lending = view;
      base.asOf = { chain: "igra", block: kaskad.block, timestamp: kaskad.timestamp };
      base.tokens = view.markets.map((m) => ({ sym: normSym(m.symbol), usd: m.suppliedUsd })).sort((a, b) => b.usd - a.usd);
      base.verifiedShare = 1;
      const blk = `#${kaskad.block.toLocaleString("en-US")} · Igra`;
      prov[`${it.slug}-sup`] = { label: "Total supplied", value: usdFull(view.suppliedUsd), trail: [["Contract", `Pool data provider ${kaskad.dataProvider}`], ["Block", blk], ["Read", "getReserveData(asset).totalAToken for each market"], ["Price", "Kaskad price oracle getAssetPrice (8-decimal USD)"], ["Calculation", view.markets.map((m) => `${m.symbol} ${usd(m.suppliedUsd)}`).join(" + ")]], note: "This is what Kaskad owes its suppliers.", links: [explorerAddress("igra", kaskad.dataProvider), explorerBlock("igra", kaskad.block)] };
      prov[`${it.slug}-bor`] = { label: "Outstanding borrows", value: usdFull(view.borrowedUsd), trail: [["Contract", `Pool data provider ${kaskad.dataProvider}`], ["Block", blk], ["Read", "totalVariableDebt + totalStableDebt per market"], ["Calculation", view.markets.map((m) => `${m.symbol} ${usd(m.borrowedUsd)}`).join(" + ")]], links: [explorerAddress("igra", kaskad.dataProvider)] };
      prov[`${it.slug}-liq`] = { label: "Available liquidity", value: usdFull(view.cashUsd), trail: [["Contracts", "The aToken contract of each market holds its cash"], ["Block", blk], ["Read", "underlying.balanceOf(aToken) per market"], ["Calculation", view.markets.map((m) => `${m.symbol} ${usd(m.cashUsd)}`).join(" + ")]], note: "What suppliers could withdraw right now, in aggregate. Per-market limits are under Liquidity.", links: [explorerBlock("igra", kaskad.block)] };
      prov[`${it.slug}-util`] = { label: "Utilization", value: pct(view.utilization), trail: [["Calculation", `borrowed ÷ supplied = ${usd(view.borrowedUsd)} ÷ ${usd(view.suppliedUsd)}`], ["Block", blk]] };
      prov[`${it.slug}-cov`] = { label: "Asset coverage", value: pct(view.coverage), trail: [["Assets", `Cash held ${usd(view.cashUsd)} + loans outstanding ${usd(view.borrowedUsd)}`], ["Liabilities", `Supplier claims ${usd(view.suppliedUsd)}`], ["Block", blk], ["Calculation", "assets ÷ liabilities"]], note: "Assumes outstanding loans are repaid or liquidated at oracle prices. Above 100% means accrued protocol reserves sit on top of what suppliers are owed." };
      prov[`${it.slug}-tvl`] = prov[`${it.slug}-liq`];
      base.contracts = [
        { n: "Pool", addr: KASKAD.pool, chain: "igra", up: kaskad.poolImplementation ? `Proxy → ${kaskad.poolImplementation.slice(0, 6)}…${kaskad.poolImplementation.slice(-4)}` : "Not a standard proxy", admin: "PoolAddressesProvider", pause: "Via ACL", t: kaskad.poolImplementation ? "warn" : "good" },
        { n: "PoolAddressesProvider", addr: KASKAD.poolAddressesProvider, chain: "igra", up: "Registry", admin: kaskad.ownerIsContract ? `Owner is a contract` : `Owner is an EOA`, pause: "—", t: kaskad.ownerIsContract ? "good" : "warn" },
        { n: "ACL admin", addr: kaskad.aclAdmin, chain: "igra", up: "—", admin: kaskad.aclAdminIsContract ? "Contract (multisig or timelock)" : "EOA (single key)", pause: "Can grant pause roles", t: kaskad.aclAdminIsContract ? "good" : "warn" },
        { n: "Price oracle", addr: kaskad.oracle, chain: "igra", up: "Per-asset sources", admin: "ACL", pause: "—", t: "info" },
        { n: "Pool data provider", addr: kaskad.dataProvider, chain: "igra", up: "Read-only", admin: "—", pause: "—", t: "good" },
      ];
      base.canVerify = [
        ["Supplier claims per market", "getReserveData().totalAToken", "On-chain"],
        ["Outstanding borrows per market", "variable + stable debt totals", "On-chain"],
        ["Cash held per market", "underlying.balanceOf(aToken)", "On-chain"],
        ["Rates, caps, LTVs, frozen and paused flags", "getReserveConfigurationData, getReserveCaps, getPaused", "On-chain"],
        ["Oracle price vs market price", "getAssetPrice vs DefiLlama coins API", "On-chain + API"],
        ["Who controls upgrades", "EIP-1967 implementation slot, owner and ACL admin code size", "On-chain"],
      ];
      base.cannotVerify = [
        ["KSKD incentive obligations", "Rewards emissions are not yet decoded by dawns"],
        ["iKAS bridge backing", "The Kaspa L1 side of the Igra bridge is not yet indexed"],
        ["Bad debt at the account level", "Needs per-account positions from an indexer"],
      ];

      // signals
      for (const m of view.markets) {
        if (m.utilization >= 0.95) signals.push({ t: "crit", p: it.slug, rule: "util", strong: `Kaskad ${m.symbol} utilization is ${pct(m.utilization)}`, rest: `. ${usd(m.borrowedUsd)} is borrowed against ${usd(m.suppliedUsd)} supplied, so ${usd(m.cashUsd)} can be withdrawn right now. Borrow rate ${pct(m.borrowApr)}.` });
        else if (m.utilization >= 0.8) signals.push({ t: "warn", p: it.slug, rule: "util", strong: `Kaskad ${m.symbol} utilization is ${pct(m.utilization)}`, rest: `. Only ${usd(m.cashUsd)} of ${usd(m.suppliedUsd)} is withdrawable now.` });
        if (m.frozen) signals.push({ t: "warn", p: it.slug, rule: "contract", strong: `Kaskad ${m.symbol} market is frozen`, rest: `. No new supply or borrowing; existing positions can repay and withdraw. It holds ${usd(m.suppliedUsd)} of supply.` });
        if (m.oracleDeviation != null && Math.abs(m.oracleDeviation) >= 0.02) signals.push({ t: "warn", p: it.slug, rule: "contract", strong: `Kaskad's ${m.symbol} oracle is ${pct(Math.abs(m.oracleDeviation))} ${m.oracleDeviation > 0 ? "above" : "below"} market`, rest: ` (oracle $${m.price.toPrecision(4)}, market $${m.marketPrice?.toPrecision(4)}).` });
      }
      if (!kaskad.aclAdminIsContract) signals.push({ t: "warn", p: it.slug, rule: "contract", strong: "Kaskad's ACL admin is a single key", rest: " (an EOA, not a multisig or timelock). It can change roles that control pausing, listings and risk settings." });
      const worst = view.markets.some((m) => m.utilization >= 0.95) ? "crit" : view.markets.some((m) => m.utilization >= 0.8 || m.frozen) ? "warn" : "good";
      base.status = worst as Status;
      base.statusText = worst === "crit" ? "Liquidity crunch" : worst === "warn" ? "Watch" : "Healthy";
      base.flags = view.markets.filter((m) => m.utilization >= 0.8 || m.frozen).map((m) => [m.utilization >= 0.95 ? "crit" : "warn", m.frozen ? `${m.symbol} market frozen` : `${m.symbol} utilization ${pct(m.utilization, 0)}`] as [Status, string]);
      if (!kaskad.aclAdminIsContract) base.flags.push(["warn", "Admin is a single key"]);
    }

    /* --- Zealous: every pair on Igra and Kasplex --- */
    if (it.slug === "zealousswap" && (zIgra || zKasplex) && kasPx) {
      const raw = [...(zIgra?.pools ?? []), ...(zKasplex?.pools ?? [])];
      const priced = pricePools(raw, kasPx, book);
      const total = priced.reduce((s, p) => s + p.usd, 0);
      const pools = poolViews(priced, total);
      base.source = "onchain";
      base.tvl = total;
      base.verifiedShare = total ? pools.filter((p) => p.usd > 0).reduce((s, p) => s + p.usd, 0) / total : null;
      base.asOf = zIgra ? { chain: "igra", block: zIgra.block, timestamp: zIgra.timestamp } : { chain: "kasplex", block: zKasplex!.block, timestamp: zKasplex!.timestamp };
      base.dex = { pools, pairCount: (zIgra?.pairCount ?? 0) + (zKasplex?.pairCount ?? 0), byChain: { igra: priced.filter((p) => p.chain === "igra").reduce((s, p) => s + p.usd, 0), kasplex: priced.filter((p) => p.chain === "kasplex").reduce((s, p) => s + p.usd, 0) }, vol24: volZ.vol24, vol7: volZ.vol7, fees24: feesZ };
      const comp: Record<string, number> = {};
      for (const p of priced) { if (p.p0 != null) comp[normSym(p.t0.symbol)] = (comp[normSym(p.t0.symbol)] ?? 0) + p.usd / 2; if (p.p1 != null) comp[normSym(p.t1.symbol)] = (comp[normSym(p.t1.symbol)] ?? 0) + p.usd / 2; }
      base.tokens = Object.entries(comp).map(([sym, v]) => ({ sym, usd: v })).sort((a, b) => b.usd - a.usd);
      prov[`${it.slug}-tvl`] = { label: "Total liquidity", value: usdFull(total), trail: [["Contract", `Factory ${ZEALOUS_FACTORY} on Igra and Kasplex`], ["Blocks", [zIgra && `Igra #${zIgra.block.toLocaleString("en-US")}`, zKasplex && `Kasplex #${zKasplex.block.toLocaleString("en-US")}`].filter(Boolean).join(" · ")], ["Read", `allPairs() → getReserves() on ${base.dex.pairCount} pairs`], ["Price", `KAS wrappers at the KAS market price ($${kasPx.toPrecision(4)}), stablecoins at $1, other tokens from their deepest KAS or stable pair`], ["Calculation", "Σ pools, each valued at 2 × its priced side"]], note: "Farm and Infinity Pool deposits are not counted as liquidity.", links: [explorerAddress("igra", ZEALOUS_FACTORY), explorerAddress("kasplex", ZEALOUS_FACTORY)] };
      if (volZ.vol24 != null) prov[`${it.slug}-vol`] = { label: "24h volume", value: usdFull(volZ.vol24), trail: [["Source", "DefiLlama DEX volume API"], ["Status", "dawns will read Swap events directly once the indexer runs"]] };
      if (feesZ != null) prov[`${it.slug}-fee`] = { label: "24h fees", value: usdFull(feesZ), trail: [["Source", "DefiLlama fees API"]] };
      base.contracts = [
        { n: "Factory (Igra)", addr: ZEALOUS_FACTORY, chain: "igra", up: "Immutable (UniV2)", admin: "Fee setter", pause: "No", t: "good" },
        { n: "Factory (Kasplex)", addr: ZEALOUS_FACTORY, chain: "kasplex", up: "Immutable (UniV2)", admin: "Fee setter", pause: "No", t: "good" },
      ];
      base.canVerify = [["Reserves of every pair", `getReserves() on ${base.dex.pairCount} pairs, two networks`, "On-chain"], ["Token metadata", "symbol() and decimals() per token", "On-chain"], ["Price impact by trade size", "Constant-product maths on live reserves", "Derived"]];
      base.cannotVerify = [["Swap volume and fees", "Taken from DefiLlama until the indexer reads Swap events"], ["Infinity Pool and farm deposits", "Separate contracts, not yet read"]];
      const top = pools[0];
      base.status = top && top.share > 0.6 ? "warn" : "good";
      base.statusText = base.status === "warn" ? "Concentrated" : "Healthy";
      if (top && top.share > 0.6) base.flags.push(["warn", `${top.symbols.join("/")} holds ${pct(top.share, 0)} of liquidity`]);
    }

    /* --- KasDex: single-contract AMM --- */
    if (it.slug === "kasdex" && kasdex && kasPx) {
      let total = 0;
      const comp: Record<string, number> = {};
      for (const b of kasdex.balances) {
        const s = normSym(b.token.symbol);
        const px = s === "KAS" ? kasPx : book.get(b.token.symbol.toLowerCase()) ?? book.get(s.toLowerCase()) ?? (/usd/i.test(s) ? 1 : 0);
        const v = b.amount * px; total += v; comp[s] = (comp[s] ?? 0) + v;
      }
      base.source = "onchain"; base.tvl = total; base.verifiedShare = 1;
      base.asOf = { chain: "igra", block: kasdex.block, timestamp: kasdex.timestamp };
      base.tokens = Object.entries(comp).map(([sym, v]) => ({ sym, usd: v })).sort((a, b) => b.usd - a.usd);
      base.contracts = [{ n: "KasDex AMM", addr: KASDEX, chain: "igra", up: "Unknown", admin: "Unknown", pause: "Unknown", t: "info" }];
      base.canVerify = [["Token balances held by the AMM", "balanceOf(KasDex) for WKAS, USDC, USDT, WETH", "On-chain"]];
      base.cannotVerify = [["Pool-level split", "Single-contract AMM; per-pool accounting not decoded yet"]];
      prov[`${it.slug}-tvl`] = { label: "Total liquidity", value: usdFull(total), trail: [["Contract", KASDEX], ["Block", `#${kasdex.block.toLocaleString("en-US")} · Igra`], ["Read", "balanceOf(KasDex) for 4 tokens"], ["Calculation", kasdex.balances.map((b) => `${b.amount.toFixed(2)} ${b.token.symbol}`).join(" + ")]], links: [explorerAddress("igra", KASDEX)] };
    }

    if (base.source === "defillama") {
      base.canVerify = [];
      base.cannotVerify = [["Everything on this page", "dawns does not read this protocol's contracts yet. Figures come from DefiLlama."]];
      prov[`${it.slug}-tvl`] = { label: "Total value locked", value: usdFull(llamaTvl), trail: [["Source", `DefiLlama /protocol/${it.slug}`], ["Chains", base.chains.join(", ")], ["Status", "Not yet read on-chain by dawns"]] };
    }
    if (base.floor) { base.status = "info"; base.statusText = "Below monitoring floor"; }

    // cross-check signal
    if (base.source === "onchain" && llamaTvl > 0 && Math.abs(base.tvl / llamaTvl - 1) > 0.15) {
      base.flags.push(["info", `DefiLlama shows ${usd(llamaTvl)}`]);
    }
    // move signals from history
    if (base.d24 != null && Math.abs(base.d24) >= 0.1 && !base.floor) {
      signals.push({ t: base.d24 < 0 ? "warn" : "good", p: it.slug, rule: "tvl", strong: `${it.name} TVL ${base.d24 < 0 ? "fell" : "rose"} ${pct(Math.abs(base.d24))} in 24h`, rest: ` (DefiLlama daily history).` });
    }
    return base;
  });

  /* ---------- ecosystem ---------- */
  const live = protocols.filter((p) => p.kind !== "other" || p.tvl > 0);
  const tvl = live.reduce((s, p) => s + p.tvl, 0);
  const llamaTotal = items.reduce((s, p) => s + p.tvl, 0);
  // stacked history: top 3 by TVL + other
  const allDays = [...new Set(protocols.flatMap((p) => p.history.map((h) => h.t)))].sort((a, b) => a - b).slice(-90);
  const valAt = (p: ProtocolView, t: number) => { let v = 0; for (const h of p.history) { if (h.t <= t) v = h.v; else break; } return v; };
  const topP = [...protocols].sort((a, b) => b.llamaTvl - a.llamaTvl).slice(0, 3);
  const stack = [
    ...topP.map((p) => ({ name: p.name, id: p.id, values: allDays.map((t) => valAt(p, t)) })),
    { name: "Other", id: "other", values: allDays.map((t) => protocols.filter((p) => !topP.includes(p)).reduce((s, p) => s + valAt(p, t), 0)) },
  ];
  const ecoSeries = allDays.map((_, i) => stack.reduce((s, x) => s + x.values[i], 0));
  const comp: Record<string, number> = {};
  for (const p of protocols) for (const tk of p.tokens) comp[tk.sym] = (comp[tk.sym] ?? 0) + tk.usd;
  const lending = protocols.find((p) => p.lending);
  const dexLiq = protocols.filter((p) => p.kind === "dex").reduce((s, p) => s + p.tvl, 0);
  const stable = Object.entries(comp).filter(([s]) => /^USD/.test(s)).reduce((s, [, v]) => s + v, 0);
  const priceEffect = protocols.reduce((s, p) => s + p.priceEffect24, 0);
  const qtyEffect = protocols.reduce((s, p) => s + p.qtyEffect24, 0);

  prov["eco-tvl"] = {
    label: "Total value locked · Kaspa DeFi", value: usdFull(tvl),
    trail: [
      ["On-chain", protocols.filter((p) => p.source === "onchain").map((p) => `${p.name} ${usd(p.tvl)}`).join(" · ") || "none this run"],
      ["DefiLlama", protocols.filter((p) => p.source === "defillama").map((p) => `${p.name} ${usd(p.tvl)}`).join(" · ") || "none"],
      ["Blocks", [blocks.igra && `Igra #${blocks.igra.block.toLocaleString("en-US")}`, blocks.kasplex && `Kasplex #${blocks.kasplex.block.toLocaleString("en-US")}`].filter(Boolean).join(" · ")],
      ["Convention", "Borrowed funds and staking are excluded, as on DefiLlama"],
      ["Cross-check", `DefiLlama total for the same protocols: ${usd(llamaTotal)}`],
    ],
    note: "Protocols dawns reads directly use on-chain numbers. The rest use DefiLlama until dawns maps their contracts.",
  };
  if (lending?.lending) {
    prov["eco-lend"] = prov[`${lending.id}-liq`];
    prov["eco-util"] = prov[`${lending.id}-util`];
  }
  prov["eco-dex"] = { label: "DEX liquidity", value: usdFull(dexLiq), trail: protocols.filter((p) => p.kind === "dex").map((p) => [p.name, `${usd(p.tvl)} · ${p.source === "onchain" ? "on-chain" : "DefiLlama"}`] as [string, string]) };
  prov["eco-stable"] = { label: "Stablecoin liquidity", value: usdFull(stable), trail: [["Scope", "USDC, USDT and other USD tokens across tracked protocols"], ["Calculation", Object.entries(comp).filter(([s]) => /^USD/.test(s)).map(([s, v]) => `${s} ${usd(v)}`).join(" + ")]] };

  if (kasPx && kas24 != null && Math.abs(kas24) >= 0.05) signals.push({ t: "info", p: null, rule: null, strong: `KAS ${kas24 > 0 ? "rose" : "fell"} ${pct(Math.abs(kas24))} in 24h`, rest: ` to $${kasPx.toPrecision(3)}. Most Kaspa DeFi value is KAS, so TVL moves with it.` });

  const order: Record<Status, number> = { crit: 0, warn: 1, info: 2, good: 3 };
  signals.sort((a, b) => order[a.t] - order[b.t]);

  return {
    asOf: Date.now(), buildMs: Date.now() - t0, blocks, kasUsd: kasPx, kas24,
    protocols: protocols.sort((a, b) => b.tvl - a.tvl),
    eco: {
      tvl, llamaTotal, dexLiq, stable, priceEffect, qtyEffect,
      lendingLiq: lending?.tvl ?? 0, lendingUtil: lending?.lending?.utilization ?? null, lendingBorrowed: lending?.lending?.borrowedUsd ?? null,
      series: allDays.map((t, i) => ({ t, v: ecoSeries[i] })),
      stack: stack.map((s) => ({ name: s.name, id: s.id, values: s.values })), dates: allDays,
      composition: Object.entries(comp).map(([sym, v]) => ({ sym, usd: v })).sort((a, b) => b.usd - a.usd),
    },
    signals, prov, errors,
  };
}

export const getSnapshot = unstable_cache(build, ["dawns-snapshot-v1"], { revalidate: 120 });

export type { Snapshot, ProtocolView, Signal, RuleKey };
export const findProtocol = (s: Snapshot, id: string) => s.protocols.find((p) => p.id === id) ?? null;
export type { ChainKey };
