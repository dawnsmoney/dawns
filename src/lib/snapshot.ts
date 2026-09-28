import "server-only";
import { unstable_cache } from "next/cache";
import type { Address } from "viem";
import { readKaskad, KASKAD, type KaskadState } from "./chain/kaskad";
import { readUniV2, readUniV3, readBalances, readBondingNative, buildPriceMap, valuePools, type PriceBook, type PricedPool, type RawPool } from "./chain/dex";
import { readIgraBridge, IGRA_BRIDGE } from "./chain/bridge";
import { readInfinityPools } from "./chain/zealous";
import { readOwn } from "./history";
import { buildOpportunities } from "./opportunities";
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
/** DEXs read pool by pool. Addresses come from each protocol's own app config. */
type DexSource = { chain: ChainKey; kind: "v2" | "v3"; factory: Address };
const DEX_ADAPTERS: Record<string, { sources: DexSource[]; note?: string }> = {
  zealousswap: { sources: [{ chain: "igra", kind: "v2", factory: ZEALOUS_FACTORY }, { chain: "kasplex", kind: "v2", factory: ZEALOUS_FACTORY }], note: "Infinity Pools holding NACHO and KASPER count toward TVL; ZEAL staked in its own Infinity Pools is shown separately as staking, not TVL. Farms hold LP tokens of the pools above, so they are not counted twice." },
  "kaspacom-dex": { sources: [{ chain: "igra", kind: "v2", factory: "0x21350BcDa9E81731CF4cDE3DbC457e3de2739c01" }, { chain: "kasplex", kind: "v2", factory: "0xa9CBa43A407c9Eb30933EA21f7b9D74A128D613c" }] },
  "krokoswap-v3": { sources: [{ chain: "kasplex", kind: "v3", factory: "0x0dfb1Bb755d872EA1fa4d95E4ad0c2E6317Ce9B9" }], note: "Concentrated-liquidity pools are valued at the tokens they hold; positions out of range still count." },
  "krokoswap-v2": { sources: [{ chain: "kasplex", kind: "v2", factory: "0x4373b7Fcf5059A785843cD224129e01d243Aef71" }] },
};
const IGRA_ATTESTATION = "0xc24Df70E408739aeF6bF594fd41db4632dF49188" as Address;
const IGRA_TOKEN = "0x093d77d397f8accbaee0820345e9e700b1233cd1" as Address;
const LFG_FACTORIES: { chain: ChainKey; factory: Address }[] = [
  { chain: "igra", factory: "0x765331F7a008c0609543aCCa6209d91636BceEAC" },
  { chain: "kasplex", factory: "0xb19219AF8a65522f13B51f6401093c8342E27e9D" },
];
const FLOOR = 10_000;
const DAY = 86_400;

/* ---------- small helpers ---------- */
const day = (t: number) => Math.floor(t / DAY) * DAY;
const initials = (name: string) => {
  const w = name.replace(/[^A-Za-z0-9 ]/g, " ").split(/\s+/).filter((x) => x && !/^V\d$/i.test(x));
  const caps = w[0].match(/[A-Z]/g) ?? [];
  if (caps.length >= 2) return caps[0] + caps[1];
  if (w.length > 1) return (w[0][0] + w[1][0]).toUpperCase();
  return (caps.length >= 2 ? caps[0] + caps[1] : w[0][0]).toUpperCase();
};
/** Hand-picked where two names would share initials (KasDex and KaspaCom DEX are both "KD"). */
const LETTERS: Record<string, string> = { kasdex: "KX", "kaspacom-dex": "KC", "kaspacom-lfg": "KL" };
const prettyCategory = (c: string) => ({ Dexs: "DEX", "Staking Pool": "Staking", Lending: "Lending", Launchpad: "Launchpad" } as Record<string, string>)[c] ?? c;
const normSym = (s: string) => (/^(w?i?kas|wikas|ikas|wkas)$/i.test(s) ? "KAS" : s.toUpperCase().replace(/^CBBTC$/, "BTC").replace(/^WBTC$/, "BTC"));
const category = (c: string): ProtocolView["kind"] => (/lend/i.test(c) ? "lending" : /dex/i.test(c) ? "dex" : "other");

function dailySeries(pts: { date: number; totalLiquidityUSD: number }[] | undefined): Pt[] {
  if (!pts?.length) return [];
  const m = new Map<number, number>();
  for (const p of pts) m.set(day(p.date), p.totalLiquidityUSD);
  return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([t, v]) => ({ t: t * 1000, v }));
}
/**
 * DefiLlama history sometimes carries mispriced days (5-10x spikes that revert).
 * Flag any day more than 1.75x above (or below) the median of its 7-day neighbourhood.
 */
function outlierMask(vals: number[]): boolean[] {
  return vals.map((v, i) => {
    const w = vals.slice(Math.max(0, i - 3), i + 4).filter((x) => x > 0).sort((a, b) => a - b);
    if (w.length < 3) return false;
    const med = w[Math.floor(w.length / 2)];
    return med > 0 && (v > med * 1.75 || v < med / 1.75);
  });
}
function cleanSeries(series: Pt[]): { series: Pt[]; removed: number } {
  const mask = outlierMask(series.map((p) => p.v));
  const out: Pt[] = [];
  let removed = 0;
  series.forEach((p, i) => {
    // never drop the latest point; the current value is checked separately
    if (mask[i] && i < series.length - 1) { removed++; const prev = out[out.length - 1]; if (prev) out.push({ t: p.t, v: prev.v }); }
    else out.push(p);
  });
  return { series: out, removed };
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
  const allDays = [...byDay.keys()].sort((a, b) => a - b);
  const totals = allDays.map((d) => Object.values(byDay.get(d)!.usd).reduce((a, b) => a + b, 0));
  const bad = outlierMask(totals);
  // skip mispriced days entirely so they cannot create phantom flows or price moves
  const days = allDays.filter((_, i) => !bad[i] || i === allDays.length - 1);
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
      oracleDeviation: mkt && m.oracleOk ? m.price / mkt - 1 : null, oracleOk: m.oracleOk, oracleError: m.oracleError, oracleUpdatedAt: m.oracleUpdatedAt, oracleMaxAge: m.oracleMaxAge, debtToken: m.debtToken,
      supplied: m.supplied, borrowed: m.borrowed, cash: m.cash,
      suppliedUsd: m.suppliedUsd, borrowedUsd: m.borrowedUsd, cashUsd: m.cashUsd,
      utilization: m.utilization, supplyApy: m.supplyApy, borrowApr: m.borrowApr,
      ltv: m.ltv, liquidationThreshold: m.liquidationThreshold, frozen: m.frozen, paused: m.paused, borrowingEnabled: m.borrowingEnabled,
      supplyCap: m.supplyCap, borrowCap: m.borrowCap, aToken: m.aToken, decimals: m.decimals,
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

function poolViews(pools: PricedPool[], total: number, pp: Map<string, number> = new Map()): PoolView[] {
  const k = (chain: string, a: string) => pp.get(`${chain}:${a.toLowerCase()}`) ?? null;
  return pools
    .filter((p) => p.usd > 0)
    .sort((a, b) => b.usd - a.usd)
    .map((p) => ({
      chain: p.chain, pair: p.pair, symbols: [p.t0.symbol, p.t1.symbol] as [string, string], usd: p.usd, share: total ? p.usd / total : 0,
      reserves: [p.r0, p.r1] as [number, number],
      impact10k: p.kind === "v2" && p.usd > 0 ? 1e4 / (p.usd / 2 + 1e4) : null,
      kind: p.kind, fee: p.fee ?? null, lpShare: p.lpShare ?? null,
      tk: [{ a: p.t0.address, d: p.t0.decimals, px: p.p0, pp: k(p.chain, p.t0.address) }, { a: p.t1.address, d: p.t1.decimals, px: p.p1, pp: k(p.chain, p.t1.address) }] as PoolView["tk"],
    }));
}

/** Build a fresh snapshot, bypassing the cache (cron tick). */
export async function buildSnapshot(): Promise<Snapshot> {
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
  const dexJobs = Object.entries(DEX_ADAPTERS).flatMap(([slug, a]) => a.sources.map((src) => ({ slug, src })));
  const [kaskad, kasdex, attest, lfg, dexReads, bridge, own, infinity] = await Promise.all([
    safe("Kaskad on-chain", () => readKaskad((sym) => book.get(normSym(sym).toLowerCase()) ?? null)),
    safe("KasDex on-chain", () => readBalances("igra", KASDEX, KASDEX_TOKENS)),
    safe("Igra Attestation on-chain", () => readBalances("igra", IGRA_ATTESTATION, [IGRA_TOKEN])),
    Promise.all(LFG_FACTORIES.map((f) => safe(`KaspaCom LFG ${f.chain}`, () => readBondingNative(f.chain, f.factory)))),
    Promise.all(dexJobs.map((j) => safe(`${j.slug} ${j.src.chain} on-chain`, () => (j.src.kind === "v3" ? readUniV3(j.src.chain, j.src.factory) : readUniV2(j.src.chain, j.src.factory))))),
    safe("Igra bridge", () => readIgraBridge()),
    safe("dawns history", readOwn),
    safe("ZealousSwap Infinity Pools", readInfinityPools),
  ]);
  const dexBySlug = new Map<string, { src: DexSource; read: NonNullable<(typeof dexReads)[number]> }[]>();
  dexJobs.forEach((j, i) => { const r = dexReads[i]; if (r) dexBySlug.set(j.slug, [...(dexBySlug.get(j.slug) ?? []), { src: j.src, read: r }]); });
  const zIgra = dexBySlug.get("zealousswap")?.find((x) => x.src.chain === "igra")?.read ?? null;
  const anyKasplex = dexReads.find((r) => r?.chain === "kasplex") ?? null;
  const kasPx = kasUsd ?? (kaskad?.markets.find((m) => /kas/i.test(m.symbol))?.price ?? null);

  // DefiLlama detail for every protocol in the ecosystem (history + composition)
  const items: LlamaListItem[] = (list ?? []).sort((a, b) => b.tvl - a.tvl);
  const details = await Promise.all(items.map((p) => safe(`DefiLlama ${p.slug}`, () => llamaProtocol(p.slug))));
  const dexSlugs = Object.keys(DEX_ADAPTERS);
  const [vols, fees] = await Promise.all([Promise.all(dexSlugs.map(dexSummary)), Promise.all(dexSlugs.map(feesSummary))]);
  const volBy = Object.fromEntries(dexSlugs.map((s, i) => [s, vols[i]]));
  const feeBy = Object.fromEntries(dexSlugs.map((s, i) => [s, fees[i]]));
  // one price map across every V2 pool on both networks, so thin DEXs borrow prices from deep ones
  const allRaw: RawPool[] = dexReads.flatMap((r) => r?.pools ?? []);
  const pxMap = kasPx ? buildPriceMap(allRaw, kasPx, book) : new Map<string, number>();
  // the same, but ecosystem tokens priced only by their own pools on that chain (shown next to the headline)
  const pxPool = kasPx ? buildPriceMap(allRaw, kasPx, book, true) : new Map<string, number>();

  const prov: Record<string, Provenance> = {};
  const signals: Signal[] = [];
  const blocks: Snapshot["blocks"] = {};
  if (kaskad) blocks.igra = { block: kaskad.block, timestamp: kaskad.timestamp };
  else if (zIgra) blocks.igra = { block: zIgra.block, timestamp: zIgra.timestamp };
  if (anyKasplex) blocks.kasplex = { block: anyKasplex.block, timestamp: anyKasplex.timestamp };

  const protocols: ProtocolView[] = items.map((it, i) => {
    const lp = details[i];
    const cleaned = cleanSeries(dailySeries(lp?.tvl).slice(-97));
    const history = cleaned.series.slice(-90);
    const tf = lp ? tokenFlows(lp) : { flows: [], priceEffect: 0, qtyEffect: 0, comp: {} };
    const llamaTvl = it.tvl;
    const borrowedLlama = lp?.currentChainTvls?.borrowed ?? null;
    const kind = category(it.category);
    const base: ProtocolView = {
      id: it.slug, name: it.name, letter: LETTERS[it.slug] ?? initials(it.name), category: prettyCategory(it.category), kind, historyCleaned: cleaned.removed,
      chains: it.chains.filter((c) => c === "Igra" || c === "Kasplex"), site: it.url ? it.url.replace(/^https?:\/\//, "").replace(/\/.*$/, "") : null,
      tvl: llamaTvl, llamaTvl, d24: change(history, 1), d7: change(history, 7), d24Source: "defillama", intraday: [], activity: null, history,
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
      base.tokens = view.markets.map((m) => ({ sym: normSym(m.symbol), usd: m.cashUsd })).sort((a, b) => b.usd - a.usd);
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
        ["iKAS bridge backing at the account level", "Bridge-wide backing is on the Bridge page; per-deposit matching is not indexed"],
        ["Bad debt at the account level", "Needs per-account positions from an indexer"],
      ];

      // signals
      for (const m of view.markets) {
        if (m.utilization >= 0.95) signals.push({ key: `${it.slug}:util:${m.symbol}`, t: "crit", p: it.slug, rule: "util", strong: `Kaskad ${m.symbol} utilization is ${pct(m.utilization)}`, rest: `. ${usd(m.borrowedUsd)} is borrowed against ${usd(m.suppliedUsd)} supplied, so ${usd(m.cashUsd)} can be withdrawn right now. Borrow rate ${pct(m.borrowApr)}.` });
        else if (m.utilization >= 0.8) signals.push({ key: `${it.slug}:util:${m.symbol}`, t: "warn", p: it.slug, rule: "util", strong: `Kaskad ${m.symbol} utilization is ${pct(m.utilization)}`, rest: `. Only ${usd(m.cashUsd)} of ${usd(m.suppliedUsd)} is withdrawable now.` });
        if (m.frozen) signals.push({ key: `${it.slug}:frozen:${m.symbol}`, t: "warn", p: it.slug, rule: "contract", strong: `Kaskad ${m.symbol} market is frozen`, rest: `. No new supply or borrowing; existing positions can repay and withdraw. It holds ${usd(m.suppliedUsd)} of supply.` });
        if (m.oracleDeviation != null && Math.abs(m.oracleDeviation) >= 0.02) signals.push({ key: `${it.slug}:oracle-drift:${m.symbol}`, t: "warn", p: it.slug, rule: "contract", strong: `Kaskad's ${m.symbol} oracle is ${pct(Math.abs(m.oracleDeviation))} ${m.oracleDeviation > 0 ? "above" : "below"} market`, rest: ` (oracle $${m.price.toPrecision(4)}, market $${m.marketPrice?.toPrecision(4)}).` });
      }
      const broken = view.markets.filter((m) => !m.oracleOk);
      const stale = broken.filter((m) => m.oracleError === "StalePrice" && m.oracleUpdatedAt);
      const staleHours = stale.length ? (kaskad.timestamp - Math.max(...stale.map((m) => m.oracleUpdatedAt!))) / 3600 : 0;
      const allBroken = broken.length === view.markets.length;
      if (stale.length) {
        const maxAge = stale[0].oracleMaxAge ?? 3600;
        signals.push({ key: `${it.slug}:oracle-revert`, t: allBroken ? "crit" : "warn", p: it.slug, rule: "contract",
          strong: `Kaskad's price oracle is stale: last update ${staleHours.toFixed(1)} hours ago`,
          rest: `, and it rejects prices older than ${Math.round(maxAge / 60)} minutes (StalePrice). Until it updates, ${allBroken ? "every" : "the " + stale.map((m) => m.symbol).join(", ")} market${allBroken || stale.length > 1 ? "s" : ""} cannot price collateral: borrowing, withdrawing collateral against a loan and liquidations revert. Suppliers without loans can still withdraw. dawns values these markets at market prices.` });
      } else if (broken.length) {
        signals.push({ key: `${it.slug}:oracle-revert`, t: "warn", p: it.slug, rule: "contract", strong: `Kaskad's price oracle reverted for ${broken.map((m) => m.symbol).join(", ")}`, rest: ` at block #${kaskad.block.toLocaleString("en-US")} (error ${broken[0].oracleError}). Borrowing and liquidations read this oracle; dawns valued these markets at market prices instead.` });
      }
      if (!kaskad.aclAdminIsContract) signals.push({ key: `${it.slug}:admin-eoa`, t: "warn", p: it.slug, rule: "contract", strong: "Kaskad's ACL admin is a single key", rest: " (an EOA, not a multisig or timelock). It can change roles that control pausing, listings and risk settings." });
      const worst = view.markets.some((m) => m.utilization >= 0.95) ? "crit" : view.markets.some((m) => m.utilization >= 0.8 || m.frozen) ? "warn" : "good";
      base.status = worst as Status;
      base.statusText = worst === "crit" ? "Liquidity crunch" : worst === "warn" ? "Watch" : "Healthy";
      base.flags = view.markets.filter((m) => m.utilization >= 0.8 || m.frozen).map((m) => [m.utilization >= 0.95 ? "crit" : "warn", m.frozen ? `${m.symbol} market frozen` : `${m.symbol} utilization ${pct(m.utilization, 0)}`] as [Status, string]);
      if (!kaskad.aclAdminIsContract) base.flags.push(["warn", "Admin is a single key"]);
      if (broken.length) base.flags.unshift([allBroken ? "crit" : "warn", stale.length ? `Oracle stale ${staleHours.toFixed(1)} h` : `Oracle reverting (${broken.length}/${view.markets.length})`]);
      if (allBroken && stale.length) { base.status = "crit"; base.statusText = "Oracle stale"; }

      /* --- every account's position (from dawns' account index) --- */
      if (own?.kaskad && base.lending) {
        const rows = own.kaskad.rows;
        const borrowers = rows.filter((r) => r.debt > 0.01);
        const B = [["Below 1.0 · liquidatable", 0, 1], ["1.0 – 1.1", 1, 1.1], ["1.1 – 1.25", 1.1, 1.25], ["1.25 – 1.5", 1.25, 1.5], ["1.5 – 2", 1.5, 2], ["Above 2", 2, Infinity]] as const;
        const buckets = B.map(([label, lo, hi]) => { const inB = borrowers.filter((r) => (r.hf ?? Infinity) >= lo && (r.hf ?? Infinity) < hi); return { label, debtUsd: inB.reduce((x, r) => x + r.debt, 0), accounts: inB.length }; });
        const liq = borrowers.filter((r) => (r.hf ?? Infinity) < 1);
        const bad = borrowers.filter((r) => r.debt > r.coll);
        const near = borrowers.filter((r) => (r.hf ?? Infinity) >= 1 && (r.hf ?? Infinity) < 1.05);
        const pos = {
          accounts: own.kaskad.accounts, suppliers: rows.filter((r) => r.coll > 0.01).length, borrowers: borrowers.length, unread: Math.max(0, own.kaskad.accounts - rows.length), updatedAt: own.kaskad.updatedAt,
          debtUsd: borrowers.reduce((x, r) => x + r.debt, 0), collateralUsd: rows.reduce((x, r) => x + r.coll, 0), buckets,
          liquidatableUsd: liq.reduce((x, r) => x + r.debt, 0), liquidatable: liq.length,
          badDebtUsd: bad.reduce((x, r) => x + (r.debt - r.coll), 0), badDebtAccounts: bad.length,
          top: [...borrowers].sort((a, b) => b.debt - a.debt).slice(0, 10).map((r) => ({ address: r.address, collateralUsd: r.coll, debtUsd: r.debt, hf: r.hf })),
        };
        base.lending.positions = pos;
        prov[`${it.slug}-pos`] = { label: "Borrower health", value: `${pos.borrowers} borrowers`, trail: [
          ["Accounts", `${pos.accounts.toLocaleString("en-US")} addresses that ever supplied or borrowed (Supply and Borrow events since the pool launched)`],
          ["Read", "aToken.balanceOf and variableDebtToken.balanceOf for every account and market"],
          ["Price", "Kaskad oracle when it answers, market price otherwise"],
          ["Health factor", "Σ collateral × liquidation threshold ÷ Σ debt, as Aave computes it; supplied assets assumed to be collateral (the default)"],
        ], note: "Pool.getUserAccountData would give the same number, but it reverts whenever the oracle is stale, so dawns computes it from balances." };
        const blockedLiq = allBroken && stale.length > 0;
        if (pos.badDebtUsd >= 100) signals.push({ key: `${it.slug}:baddebt`, t: "crit", p: it.slug, rule: "contract", strong: `Kaskad has ${usd(pos.badDebtUsd)} of bad debt`, rest: ` across ${pos.badDebtAccounts} account${pos.badDebtAccounts > 1 ? "s" : ""}: their debt is larger than their collateral at market prices. If not repaid, suppliers carry the loss.` });
        if (pos.liquidatableUsd >= 500) signals.push({ key: `${it.slug}:liquidatable`, t: blockedLiq ? "crit" : "warn", p: it.slug, rule: "contract", strong: `${usd(pos.liquidatableUsd)} of Kaskad debt can be liquidated`, rest: ` across ${pos.liquidatable} account${pos.liquidatable > 1 ? "s" : ""} (health factor below 1 at market prices).${blockedLiq ? " Liquidations cannot run while the oracle is stale, so this debt keeps growing riskier." : ""}` });
        const nearUsd = near.reduce((x, r) => x + r.debt, 0);
        if (nearUsd >= 5_000) signals.push({ key: `${it.slug}:nearliq`, t: "warn", p: it.slug, rule: "contract", strong: `${usd(nearUsd)} of Kaskad debt is within 5% of liquidation`, rest: ` across ${near.length} account${near.length > 1 ? "s" : ""}.` });
        if (pos.badDebtUsd >= 100) base.flags.unshift(["crit", `Bad debt ${usd(pos.badDebtUsd)}`]);
        base.canVerify.push(["Every account's health factor", `${pos.accounts.toLocaleString("en-US")} accounts, balances read each run`, "On-chain"]);
        base.cannotVerify = base.cannotVerify.filter(([k]) => !k.startsWith("Bad debt"));
      }
    }

    /* --- DEXs read pool by pool (UniV2 pairs, UniV3 pools) --- */
    const dexRead = dexBySlug.get(it.slug);
    if (dexRead?.length && kasPx) {
      const adapter = DEX_ADAPTERS[it.slug];
      const raw = dexRead.flatMap((x) => x.read.pools);
      const priced = valuePools(raw, pxMap);
      const total = priced.reduce((s, p) => s + p.usd, 0);
      const pools = poolViews(priced, total, pxPool);
      base.tvlPool = valuePools(raw, pxPool).reduce((x, p) => x + p.usd, 0);
      const pairCount = dexRead.reduce((s, x) => s + x.read.pairCount, 0);
      const vol = volBy[it.slug], fee = feeBy[it.slug];
      const first = dexRead[0].read;
      base.source = "onchain";
      base.tvl = total;
      base.verifiedShare = 1;
      base.asOf = { chain: first.chain, block: first.block, timestamp: first.timestamp };
      const byChain = (c: ChainKey) => priced.filter((p) => p.chain === c).reduce((s, p) => s + p.usd, 0);
      base.dex = { pools, pairCount, byChain: { igra: byChain("igra"), kasplex: byChain("kasplex") }, vol24: vol?.vol24 ?? null, vol7: vol?.vol7 ?? null, fees24: fee?.fees24 ?? null,
        feeRate: fee?.fees7 && vol?.vol7 ? fee.fees7 / vol.vol7 : null, lpShare: fee?.fees7 && fee.lp7 != null ? Math.min(1, fee.lp7 / fee.fees7) : null,
        feeSource: fee?.fees7 && vol?.vol7 ? "defillama" : null, feeSamples: 0 };
      // measured on-chain: the median fee real swaps paid, and the LP share from the fee switch
      const measured = own?.fees.get(it.slug);
      if (measured && measured.n >= 5) { base.dex.feeRate = measured.median; base.dex.feeSource = "on-chain"; base.dex.feeSamples = measured.n; }
      const shares = raw.filter((r) => r.kind === "v2" && r.lpShare != null).map((r) => r.lpShare as number);
      if (shares.length) base.dex.lpShare = Math.min(...shares);
      const comp: Record<string, number> = {};
      for (const p of priced) {
        const add = (sym: string, v: number) => { const k = normSym(sym); comp[k] = (comp[k] ?? 0) + v; };
        if (p.kind === "v3") { if (p.p0 != null) add(p.t0.symbol, p.r0 * p.p0); if (p.p1 != null) add(p.t1.symbol, p.r1 * p.p1); }
        else { if (p.p0 != null) add(p.t0.symbol, p.usd / 2); if (p.p1 != null) add(p.t1.symbol, p.usd / 2); }
      }
      base.tokens = Object.entries(comp).map(([sym, v]) => ({ sym, usd: v })).sort((a, b) => b.usd - a.usd);
      const kinds = [...new Set(adapter.sources.map((x) => x.kind))];
      prov[`${it.slug}-tvl`] = {
        label: "Total liquidity", value: usdFull(total),
        trail: [
          ["Contracts", dexRead.map((x) => `${x.src.kind.toUpperCase()} factory ${x.src.factory} (${x.src.chain === "igra" ? "Igra" : "Kasplex"})`).join(" · ")],
          ["Blocks", dexRead.map((x) => `${x.src.chain === "igra" ? "Igra" : "Kasplex"} #${x.read.block.toLocaleString("en-US")}`).join(" · ")],
          ["Read", kinds.includes("v3") ? `PoolCreated logs → balanceOf() of both tokens on ${pairCount} pools` : `allPairs() → getReserves() on ${pairCount} pairs`],
          ["Price", `KAS wrappers at the KAS market price ($${kasPx.toPrecision(4)}), stablecoins at $1, other tokens from their deepest V2 pool against a priced token (across all Kaspa DEXs)`],
          ["Calculation", kinds.includes("v3") ? "Σ pools, each valued at the priced tokens it holds" : "Σ pools, each valued at 2 × its smaller priced side"],
        ],
        note: adapter.note,
        links: dexRead.map((x) => explorerAddress(x.src.chain, x.src.factory)),
      };
      if (vol?.vol24 != null) prov[`${it.slug}-vol`] = { label: "24h volume", value: usdFull(vol.vol24), trail: [["Source", "DefiLlama DEX volume API"], ["Status", "dawns will read Swap events directly once the indexer runs"]] };
      if (fee?.fees24 != null) prov[`${it.slug}-fee`] = { label: "24h fees", value: usdFull(fee.fees24), trail: [["Source", "DefiLlama fees API"], ...(fee.fees7 && vol?.vol7 ? [["Fee rate", `${pct(fee.fees7 / vol.vol7, 2)} of volume (7-day fees ÷ 7-day volume)`] as [string, string]] : []), ...(fee.fees7 && fee.lp7 != null ? [["To liquidity providers", `${pct(Math.min(1, fee.lp7 / fee.fees7), 0)} of fees (DefiLlama supply-side revenue)`] as [string, string]] : [])] };
      base.contracts = dexRead.map((x) => ({ n: `${x.src.kind === "v3" ? "V3" : "V2"} factory (${x.src.chain === "igra" ? "Igra" : "Kasplex"})`, addr: x.src.factory, chain: x.src.chain, up: x.src.kind === "v3" ? "Immutable (UniV3)" : "Immutable (UniV2)", admin: x.src.kind === "v3" ? "Owner sets fee tiers" : "Fee setter", pause: "No", t: "good" as Status }));
      base.canVerify = [
        [kinds.includes("v3") ? "Balances of every pool" : "Reserves of every pair", `${pairCount} pools on ${[...new Set(dexRead.map((x) => x.src.chain))].map((c) => (c === "igra" ? "Igra" : "Kasplex")).join(" and ")}`, "On-chain"],
        ["Token metadata", "symbol() and decimals() per token", "On-chain"],
        ...(kinds.includes("v2") ? [["Price impact by trade size", "Constant-product maths on live reserves", "Derived"] as [string, string, string]] : []),
      ];
      base.cannotVerify = [["Swap volume and fees", "Taken from DefiLlama until the indexer reads Swap events"]];
      if (it.slug === "zealousswap") {
        // Infinity Pools: third-party tokens are TVL, the protocol's own token is staking
        const vaults = (infinity ?? []).map((v) => ({ ...v, px: pxMap.get(`${v.chain}:${v.token.toLowerCase()}`) ?? null, pp: pxPool.get(`${v.chain}:${v.token.toLowerCase()}`) ?? null }));
        const val = (v: (typeof vaults)[number]) => (v.px != null ? v.amount * v.px : 0);
        const tvlVaults = vaults.filter((v) => !v.own), own = vaults.filter((v) => v.own);
        const addTvl = tvlVaults.reduce((x, v) => x + val(v), 0), staking = own.reduce((x, v) => x + val(v), 0);
        const valP = (v: (typeof vaults)[number]) => (v.pp != null ? v.amount * v.pp : 0);
        const addPool = tvlVaults.reduce((x, v) => x + valP(v), 0), stakingPool = own.reduce((x, v) => x + valP(v), 0);
        if (infinity) {
          base.tvl += addTvl;
          if (base.tvlPool != null) base.tvlPool += addPool;
          for (const v of tvlVaults) if (v.px != null) { const e = base.tokens.find((t) => t.sym === normSym(v.symbol)); if (e) e.usd += val(v); else base.tokens.push({ sym: normSym(v.symbol), usd: val(v) }); }
          base.tokens.sort((a, b) => b.usd - a.usd);
          const fmt = (v: (typeof vaults)[number]) => `${Math.round(v.amount).toLocaleString("en-US")} ${v.symbol} (${v.chain === "igra" ? "Igra" : "Kasplex"})${v.px == null ? ", unpriced" : ""}`;
          const t = prov[`${it.slug}-tvl`];
          t.value = usdFull(base.tvl);
          t.trail.push(["Infinity Pools", `+ ${usdFull(addTvl)}: totalStaked + totalRewards of ${tvlVaults.map(fmt).join(", ")}`]);
          prov[`${it.slug}-staking`] = { label: "ZEAL staked", value: usdFull(staking), trail: [["Contracts", own.map((v) => `${v.vault} (${v.chain === "igra" ? "Igra" : "Kasplex"})`).join(" · ")], ["Read", "totalStaked() + totalRewards()"], ["Amount", own.map(fmt).join(" + ")]], note: "The protocol's own token staked in its own vaults: reported as staking, never added to TVL.", links: own.map((v) => explorerAddress(v.chain, v.vault)) };
          base.canVerify.push(["Infinity Pools", `${vaults.length} vaults read on-chain: ${usd(addTvl)} of NACHO and KASPER in TVL (${usd(addPool)} at pool prices), ${usd(staking)} of ZEAL staking kept out of TVL (${usd(stakingPool)} at pool prices)`, "On-chain"]);
        } else base.cannotVerify.push(["Infinity Pools", "The vault read failed this run"]);
        base.cannotVerify.push(["Farm deposits", "Farms hold LP tokens of the pools above, so their value is already in TVL; how much of each pool is farmed is not read yet"]);
      }
      if (base.tvlPool != null && Math.abs(base.tvlPool / Math.max(1, base.tvl) - 1) >= 0.03)
        prov[`${it.slug}-tvl`].trail.push(["At pool prices", `${usdFull(base.tvlPool)}: ecosystem tokens (NACHO, ZEAL, IGRA…) valued at their own pool price on each chain, not the CoinGecko price. KAS, stablecoins and majors unchanged.`]);
      const top = pools[0];
      base.status = top && top.share > 0.6 ? "warn" : "good";
      base.statusText = base.status === "warn" ? "Concentrated" : "Healthy";
      if (top && top.share > 0.6) base.flags.push(["warn", `${top.symbols.join("/")} holds ${pct(top.share, 0)} of liquidity`]);
    }

    /* --- Igra Attestation: IGRA locked by attesters --- */
    if (it.slug === "igra-attestation" && attest) {
      const b = attest.balances[0];
      const px = book.get("igra") ?? 0;
      const total = (b?.amount ?? 0) * px;
      base.source = "onchain"; base.tvl = total; base.verifiedShare = px ? 1 : 0;
      base.asOf = { chain: "igra", block: attest.block, timestamp: attest.timestamp };
      base.tokens = [{ sym: "IGRA", usd: total }];
      base.contracts = [{ n: "Attestation Diamond", addr: IGRA_ATTESTATION, chain: "igra", up: "Diamond (upgradeable facets)", admin: "Igra Labs", pause: "Unknown", t: "warn" }, { n: "IGRA token", addr: IGRA_TOKEN, chain: "igra", up: "—", admin: "—", pause: "—", t: "info" }];
      base.canVerify = [["IGRA locked by attesters", "IGRA.balanceOf(Attestation Diamond)", "On-chain"]];
      base.cannotVerify = [["Slashing and unlock schedule", "Per-attester locks (6 months) are not decoded yet"], ["IGRA price", "Market price from DefiLlama; IGRA liquidity is thin"]];
      prov[`${it.slug}-tvl`] = { label: "IGRA locked", value: usdFull(total), trail: [["Contract", `Attestation Diamond ${IGRA_ATTESTATION}`], ["Block", `#${attest.block.toLocaleString("en-US")} · Igra`], ["Read", "IGRA.balanceOf(diamond)"], ["Amount", `${Math.round(b?.amount ?? 0).toLocaleString("en-US")} IGRA`], ["Price", `$${px.toPrecision(3)} per IGRA (DefiLlama)`]], note: "Attesters lock IGRA for about six months as a security deposit for state validation. Deposits can be slashed.", links: [explorerAddress("igra", IGRA_ATTESTATION)] };
      base.status = "good"; base.statusText = "Healthy";
    }

    /* --- KaspaCom LFG: native KAS in bonding curves --- */
    if (it.slug === "kaspacom-lfg" && kasPx && lfg.some(Boolean)) {
      const reads = lfg.filter((x): x is NonNullable<typeof x> => x !== null);
      const kas = reads.reduce((s, r) => s + r.kas, 0);
      const total = kas * kasPx;
      base.source = "onchain"; base.tvl = total; base.verifiedShare = 1;
      base.asOf = { chain: reads[0].chain, block: reads[0].block, timestamp: reads[0].timestamp };
      base.tokens = [{ sym: "KAS", usd: total }];
      base.contracts = LFG_FACTORIES.map((f) => ({ n: `Bonding factory (${f.chain === "igra" ? "Igra" : "Kasplex"})`, addr: f.factory, chain: f.chain, up: "Unknown", admin: "Unknown", pause: "Unknown", t: "info" as Status }));
      base.canVerify = [["Native KAS held by every live bonding curve", `getAllBondingCurves() → getBalance(), ${reads.reduce((s, r) => s + r.curves, 0)} curves`, "On-chain"]];
      base.cannotVerify = [["Graduated tokens", "Liquidity that moved to a DEX is counted under that DEX"]];
      prov[`${it.slug}-tvl`] = { label: "KAS in bonding curves", value: usdFull(total), trail: [["Contracts", reads.map((r) => `${r.chain === "igra" ? "Igra" : "Kasplex"}: factory + ${r.curves} curves`).join(" · ")], ["Read", "native balance of the factory and every curve"], ["Amount", `${Math.round(kas).toLocaleString("en-US")} KAS`], ["Price", `$${kasPx.toPrecision(4)} per KAS`]] };
      base.status = base.floor ? "info" : "good"; base.statusText = base.floor ? "Below monitoring floor" : "Healthy";
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
    /* --- dawns' own history and event index --- */
    const mine = own?.series.get(it.slug);
    if (mine && mine.length >= 2) base.intraday = [...mine.slice(0, -1), { t: Date.now(), v: base.tvl }];
    const then = own?.at24.get(it.slug);
    if (then && then > 0 && base.source === "onchain") { base.d24 = base.tvl / then - 1; base.d24Source = "dawns"; }
    const act = own?.activity.get(it.slug);
    const caughtUp = !!own?.indexedUpTo && own.indexedUpTo > Date.now() - 45 * 60_000;
    const coveredMs = caughtUp && own?.indexedSince ? Date.now() - own.indexedSince : 0;
    if (act) {
      base.activity = act;
      if (base.dex && coveredMs >= 24 * 3600_000) {
        base.dex.vol24 = act.vol24;
        if (base.dex.feeSource === "on-chain" && base.dex.feeRate != null) {
          base.dex.fees24 = act.vol24 * base.dex.feeRate;
          prov[`${it.slug}-fee`] = { label: "24h fees", value: usdFull(base.dex.fees24), trail: [["Volume", `${usdFull(act.vol24)} of swaps read on-chain`], ["Fee rate", `${pct(base.dex.feeRate, 3)}: the median fee paid by ${base.dex.feeSamples} swaps in 7 days, from each pair's reserves just before the swap`], ["To liquidity providers", base.dex.lpShare != null ? `${pct(base.dex.lpShare, 0)} of fees (factory fee switch read on-chain)` : "unknown"]] };
        }
        if (act.vol7 != null) base.dex.vol7 = act.vol7;
        const allV3 = base.dex.pools.length > 0 && base.dex.pools.every((q) => q.kind === "v3");
        const feesOnChain = base.dex.feeSource === "on-chain" || allV3;
        prov[`${it.slug}-vol`] = { label: "24h volume", value: usdFull(act.vol24), trail: [["Source", "Swap events read by dawns from every pool of this DEX"], ["Swaps", `${act.swaps24.toLocaleString("en-US")} in the last 24 hours`], ["Price", "Each swap valued at the priced leg, at current token prices"], ["Indexed since", new Date(own!.indexedSince!).toISOString().slice(0, 16).replace("T", " ") + " UTC"]],
          ...(feesOnChain ? {} : { note: "Fees for this DEX still come from DefiLlama: too few swaps have been sampled to measure its fee rate on-chain." }) };
        base.cannotVerify = base.cannotVerify.filter(([k]) => k !== "Swap volume and fees");
        base.canVerify.push(["Swap volume", "Swap events on every pool, valued at current prices", "On-chain"]);
        if (allV3) base.canVerify.push(["Trading fees", "Each pool's fee tier and the protocol's share (slot0.feeProtocol)", "On-chain"]);
        else if (feesOnChain) base.canVerify.push(["Trading fees", `Median fee of ${base.dex.feeSamples.toLocaleString("en-US")} swaps, from each pair's reserves just before the swap${base.dex.lpShare != null ? "; LP share from the factory fee switch" : ""}`, "On-chain"]);
        else base.cannotVerify.push(["Trading fees", "Taken from DefiLlama until enough swaps are sampled; volume is read on-chain"]);
        const avg = act.vol7 != null ? act.vol7 / 7 : null;
        if (avg && act.vol24 > 2 * avg && act.vol24 >= 5_000 && !base.floor)
          signals.push({ key: `${it.slug}:vol`, t: "info", p: it.slug, rule: "vol", strong: `${it.name} volume is ${(act.vol24 / avg).toFixed(1)}× its 7-day average`, rest: ` (${usd(act.vol24)} in 24h across ${act.swaps24} swaps).` });
      }
      const day = Date.now() - 24 * 3600_000;
      for (const e of act.events.filter((x) => x.t >= day)) {
        const big = e.kind === "liquidation" || (e.kind === "withdraw" && e.usd >= 50_000) || (e.kind === "remove" && e.usd >= 25_000);
        if (!big || base.floor) continue;
        const what = e.kind === "liquidation" ? `A ${e.label} position was liquidated on ${it.name}` : e.kind === "withdraw" ? `${usd(e.usd)} of ${e.label} was withdrawn from ${it.name}` : `${usd(e.usd)} of ${e.label} liquidity left ${it.name}`;
        signals.push({ key: `${it.slug}:${e.kind}:${e.tx}`, t: e.kind === "liquidation" ? "warn" : "info", p: it.slug, rule: e.kind === "liquidation" ? "contract" : "large", strong: what, rest: e.kind === "liquidation" ? ` (${usd(e.usd)} of debt repaid by a liquidator).` : "." });
      }
    }

    if (base.floor) { base.status = "info"; base.statusText = "Below monitoring floor"; base.flags = []; }

    // cross-check signal
    if (base.source === "onchain" && llamaTvl > 0 && Math.abs(base.tvl / llamaTvl - 1) > 0.15) {
      base.flags.push(["info", `DefiLlama shows ${usd(llamaTvl)}`]);
    }
    // move signals from history
    if (base.d24 != null && Math.abs(base.d24) >= 0.1 && !base.floor) {
      signals.push({ key: `${it.slug}:tvl24:${base.d24 < 0 ? "down" : "up"}`, t: base.d24 < 0 ? "warn" : "good", p: it.slug, rule: "tvl", strong: `${it.name} TVL ${base.d24 < 0 ? "fell" : "rose"} ${pct(Math.abs(base.d24))} in 24h`, rest: base.d24Source === "dawns" ? ` (dawns' own reads, now vs 24 hours ago).` : ` (DefiLlama daily history).` });
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

  if (kasPx && kas24 != null && Math.abs(kas24) >= 0.05) signals.push({ key: `kas:move:${kas24 > 0 ? "up" : "down"}`, t: "info", p: null, rule: null, strong: `KAS ${kas24 > 0 ? "rose" : "fell"} ${pct(Math.abs(kas24))} in 24h`, rest: ` to $${kasPx.toPrecision(3)}. Most Kaspa DeFi value is KAS, so TVL moves with it.` });

  /* ---------- Igra bridge backing ---------- */
  if (bridge && own) {
    if (own.backing.length >= 2) bridge.history = [...own.backing.slice(0, -1), { t: Date.now(), v: bridge.coverage }];
    if (own.exitStats.indexed > 0) {
      bridge.payouts = own.exitStats;
      const byKey = new Map(own.exits.map((e) => [`${e.block}:${Math.round(e.kas * 1e8)}`, e]));
      for (const e of bridge.recentExits) {
        const row = byKey.get(`${e.block}:${Math.round(e.kas * 1e8)}`);
        if (row) Object.assign(e, { tx: row.tx, payTo: row.payout, paidTx: row.paid_tx, paidAt: row.paid_at, paidKas: row.paid_kas });
      }
    }
  }
  if (bridge) {
    const kas = (n: number) => `${Math.round(n).toLocaleString("en-US")} KAS`;
    prov["bridge-cov"] = {
      label: "iKAS backing", value: pct(bridge.coverage),
      trail: [
        ["Locked on Kaspa L1", `${kas(bridge.lockedKas)} held by the bridge Entry address ${IGRA_BRIDGE.entry.slice(0, 18)}…${IGRA_BRIDGE.entry.slice(-6)} (api.kaspa.org)`],
        ["Minted on Igra", `${kas(bridge.ikasSupply)} iKAS in circulation (Igra explorer coin supply)`],
        ["Calculation", "KAS locked ÷ iKAS in circulation"],
        ["Block", `Igra #${bridge.block.toLocaleString("en-US")}`],
      ],
      note: "Exits burn iKAS on Igra first; the guardian committee then releases KAS on L1 within 48–72 hours. KAS for exits still in that window sits on top of the iKAS supply, so backing reads slightly above 100% while releases are pending.",
      links: [`https://explorer.kaspa.org/addresses/${IGRA_BRIDGE.entry}`, explorerAddress("igra", IGRA_BRIDGE.exitBridge)],
    };
    if (bridge.coverage < 1) {
      const t: Status = bridge.coverage < 0.99 ? "crit" : "warn";
      signals.push({ key: "igra-bridge:backing", t, p: "igra-bridge", rule: "backing", strong: `iKAS is ${pct(bridge.coverage)} backed`, rest: `. ${kas(bridge.lockedKas)} is locked on Kaspa L1 against ${kas(bridge.ikasSupply)} iKAS on Igra, a shortfall of ${kas(-bridge.surplusKas)}.` });
    }
    const po = bridge.payouts;
    if (po && po.late > 0)
      signals.push({ key: "igra-bridge:late", t: "warn", p: "igra-bridge", rule: "backing", strong: `${po.late} bridge exit${po.late > 1 ? "s" : ""} (${kas(po.lateKas)}) waiting more than 72 hours for payout`, rest: `. The iKAS was burned on Igra but dawns finds no matching Kaspa L1 payment from the Entry address yet.` });
    const big = bridge.recentExits.filter((e) => e.ageSec <= 86_400 && kasPx && e.kas * kasPx >= 50_000);
    for (const e of big) signals.push({ key: `igra-bridge:exit:${e.id}`, t: "info", p: "igra-bridge", rule: "large", strong: `${kas(e.kas)} left Igra through the bridge`, rest: ` (exit #${e.id}${kasPx ? `, ${usd(e.kas * kasPx)}` : ""}). The guardians release it on Kaspa L1 within 48–72 hours.` });
  }

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
      intraday: own?.eco.length && own.eco.length >= 2 ? [...own.eco.slice(0, -1), { t: Date.now(), v: tvl }] : [],
    },
    bridge: bridge ?? null, opportunities: buildOpportunities(protocols, own ?? null, Date.now()), signals, prov, errors,
  };
}

export const getSnapshot = unstable_cache(buildSnapshot, ["dawns-snapshot-v2"], { revalidate: 120, tags: ["snapshot"] });

export type { Snapshot, ProtocolView, Signal, RuleKey };
export const findProtocol = (s: Snapshot, id: string) => s.protocols.find((p) => p.id === id) ?? null;
export type { ChainKey };
