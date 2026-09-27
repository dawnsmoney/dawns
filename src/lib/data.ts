/**
 * Sample data for the dawns.money prototype.
 *
 * Protocol TVLs match DefiLlama on 27 Sep 2026. Everything else here (time series,
 * markets, pools, addresses, events) is illustrative sample data. This module is the
 * seam the indexer will replace: pages only read from the exports below.
 */
import { usd, usdFull, pct } from "./format";

export type Status = "good" | "warn" | "crit" | "info";
export type Category = "Lending" | "DEX";
export type AssetSym = "iKAS" | "USDC" | "USDT" | "ZEAL" | "KSKD" | "NACHO" | "Other";

export interface Market { a: AssetSym; sup: number; bor: number; sApy: number; inc: number; bApy: number; ltv: number }
export interface Pool { p: string; liq: number; v: number; c24: number; a: [AssetSym, AssetSym] }
export interface ContractRow { n: string; addr: string; up: string; admin: string; pause: string; t: Status }
export type Flag = [Status, string];

export interface Protocol {
  id: string;
  name: string;
  letter: string;
  cat: Category;
  chain: string;
  site: string | null;
  tvl: number;
  d24: number;
  d7: number;
  status: Status;
  statusText: string;
  verif: number;
  flags: Flag[];
  floor?: boolean;
  series: number[];
  prev24: number;
  flows: number[];
  contracts: ContractRow[];
  canVerify: [string, string, string][];
  cannotVerify: [string, string][];
  // lending
  supplied?: number;
  borrowed?: number;
  util?: number;
  utilD7?: number;
  collateral?: number;
  markets?: Market[];
  concentration?: { top10: number; top1: number; holders: number };
  supS?: number[];
  borS?: number[];
  utilS?: { name: string; color: string; values: number[] }[];
  // dex
  vol24?: number;
  fees24?: number;
  poolsN?: number;
  pools?: Pool[];
  volS?: number[];
}

/* ---------- deterministic series ---------- */
function rng(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function walk(end: number, days: number, vol: number, drift: number, last: number, seed: number) {
  const r = rng(seed);
  const v = new Array<number>(days);
  v[days - 1] = end;
  v[days - 2] = end / (1 + last);
  for (let i = days - 3; i >= 0; i--) v[i] = v[i + 1] / (1 + drift + (r() - 0.5) * 2 * vol);
  return v;
}
function flowSeries(n: number, seed: number, scale: number, lastVal: number) {
  const r = rng(seed);
  const v: number[] = [];
  for (let i = 0; i < n; i++) v.push((r() - 0.42) * scale);
  v[n - 1] = lastVal;
  return v;
}

export const TODAY = Date.UTC(2026, 8, 27);
export const DAYS = 90;
export const DATES = Array.from({ length: DAYS }, (_, i) => TODAY - (DAYS - 1 - i) * 864e5);
export const KAS_PX = 0.0874;
export const BLOCK0 = 4812337;
export const blockAgo = (n: number) => "#" + (BLOCK0 - n).toLocaleString("en-US");

/* Validated categorical palette (dark surface), see dataviz check in the prototype. */
export const C = { s1: "#D17A30", s2: "#2FA88F", s3: "#8578E6", s4: "#D55A7C", s5: "#4F8EE0", gray: "#6E6788" };
export const ASSET_COLOR: Record<AssetSym, string> = {
  iKAS: C.s2, USDC: C.s5, USDT: C.s3, ZEAL: C.s1, KSKD: C.s4, NACHO: C.gray, Other: C.gray,
};

/* ---------- protocols ---------- */
type Seed = Omit<Protocol, "series" | "prev24" | "flows"> & { seed: number; drift: number; vol: number };

const seeds: Seed[] = [
  {
    id: "kaskad", name: "Kaskad", letter: "K", cat: "Lending", chain: "Kaspa", site: "kaskad.app",
    tvl: 855883, d24: -0.108, d7: -0.062, status: "good", statusText: "Healthy", verif: 0.92, seed: 11, drift: 0.0045, vol: 0.022,
    flags: [["warn", "USDC utilization 74.2%"], ["info", "Upgradeable pool, no timelock detected"]],
    supplied: 1208400, borrowed: 352500, util: 0.292, utilD7: 0.031, collateral: 1092000,
    markets: [
      { a: "iKAS", sup: 742300, bor: 18200, sApy: 0.001, inc: 0.06, bApy: 0.029, ltv: 0.3 },
      { a: "USDC", sup: 401500, bor: 298100, sApy: 0.041, inc: 0.06, bApy: 0.068, ltv: 0.75 },
      { a: "USDT", sup: 64600, bor: 36200, sApy: 0.03, inc: 0.04, bApy: 0.059, ltv: 0.75 },
    ],
    concentration: { top10: 0.58, top1: 0.14, holders: 1284 },
    contracts: [
      { n: "Pool", addr: "0x7a3c…e91f", up: "Proxy (upgradeable)", admin: "3-of-5 multisig", pause: "Yes", t: "warn" },
      { n: "COB price oracle", addr: "0x19d4…07b2", up: "Immutable", admin: "TEE-attested signer", pause: "—", t: "good" },
      { n: "Incentives controller", addr: "0xc4e0…5a13", up: "Proxy (upgradeable)", admin: "3-of-5 multisig", pause: "Yes", t: "info" },
      { n: "iKAS bridge (dependency)", addr: "kaspa:qz8…m4t", up: "External", admin: "Igra bridge operators", pause: "Yes", t: "info" },
    ],
    canVerify: [
      ["Reserves held by the pool contract", "balanceOf on each reserve token", "On-chain"],
      ["Outstanding borrows per market", "variable debt token totalSupply", "Contract state"],
      ["Supplier claims per market", "interest-bearing token totalSupply × index", "Contract state"],
      ["Collateral behind each loan", "per-account reserve data, 1,284 accounts", "Contract state"],
      ["Oracle prices used for health factors", "COB oracle latestAnswer, cross-checked vs 3 CEX mids", "On-chain + public API"],
    ],
    cannotVerify: [
      ["KSKD incentive obligations", "Emission schedule is published off-chain and not yet on-chain"],
      ["iKAS bridge backing", "Kaspa L1 bridge reserve is tracked separately; 1:1 backing is assumed here"],
      ["Protocol treasury outside known addresses", "Only the 2 disclosed treasury addresses are monitored"],
    ],
  },
  {
    id: "zealous", name: "Zealous Swap", letter: "Z", cat: "DEX", chain: "Kaspa", site: "zealousswap.com",
    tvl: 569289, d24: -0.131, d7: -0.094, status: "warn", statusText: "Watch", verif: 0.98, seed: 23, drift: 0.003, vol: 0.028,
    flags: [["warn", "iKAS/USDC liquidity −14% in 24h"]],
    vol24: 40700, fees24: 122, poolsN: 14,
    pools: [
      { p: "iKAS / USDC", liq: 312400, v: 22100, c24: -0.14, a: ["iKAS", "USDC"] },
      { p: "iKAS / ZEAL", liq: 128300, v: 9800, c24: -0.11, a: ["iKAS", "ZEAL"] },
      { p: "iKAS / USDT", liq: 61900, v: 4300, c24: -0.08, a: ["iKAS", "USDT"] },
      { p: "KSKD / iKAS", liq: 38600, v: 2900, c24: -0.15, a: ["KSKD", "iKAS"] },
      { p: "iKAS / NACHO", liq: 17400, v: 1100, c24: -0.09, a: ["iKAS", "NACHO"] },
      { p: "9 smaller pools", liq: 10689, v: 500, c24: -0.06, a: ["iKAS", "Other"] },
    ],
    contracts: [
      { n: "Factory", addr: "0x5f0e…b7a9", up: "Immutable", admin: "Fee setter only", pause: "No", t: "good" },
      { n: "Router", addr: "0x2b91…c0de", up: "Immutable", admin: "None", pause: "No", t: "good" },
      { n: "Pair template", addr: "0xa7d2…4e10", up: "Immutable", admin: "None", pause: "No", t: "good" },
      { n: "ZEAL farms", addr: "0x6c33…91fa", up: "Owner-controlled", admin: "EOA", pause: "Yes", t: "warn" },
    ],
    canVerify: [
      ["Pool reserves", "getReserves() on all 14 pairs", "On-chain"],
      ["LP token supply", "totalSupply() per pair", "On-chain"],
      ["Swap volume and fees", "Swap events, every block", "On-chain"],
      ["Liquidity adds and removals", "Mint / Burn events", "On-chain"],
    ],
    cannotVerify: [["ZEAL emission schedule", "Farm rewards are set by an EOA; future rates are not committed on-chain"]],
  },
  {
    id: "kaspacom", name: "KaspaCom DEX", letter: "KC", cat: "DEX", chain: "Kaspa", site: "kaspa.com",
    tvl: 40925, d24: -0.084, d7: 0.036, status: "info", statusText: "Partial data", verif: 0.61, seed: 37, drift: 0.006, vol: 0.04,
    flags: [["info", "Router proxy changed 2 days ago"]],
    vol24: 3100, fees24: 9, poolsN: 6,
    pools: [
      { p: "iKAS / USDT", liq: 21400, v: 1700, c24: -0.07, a: ["iKAS", "USDT"] },
      { p: "iKAS / USDC", liq: 12800, v: 1100, c24: -0.1, a: ["iKAS", "USDC"] },
      { p: "4 smaller pools", liq: 6725, v: 300, c24: -0.09, a: ["iKAS", "Other"] },
    ],
    contracts: [
      { n: "Router", addr: "0x8e44…2d17", up: "Proxy (upgradeable)", admin: "Unknown", pause: "Unknown", t: "warn" },
      { n: "Pools (6)", addr: "various", up: "Immutable", admin: "None", pause: "No", t: "good" },
    ],
    canVerify: [["Pool reserves", "getReserves() on 6 pairs", "On-chain"], ["Swap volume", "Swap events", "On-chain"]],
    cannotVerify: [
      ["Router admin", "Proxy admin address not yet mapped to a known owner"],
      ["Listings outside these pools", "KaspaCom's L1 marketplace is not indexed yet"],
    ],
  },
  {
    id: "kasdex", name: "KasDex", letter: "KD", cat: "DEX", chain: "Kaspa", site: null,
    tvl: 385, d24: -0.02, d7: -0.11, status: "info", statusText: "Below monitoring floor", verif: 0.4, seed: 41, drift: -0.002, vol: 0.03, floor: true,
    flags: [], vol24: 0, fees24: 0, poolsN: 2,
    pools: [{ p: "iKAS / USDT", liq: 385, v: 0, c24: -0.02, a: ["iKAS", "USDT"] }],
    contracts: [{ n: "Pools (2)", addr: "various", up: "Unknown", admin: "Unknown", pause: "Unknown", t: "info" }],
    canVerify: [["Pool reserves", "getReserves()", "On-chain"]],
    cannotVerify: [["Everything else", "Protocols under $10K TVL get balance tracking only"]],
  },
];

export const PROTOCOLS: Protocol[] = seeds.map((s, i) => {
  const { seed, drift, vol, ...rest } = s;
  const p: Protocol = {
    ...rest,
    series: walk(s.tvl, DAYS, vol, drift, s.d24, seed),
    prev24: s.tvl / (1 + s.d24),
    flows: [],
  };
  if (p.cat === "Lending") {
    p.supS = walk(p.supplied!, DAYS, 0.02, 0.004, -0.082, 51);
    p.borS = walk(p.borrowed!, DAYS, 0.015, 0.007, 0.012, 52);
    p.utilS = [
      { name: "USDC", color: ASSET_COLOR.USDC, values: walk(0.742, DAYS, 0.02, 0.0012, 0.006, 53).map((v) => Math.min(v, 0.95)) },
      { name: "USDT", color: ASSET_COLOR.USDT, values: walk(0.56, DAYS, 0.025, 0.001, 0.004, 54).map((v) => Math.min(v, 0.95)) },
      { name: "iKAS", color: ASSET_COLOR.iKAS, values: walk(0.0245, DAYS, 0.03, 0.0008, 0.002, 55) },
    ];
    p.flows = flowSeries(30, 61, 42000, -98000);
  } else {
    p.volS = walk(Math.max(p.vol24 ?? 1, 1), 30, 0.25, 0, 0.18, 70 + i).map((v) => Math.max(0, v));
    p.flows = flowSeries(30, 80 + i, p.tvl * 0.05, -p.tvl * 0.09);
  }
  return p;
});

export const byId = (id: string) => PROTOCOLS.find((p) => p.id === id);
export const P = Object.fromEntries(PROTOCOLS.map((p) => [p.id, p])) as Record<string, Protocol>;

export function dexComp(p: Protocol): [AssetSym, number][] {
  const m: Partial<Record<AssetSym, number>> = {};
  (p.pools ?? []).forEach((q) =>
    q.a.forEach((a) => {
      const k: AssetSym = a === "NACHO" ? "Other" : a;
      m[k] = (m[k] ?? 0) + q.liq / 2;
    }),
  );
  const order: AssetSym[] = ["iKAS", "USDC", "USDT", "ZEAL", "KSKD", "Other"];
  return order.filter((k) => m[k]).map((k) => [k, m[k]!]);
}

/* ---------- ecosystem ---------- */
const sum = (f: (p: Protocol) => number) => PROTOCOLS.reduce((s, p) => s + f(p), 0);
const dexes = PROTOCOLS.filter((p) => p.cat === "DEX");
export const ECO = (() => {
  const tvl = sum((p) => p.tvl);
  const prev24 = sum((p) => p.prev24);
  const price = -141000;
  return {
    tvl,
    prev24,
    d24: tvl / prev24 - 1,
    price,
    flows: tvl - prev24 - price,
    dexLiq: dexes.reduce((s, p) => s + p.tvl, 0),
    dexPrev: dexes.reduce((s, p) => s + p.prev24, 0),
    dexVol: dexes.reduce((s, p) => s + (p.vol24 ?? 0), 0),
    stable: 401500 - 298100 + (64600 - 36200) + (312400 + 61900 + 21400 + 12800) / 2,
    stable7: -0.062,
    series: DATES.map((_, i) => sum((p) => p.series[i])),
  };
})();

export function ecoComposition() {
  const m: Partial<Record<AssetSym, number>> = { iKAS: 724100, USDC: 103400, USDT: 28400 };
  dexes.forEach((p) => dexComp(p).forEach(([a, v]) => (m[a] = (m[a] ?? 0) + v)));
  return (["iKAS", "USDC", "USDT", "ZEAL", "KSKD", "Other"] as AssetSym[])
    .filter((a) => m[a])
    .map((a) => ({ n: a as string, v: m[a]!, c: ASSET_COLOR[a] }));
}

export function ecoStack() {
  const k = P.kaskad, z = P.zealous, kc = P.kaspacom, kd = P.kasdex;
  return [
    { name: "Kaskad", color: C.s1, values: k.series },
    { name: "Zealous Swap", color: C.s2, values: z.series },
    { name: "Other DEXs", color: C.s3, values: kc.series.map((v, i) => v + kd.series[i]) },
  ];
}

/* ---------- events ---------- */
export type RuleKey = "liq" | "util" | "large" | "tvl" | "contract" | "vol";
export interface DEvent { t: Status; p: string | null; ago: string; strong: string; rest: string; rule: RuleKey | null }
export const EVENTS: DEvent[] = [
  { t: "warn", p: "kaskad", ago: "2h ago", rule: "util", strong: "Kaskad USDC utilization reached 74.2%", rest: ", up 9.1pp in 7 days. Borrow APY is now 6.8%. Only $103.4K of $401.5K USDC can be withdrawn immediately." },
  { t: "warn", p: "zealous", ago: "4h ago", rule: "liq", strong: "Zealous iKAS/USDC liquidity fell 14% in 24h", rest: ", from $363K to $312K. A $10K sale now moves the price about 6%." },
  { t: "info", p: null, ago: "6h ago", rule: null, strong: "KAS fell 8.9% in 24h and explains 73% of the Kaspa DeFi TVL decline.", rest: " Net outflows across all protocols were −$52K." },
  { t: "info", p: "kaskad", ago: "9h ago", rule: "large", strong: "One address withdrew 1.12M iKAS ($98K) from Kaskad", rest: ", the largest single withdrawal this month." },
  { t: "good", p: "zealous", ago: "11h ago", rule: "vol", strong: "Zealous 24h volume hit $40.7K", rest: ", the highest in 12 days. Fees: $122." },
  { t: "info", p: "kaspacom", ago: "2d ago", rule: "contract", strong: "KaspaCom router proxy implementation changed", rest: " at block 4,791,002. The new code has not been reviewed by dawns yet." },
];

export function dawnReport() {
  return `dawns check · Kaspa DeFi · 27 Sep

TVL ${usd(ECO.tvl)} (${(ECO.d24 * 100).toFixed(1)}% 24h)
  price effect ${usd(ECO.price, 0)} · net flows ${usd(ECO.flows, 0)}
Kaskad liquidity ${usd(P.kaskad.tvl, 0)} · utilization ${pct(P.kaskad.util!)}
Kaskad USDC utilization 74.2% (+9.1pp 7d)
Zealous 24h volume ${usd(P.zealous.vol24!)} · fees $${P.zealous.fees24}
Biggest move: −$51K iKAS/USDC liquidity on Zealous

On-chain data, updated every block.
dawns.money`;
}

/* ---------- provenance ---------- */
export interface Provenance { label: string; value: string; trail: [string, string][]; note?: string }

export const PROV: Record<string, Provenance> = {
  "eco-tvl": {
    label: "Total value locked · Kaspa DeFi", value: usdFull(ECO.tvl),
    trail: [
      ["Scope", "4 Kaspa DeFi protocols with mapped contracts"],
      ["Contracts", "Kaskad pool · 23 DEX pair contracts"],
      ["Block", blockAgo(0) + " · Igra"],
      ["Read", "balanceOf(token) for every reserve token each contract holds"],
      ["Price", `Kaskad COB oracle for iKAS ($${KAS_PX}); stablecoins at oracle price`],
      ["Calculation", "Σ token balance × price. Borrowed funds are excluded, matching DefiLlama's lending convention."],
      ["Cross-check", "DefiLlama (Kaskad, Zealous, KaspaCom, KasDex): $1.47M, difference < 0.1%"],
    ],
    note: "Borrowed assets are not counted as TVL. They appear on each lending protocol's page as outstanding loans.",
  },
  "eco-lend": {
    label: "Lending liquidity", value: usdFull(P.kaskad.tvl),
    trail: [["Contract", "Kaskad pool 0x7a3c…e91f"], ["Block", blockAgo(0)], ["Read", "balanceOf for iKAS, USDC, USDT held by the pool"], ["Price", "Kaskad COB oracle"], ["Calculation", "Σ reserves × price = supplied − borrowed"]],
  },
  "eco-dex": {
    label: "DEX liquidity", value: usdFull(ECO.dexLiq),
    trail: [["Contracts", "23 pair contracts across Zealous, KaspaCom and KasDex"], ["Block", blockAgo(0)], ["Read", "getReserves() per pair"], ["Price", "iKAS from COB oracle, others from their deepest iKAS pair"], ["Calculation", "Σ (reserve0 × price0 + reserve1 × price1)"]],
  },
  "eco-util": {
    label: "Lending utilization", value: pct(P.kaskad.util!),
    trail: [["Contract", "Kaskad pool"], ["Block", blockAgo(0)], ["Read", "debt token totalSupply and reserve balances per market"], ["Calculation", "Σ borrowed ÷ Σ supplied, USD-weighted: $352.5K ÷ $1.21M"]],
  },
  "eco-stable": {
    label: "Stablecoin liquidity", value: usdFull(ECO.stable),
    trail: [["Sources", "Kaskad USDC and USDT reserves, plus the stablecoin side of 4 DEX pools"], ["Block", blockAgo(0)], ["Calculation", "Kaskad available USDC + USDT, plus ½ of each stable/iKAS pool (the stable side)"], ["Price", "USDC and USDT at oracle price ($1.0001, $0.9998)"]],
  },
};

function addProtocolProv(p: Protocol) {
  const id = p.id;
  if (p.cat === "Lending") {
    PROV[id + "-sup"] = { label: "Total supplied", value: usdFull(p.supplied!), trail: [["Contract", "Kaskad pool 0x7a3c…e91f"], ["Block", blockAgo(0)], ["Read", "interest-bearing token totalSupply × liquidity index, per market"], ["Price", `COB oracle: iKAS $${KAS_PX}, USDC $1.0001, USDT $0.9998`], ["Calculation", "iKAS $742.3K + USDC $401.5K + USDT $64.6K"]], note: "This is what the protocol owes suppliers." };
    PROV[id + "-bor"] = { label: "Outstanding borrows", value: usdFull(p.borrowed!), trail: [["Contract", "Variable debt tokens, 3 markets"], ["Block", blockAgo(0)], ["Read", "totalSupply() × borrow index"], ["Calculation", "iKAS $18.2K + USDC $298.1K + USDT $36.2K"]] };
    PROV[id + "-liq"] = { label: "Available liquidity", value: usdFull(p.tvl), trail: [["Contract", "Kaskad pool"], ["Block", blockAgo(0)], ["Read", "balanceOf(pool) for each reserve token"], ["Calculation", "Σ reserve balances × price. Equals supplied − borrowed."]], note: "What suppliers could withdraw right now, in aggregate. Per-asset limits are under Liquidity." };
    PROV[id + "-util"] = { label: "Utilization", value: pct(p.util!), trail: [["Calculation", "borrowed ÷ supplied = $352.5K ÷ $1.21M"], ["Block", blockAgo(0)]] };
    PROV[id + "-cov"] = { label: "Asset coverage", value: "100.0%", trail: [["Assets", "Reserves in pool $855.9K + outstanding loans $352.5K = $1,208.4K"], ["Liabilities", "Supplier claims $1,208.4K"], ["Block", blockAgo(0)], ["Calculation", "assets ÷ liabilities"], ["Loans backed by", "Collateral $1.09M, 310% of debt, at oracle prices"]], note: "Coverage assumes loans are repaid or liquidated at oracle prices. KSKD incentive obligations are off-chain and not included." };
  } else {
    PROV[id + "-tvl"] = { label: "Total liquidity", value: usdFull(p.tvl), trail: [["Contracts", `${p.poolsN} pair contracts`], ["Block", blockAgo(0)], ["Read", "getReserves() per pair"], ["Price", "iKAS from COB oracle; others from their deepest iKAS pair"], ["Calculation", "Σ reserves × price"]] };
    PROV[id + "-vol"] = { label: "24h volume", value: usdFull(p.vol24 ?? 0), trail: [["Source", "Swap events, last 86,400 blocks"], ["Calculation", "Σ |amountIn| × price at block"]] };
    PROV[id + "-fee"] = { label: "24h fees", value: "$" + p.fees24, trail: [["Calculation", "volume × 0.30% fee tier"], ["Paid to", "Liquidity providers (100%)"]] };
  }
}
PROTOCOLS.forEach(addProtocolProv);

/* ---------- watch rules ---------- */
export type RuleDef = { key: RuleKey; label: string; unit: "$K" | "%" | null; def: number | null };
export const RULES: Record<Category, RuleDef[]> = {
  Lending: [
    { key: "liq", label: "Available liquidity falls below", unit: "$K", def: 500 },
    { key: "util", label: "Any market's utilization rises above", unit: "%", def: 70 },
    { key: "large", label: "A single withdrawal exceeds", unit: "$K", def: 50 },
    { key: "tvl", label: "TVL moves more than, in 24h", unit: "%", def: 15 },
    { key: "contract", label: "Contract upgrade, admin or oracle change", unit: null, def: null },
  ],
  DEX: [
    { key: "liq", label: "A pool's liquidity drops by more than, in 24h", unit: "%", def: 10 },
    { key: "large", label: "A single liquidity removal exceeds", unit: "$K", def: 25 },
    { key: "vol", label: "Volume exceeds its 7d average by", unit: "%", def: 100 },
    { key: "tvl", label: "TVL moves more than, in 24h", unit: "%", def: 15 },
    { key: "contract", label: "Contract upgrade or admin change", unit: null, def: null },
  ],
};
export const RULE_TXT: Record<RuleKey, string> = { liq: "liquidity", util: "utilization", large: "large withdrawal", tvl: "TVL move", contract: "contract changes", vol: "volume spike" };

/* ---------- opportunities & vaults (previews) ---------- */
export const OPPORTUNITIES = [
  { name: "USDC supply", p: "kaskad", asset: "USDC" as AssetSym, native: 0.041, incentive: "+6.0% KSKD", avg30: 0.036, exit: "$103.4K now", watch: "Utilization 74%" },
  { name: "USDT supply", p: "kaskad", asset: "USDT" as AssetSym, native: 0.03, incentive: "+4.0% KSKD", avg30: 0.027, exit: "$28.4K now", watch: "—" },
  { name: "iKAS supply", p: "kaskad", asset: "iKAS" as AssetSym, native: 0.001, incentive: "+6.0% KSKD", avg30: 0.001, exit: "$724.1K now", watch: "Bridged asset" },
  { name: "iKAS / USDC LP", p: "zealous", asset: "USDC" as AssetSym, native: 0.0775, incentive: "ZEAL, rate not committed", avg30: 0.061, exit: "Any time", watch: "KAS price exposure" },
  { name: "iKAS / ZEAL LP", p: "zealous", asset: "ZEAL" as AssetSym, native: 0.0837, incentive: "ZEAL, rate not committed", avg30: 0.072, exit: "Any time", watch: "Two volatile assets" },
];

export const VAULTS = [
  { n: "USDC Reserve", k: "USDC" as AssetSym, risk: "Conservative", y: 0.0306, alloc: [["Kaskad USDC", 60, C.s5], ["Kaskad USDT", 20, C.s3], ["Reserve", 20, C.gray]] as [string, number, string][], exit: "Same day", max: "60%", band: "5%" },
  { n: "USDC Balanced", k: "USDC" as AssetSym, risk: "Balanced", y: 0.0425, alloc: [["Kaskad USDC", 45, C.s5], ["Zealous iKAS/USDC", 25, C.s2], ["Kaskad USDT", 15, C.s3], ["Reserve", 15, C.gray]] as [string, number, string][], exit: "< 24h", max: "45%", band: "5%" },
  { n: "KAS Yield", k: "iKAS" as AssetSym, risk: "Growth", y: 0.0124, alloc: [["Kaskad iKAS", 70, C.s2], ["Zealous iKAS/USDC", 15, C.s5], ["Reserve", 15, C.gray]] as [string, number, string][], exit: "< 24h", max: "70%", band: "7%" },
];
