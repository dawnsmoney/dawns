import "server-only";
import type { Snapshot } from "../types";
import { assetId, type Asset, type Holder, type HolderKind, type NetworkStats } from "./types";

/**
 * Asset sources. Read-only public APIs; every number is checked before it is used
 * (finite, non-negative), otherwise it stays null and the page says "not measured".
 */
const KASPA_API = "https://api.kaspa.org";
const KASPACOM = "https://api.kaspa.com";
const IGRA_SCOUT = "https://explorer.igralabs.com";
const ZKAS_API = "https://explorer.zkas.info/api";
const ZKAS_OTC = "https://mining-pool.zkas.info/api/otc/price";
const YEAR_S = 31_536_000;
const VENUE: Record<string, string> = { nonkyc: "NonKYC", neoxa: "Neoxa" };

async function get<T = unknown>(url: string, ms = 12_000): Promise<T> {
  const r = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(ms), headers: { accept: "application/json", "user-agent": "dawns.money asset index" } });
  if (!r.ok) throw new Error(`${new URL(url).host}${new URL(url).pathname} → ${r.status}`);
  return (await r.json()) as T;
}
const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
};
/** Big integer strings (sompi, wei) to a float of whole units without losing the magnitude. */
const units = (v: unknown, dec: number): number | null => {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const s = String(v);
  if (!/^\d+$/.test(s)) return num(v);
  if (dec <= 0) return Number(s);
  const whole = s.length > dec ? s.slice(0, s.length - dec) : "0";
  const frac = s.length > dec ? s.slice(s.length - dec) : s.padStart(dec, "0");
  return Number(`${whole}.${frac.slice(0, 12)}`);
};

/**
 * Coins minted over the next 12 months when the block reward steps down by a fixed
 * factor at a fixed interval (Kaspa: monthly, ZKas: every ~7.6 days), optionally to a floor.
 * Using today's reward for a whole year overstates a front-loaded schedule several times over.
 */
export interface Schedule { reward: number; bps: number; firstStepInS: number; stepS: number; factor: number; floor?: number; floorUntilS?: number; after?: number }
/** Coins minted from now until `untilS` seconds ahead, following the schedule. */
export function emissionUntil(o: Schedule, untilS: number) {
  let t = 0, r = o.reward, total = 0, next = Math.max(0, o.firstStepInS);
  const floorAt = (tt: number) => (o.floorUntilS != null && tt >= o.floorUntilS ? o.after ?? o.floor ?? 0 : o.floor ?? 0);
  while (t < untilS) {
    const end = Math.min(untilS, next, o.floorUntilS != null && o.floorUntilS > t ? o.floorUntilS : Infinity);
    total += Math.max(r, floorAt(t)) * o.bps * (end - t);
    t = end;
    if (t >= next) { r *= o.factor; next += o.stepS; }
  }
  return total;
}
export const forwardEmission = (o: Schedule) => emissionUntil(o, YEAR_S);
/** Supply month by month for the next two years. */
export function supplyPath(o: Schedule, circ: number) {
  const M = YEAR_S / 12, now = Date.now();
  return Array.from({ length: 25 }, (_, m) => ({ t: now + m * M * 1000, supply: circ + emissionUntil(o, m * M) }));
}

const blank = (a: Pick<Asset, "id" | "chain" | "standard" | "ref" | "symbol" | "name">): Asset => ({
  ...a, decimals: null, logo: null, price: null, priceSrc: null, mcap: null, vol24: null, volSrc: null,
  supply: null, maxSupply: null, mintedShare: null, premineShare: null, state: null, launched: null,
  holders: null, top10: null, topHolders: null, holdersAt: null, liquidity: null, pools: [], rank: null, updatedAt: Date.now(),
});

// ---------------------------------------------------------------------------
// KAS
// ---------------------------------------------------------------------------
export async function readKas(s: Snapshot): Promise<Asset> {
  const [supply, reward, hash, halving, cg] = await Promise.all([
    get<{ circulatingSupply: string; maxSupply: string }>(`${KASPA_API}/info/coinsupply`),
    get<{ blockreward: number }>(`${KASPA_API}/info/blockreward`),
    get<{ hashrate: number }>(`${KASPA_API}/info/hashrate`),
    get<{ nextHalvingTimestamp: number; nextHalvingAmount: number }>(`${KASPA_API}/info/halving`).catch(() => null),
    get<{ total_volume?: number }[]>("https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=kaspa").catch(() => null),
  ]);
  const a = blank({ id: assetId("kaspa", "native", "KAS"), chain: "kaspa", standard: "native", ref: "KAS", symbol: "KAS", name: "Kaspa" });
  const circ = units(supply.circulatingSupply, 8);
  const bps = 10; // Crescendo: 10 blocks per second
  const r = num(reward.blockreward);
  // Kaspa's reward falls every month by 2^(-1/12): it halves every year
  const firstStep = halving?.nextHalvingTimestamp ? halving.nextHalvingTimestamp - Date.now() / 1000 : 30.44 * 86400;
  const kasSched: Schedule | null = r != null ? { reward: r, bps, firstStepInS: firstStep, stepS: 30.44 * 86400, factor: Math.pow(2, -1 / 12) } : null;
  const perYear = kasSched ? forwardEmission(kasSched) : null;
  Object.assign(a, {
    decimals: 8, supply: circ, maxSupply: units(supply.maxSupply, 8), launched: Date.UTC(2021, 10, 7),
    price: s.kasUsd, priceSrc: "CoinGecko via DefiLlama", mcap: s.kasUsd != null && circ != null ? s.kasUsd * circ : null,
    vol24: num(cg?.[0]?.total_volume), volSrc: cg?.[0]?.total_volume != null ? "CoinGecko, all exchanges" : null,
  });
  const net: NetworkStats = {
    hashrate: num(hash.hashrate) != null ? hash.hashrate * 1e12 : null, difficulty: null, bps, blockReward: r,
    nextReduction: halving && num(halving.nextHalvingAmount) != null ? { at: halving.nextHalvingTimestamp * 1000, amount: halving.nextHalvingAmount } : null,
    emissionPerYear: perYear, inflation: perYear != null && circ ? perYear / circ : null, daa: null,
    emissionBasis: "next 12 months: the reward falls every month and halves each year",
    path: kasSched && circ ? supplyPath(kasSched, circ) : undefined,
  };
  a.net = net;
  return a;
}

// ---------------------------------------------------------------------------
// ZKAS — its explorer's REST API (Kaspa REST shape) and the OTC desk price
// ---------------------------------------------------------------------------
export async function readZkas(kasHashrate: number | null): Promise<Asset> {
  const [dag, supply, reward, halving, shielded, pulse, otc] = await Promise.all([
    get<{ difficulty: number; virtualDaaScore: string }>(`${ZKAS_API}/info/blockdag`),
    get<{ circulatingSupply: string; maxSupply: string | null; emissionModel?: string }>(`${ZKAS_API}/info/coinsupply`),
    get<{ blockreward: number }>(`${ZKAS_API}/info/blockreward`),
    get<{ nextHalvingTimestamp: number; nextHalvingAmount: number; atTailFloor: boolean; currentAmount?: number }>(`${ZKAS_API}/info/halving`).catch(() => null),
    get<{ noteCount: number; nullifierCount: number; turnstileIn: string; turnstileOut: string }>(`${ZKAS_API}/info/shielded`).catch(() => null),
    get<{ bps15m: number }>(`${ZKAS_API}/info/pulse?window=15m`).catch(() => null),
    get<{ zkasUsd: number; stale: boolean; sources?: Record<string, number> }>(ZKAS_OTC).catch(() => null),
  ]);
  const a = blank({ id: assetId("zkas", "native", "ZKAS"), chain: "zkas", standard: "native", ref: "ZKAS", symbol: "ZKAS", name: "ZKas" });
  const circ = units(supply.circulatingSupply, 8);
  const diff = num(dag.difficulty);
  // kHeavyHash difficulty → hashrate at the 1 block/s target (the explorer's own derivation)
  const hashrate = diff != null ? diff * 2 : null;
  const r = num(reward.blockreward);
  const bps = num(pulse?.bps15m) ?? 1;
  // Its schedule: a step down about every 7.6 days (factor read from the chain's own next step),
  // to a 6 ZKAS tail at ~month 10, then 0.6 ZKAS forever from month 24 after launch.
  const launch = Date.UTC(2026, 6, 26) / 1000;
  const factor = halving && r ? halving.nextHalvingAmount / r : null;
  const zkSched: Schedule | null = r != null && halving && factor && factor > 0 && factor < 1
    ? { reward: r, bps: 1, firstStepInS: halving.nextHalvingTimestamp - Date.now() / 1000, stepS: 7.6 * 86400, factor, floor: 6, floorUntilS: launch + 2 * YEAR_S - Date.now() / 1000, after: 0.6 }
    : null;
  const perYear = zkSched ? forwardEmission(zkSched) : null;
  const venues = otc?.sources ? Object.keys(otc.sources) : [];
  const px = otc && !otc.stale ? num(otc.zkasUsd) : null;
  Object.assign(a, {
    decimals: 8, supply: circ, maxSupply: null, launched: Date.UTC(2026, 6, 26),
    price: px, priceSrc: px != null ? `OTC desk quote${venues.length ? ` (${venues.map((v) => VENUE[v] ?? v).join(", ")})` : ""}` : null,
    mcap: px != null && circ != null ? px * circ : null,
  });
  a.net = {
    hashrate, difficulty: diff, bps, blockReward: r,
    nextReduction: halving && !halving.atTailFloor && num(halving.nextHalvingAmount) != null ? { at: halving.nextHalvingTimestamp * 1000, amount: halving.nextHalvingAmount } : null,
    emissionPerYear: perYear, inflation: perYear != null && circ ? perYear / circ : null,
    emissionBasis: "next 12 months on its published schedule: a step down every ~7.6 days to a 6 ZKAS tail",
    path: zkSched && circ ? supplyPath(zkSched, circ) : undefined,
    mergedShare: hashrate != null && kasHashrate ? hashrate / kasHashrate : null,
    shielded: shielded ? { notes: shielded.noteCount, nullifiers: shielded.nullifierCount, turnstileIn: units(shielded.turnstileIn, 8) ?? 0, turnstileOut: units(shielded.turnstileOut, 8) ?? 0 } : null,
    daa: num(dag.virtualDaaScore),
  };
  return a;
}

// ---------------------------------------------------------------------------
// KRC-20 — KaspaCom market data (ranked list, marketplace trades, holders)
// ---------------------------------------------------------------------------
interface KcToken {
  ticker: string; creationDate?: number; totalSupply?: number; totalMinted?: number; preMintedSupply?: number;
  totalHolders?: number; state?: string; volumeUsd?: number; volume7dUsd?: number; price?: number; rank?: number; logoUrl?: string;
}
export async function readKrc20(): Promise<Asset[]> {
  const out = new Map<string, Asset>();
  for (let skip = 0; skip < 5_000; skip += 100) {
    const page = await get<KcToken[]>(`${KASPACOM}/api/market-data?skip=${skip}&limit=100`, 20_000);
    if (!Array.isArray(page) || !page.length) break;
    for (const t of page) {
      if (typeof t.ticker !== "string" || !/^[A-Z0-9]{2,10}$/i.test(t.ticker)) continue;
      const id = assetId("kaspa", "krc20", t.ticker);
      const max = num(t.totalSupply), minted = num(t.totalMinted), pre = num(t.preMintedSupply);
      // KaspaCom keeps the last trade price forever. A token that has not traded for a week
      // has no market price: valuing its whole supply at a months-old trade is how a
      // 43-holder token shows up as worth quadrillions.
      const traded7d = (num(t.volume7dUsd) ?? 0) > 0 || (num(t.volumeUsd) ?? 0) > 0;
      const px = traded7d ? num(t.price) : null;
      const a = blank({ id, chain: "kaspa", standard: "krc20", ref: t.ticker.toUpperCase(), symbol: t.ticker.toUpperCase(), name: t.ticker.toUpperCase() });
      Object.assign(a, {
        decimals: 8, logo: t.logoUrl || null, supply: minted, maxSupply: max,
        mintedShare: max && minted != null ? minted / max : null, premineShare: max && pre != null ? pre / max : null,
        state: t.state === "finished" ? "finished" : t.state === "deployed" ? "minting" : t.state ?? null,
        launched: num(t.creationDate), holders: num(t.totalHolders), rank: num(t.rank),
        price: px && px > 0 ? px : null, priceSrc: px && px > 0 ? "KaspaCom marketplace trades" : null,
        mcap: px && px > 0 && minted != null ? px * minted : null,
        vol24: num(t.volumeUsd), vol7: num(t.volume7dUsd), volSrc: "KaspaCom marketplace, 24h",
      });
      out.set(id, a);
    }
    if (page.length < 100) break;
  }
  if (out.size < 50) throw new Error(`KaspaCom returned only ${out.size} tokens`);
  return [...out.values()];
}

/** Top holders of a KRC-20 (KaspaCom lists the 100 largest). */
export async function readKrc20Holders(tick: string): Promise<{ top10: number | null; top: Holder[]; holders: number | null } | null> {
  const t = await get<{ totalMinted?: number; totalHolders?: number; devWallet?: string; topHolders?: { address: string; balance: number }[] }>(`${KASPACOM}/api/token-info/${encodeURIComponent(tick)}`);
  const minted = num(t.totalMinted);
  if (!minted || !Array.isArray(t.topHolders)) return null;
  const top = t.topHolders.slice(0, 10).map((h) => ({
    address: h.address, share: (num(h.balance) ?? 0) / minted, contract: false,
    label: t.devWallet && h.address === t.devWallet ? "Deployer (dev wallet)" : null,
  }));
  return { top10: top.reduce((x, h) => x + h.share, 0), top, holders: num(t.totalHolders) };
}

// ---------------------------------------------------------------------------
// Igra ERC-20 — Blockscout token list and holders
// ---------------------------------------------------------------------------
interface ScoutToken { address_hash: string; name: string | null; symbol: string | null; decimals: string | null; total_supply: string | null; holders_count: string | null; exchange_rate: string | null; icon_url: string | null; volume_24h: string | null; reputation?: string }
const IS_LP = /\bLPs?\b|UNI-V2|-LP\b|\bLP-|Liquidity Provider/i;
/** Receipts of a position (lending aTokens, debt tokens) and test tokens are not assets. */
const IS_RECEIPT = /Variable Debt|Stable Debt|^Kaskad\s|Heartbeat|Debug|GradTest|\btest\b/i;

export async function readIgraTokens(): Promise<Asset[]> {
  const out: Asset[] = [];
  let q = "type=ERC-20";
  for (let i = 0; i < 12; i++) {
    const r = await get<{ items: ScoutToken[]; next_page_params: Record<string, unknown> | null }>(`${IGRA_SCOUT}/api/v2/tokens?${q}`, 20_000);
    for (const t of r.items ?? []) {
      if (!t.address_hash || !t.symbol) continue;
      if (IS_LP.test(`${t.name ?? ""} ${t.symbol}`)) continue;          // LP shares are positions, not assets
      if (IS_RECEIPT.test(t.name ?? "")) continue;
      if (t.reputation && t.reputation !== "ok") continue;               // Blockscout flags scams / spam
      const dec = num(t.decimals) ?? 18;
      const a = blank({ id: assetId("igra", "erc20", t.address_hash), chain: "igra", standard: "erc20", ref: t.address_hash.toLowerCase(), symbol: t.symbol.slice(0, 20), name: (t.name ?? t.symbol).slice(0, 60) });
      const ref = num(t.exchange_rate);
      Object.assign(a, {
        decimals: dec, logo: t.icon_url || null, supply: units(t.total_supply ?? "", dec), holders: num(t.holders_count),
        price: ref && ref > 0 ? ref : null, priceSrc: ref && ref > 0 ? "Igra explorer (Blockscout)" : null,
      });
      out.push(a);
    }
    if (!r.next_page_params) break;
    q = "type=ERC-20&" + new URLSearchParams(Object.entries(r.next_page_params).map(([k, v]) => [k, String(v)])).toString();
  }
  return out;
}

export async function readIgraHolders(addr: string, supply: number | null, dec: number): Promise<{ top10: number | null; top: Holder[] } | null> {
  if (!supply) return null;
  const r = await get<{ items: { address: { hash: string; is_contract?: boolean; name?: string | null }; value: string }[] }>(`${IGRA_SCOUT}/api/v2/tokens/${addr}/holders`);
  const top = (r.items ?? []).slice(0, 10).map((h) => ({
    address: h.address.hash, share: (units(h.value, dec) ?? 0) / supply, contract: !!h.address.is_contract, label: h.address.name ?? null,
  }));
  return { top10: top.reduce((x, h) => x + h.share, 0), top };
}

// ---------------------------------------------------------------------------
// what dawns reads itself: DEX prices, pool liquidity, lending markets
// ---------------------------------------------------------------------------
export interface Venue { liquidity: number; price: number | null; poolPrice: number | null; pools: string[]; symbol: string; decimals: number }
/** Per token address (lower case), per chain: dawns' own DEX price and the liquidity it sits in. */
export function venuesFromSnapshot(s: Snapshot): Map<string, Venue> {
  const m = new Map<string, Venue>();
  const at = (chain: string, addr: string, symbol: string, decimals: number) => {
    const k = `${chain}:${addr.toLowerCase()}`;
    let v = m.get(k);
    if (!v) { v = { liquidity: 0, price: null, poolPrice: null, pools: [], symbol, decimals }; m.set(k, v); }
    return v;
  };
  for (const p of s.protocols) {
    for (const pool of p.dex?.pools ?? []) {
      pool.tk.forEach((t, i) => {
        const v = at(pool.chain, t.a, pool.symbols[i], t.d);
        v.liquidity += pool.usd / 2;
        if (t.px != null && v.price == null) v.price = t.px;
        if (t.pp != null && v.poolPrice == null) v.poolPrice = t.pp;
        if (pool.usd >= 5_000) v.pools.push(`${p.id}:${pool.pair.toLowerCase()}`);
      });
    }
    for (const mk of p.lending?.markets ?? []) {
      const v = at("igra", mk.asset, mk.symbol, mk.decimals);
      if (v.price == null && mk.price > 0) v.price = mk.price;
      v.pools.push(`${p.id}:${mk.symbol}`);
    }
  }
  return m;
}

// ---------------------------------------------------------------------------
// Kaspa address names: the list the Kaspa REST API publishes (exchanges, burn, funds)
// ---------------------------------------------------------------------------
const EXCHANGES = /\b(gate|kucoin|bybit|bitget|coinex|mexc|biconomy|xeggex|bitmart|htx|huobi|okx|binance|kraken|bitvavo|uphold|tradeogre|nonkyc|lbank|ascendex|probit|bitpanda|coinstore|bingx|toobit|weex|safetrade|exbitron|chainex|bitfinex|coinbase|crypto\.com|poloniex|hotcoin|digifinex|bitunix|xt\.com|pionex|bitrue|hitbtc|bitkub|indodax)\b/i;
export async function readKaspaNames(): Promise<Map<string, string>> {
  const r = await get<{ address: string; name: string }[]>(`${KASPA_API}/addresses/names`);
  return new Map((Array.isArray(r) ? r : []).filter((x) => typeof x.address === "string" && typeof x.name === "string").map((x) => [x.address, x.name.slice(0, 60)]));
}
export const holderKind = (name: string | null): HolderKind =>
  !name ? null : EXCHANGES.test(name) ? "exchange" : /burn/i.test(name) ? "burn" : /fund|treasury|dev|team|launchpad|marketing/i.test(name) ? "project" : null;
/** Name KRC-20 holders from the published list; keep a deployer label if there is one. */
export function nameHolders(top: Holder[] | null, names: Map<string, string>): Holder[] | null {
  if (!top) return top;
  return top.map((h) => { const n = names.get(h.address) ?? null; const label = n ?? h.label; return { ...h, label, kind: n ? holderKind(n) : h.label?.startsWith("Deployer") ? "project" : h.kind ?? null }; });
}
