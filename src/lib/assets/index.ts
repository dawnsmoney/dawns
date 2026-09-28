import "server-only";
import { unstable_cache } from "next/cache";
import { sql, insertJson, getMeta, setMeta, hasDb } from "../db";
import type { Snapshot } from "../types";
import { assetId, type Asset, type AssetDay } from "./types";
import { readKas, readZkas, readKrc20, readKrc20Holders, readIgraTokens, readIgraHolders, venuesFromSnapshot } from "./sources";

const LIST_EVERY = 55 * 60_000;      // full token lists: hourly
const HOLDERS_EVERY = 24 * 3600_000; // a holder list is refreshed daily
const HOLDERS_PER_TICK = 24;

async function loadAll(): Promise<Asset[]> {
  const r = (await sql().query("select data from assets where updated_at > now() - interval '7 days'")) as { data: Asset }[];
  return r.map((x) => x.data);
}

/**
 * One tick of the asset index. Natives every tick; token lists hourly; holder lists
 * for the most significant assets, stalest first. Prices and liquidity dawns reads
 * itself (DEX pools, lending markets) are applied on every tick.
 */
export async function refreshAssets(s: Snapshot) {
  const report: Record<string, unknown> = {};
  const prev = new Map((await loadAll()).map((a) => [a.id, a]));
  const next = new Map<string, Asset>();
  const keepHolders = (a: Asset) => {
    const p = prev.get(a.id);
    if (p) { a.top10 = p.top10; a.topHolders = p.topHolders; a.holdersAt = p.holdersAt; if (a.holders == null) a.holders = p.holders; }
    return a;
  };

  // natives
  const kas = await readKas(s).catch((e) => { report.kas = (e as Error).message; return prev.get("kaspa:native:KAS") ?? null; });
  if (kas) next.set(kas.id, kas);
  const zk = await readZkas(kas?.net?.hashrate ?? null).catch((e) => { report.zkas = (e as Error).message; return prev.get("zkas:native:ZKAS") ?? null; });
  if (zk) next.set(zk.id, zk);

  // token lists
  const lastList = Number((await getMeta("assets_list_at")) ?? 0);
  if (Date.now() - lastList > LIST_EVERY || prev.size < 50) {
    const [krc, igra] = await Promise.all([
      readKrc20().catch((e) => { report.krc20 = (e as Error).message; return null; }),
      readIgraTokens().catch((e) => { report.igra = (e as Error).message; return null; }),
    ]);
    for (const a of krc ?? [...prev.values()].filter((x) => x.standard === "krc20")) next.set(a.id, keepHolders(a));
    for (const a of igra ?? [...prev.values()].filter((x) => x.chain === "igra" && x.standard === "erc20")) next.set(a.id, keepHolders(a));
    if (krc && igra) await setMeta("assets_list_at", String(Date.now()));
    report.lists = { krc20: krc?.length ?? "kept", igra: igra?.length ?? "kept" };
  } else {
    for (const a of prev.values()) if (a.standard !== "native") next.set(a.id, a);
  }

  // what dawns reads itself
  const venues = venuesFromSnapshot(s);
  for (const [k, v] of venues) {
    const [chain, addr] = k.split(":") as ["igra" | "kasplex", string];
    const id = assetId(chain, "erc20", addr);
    let a = next.get(id);
    if (!a && chain === "kasplex") {
      // Kasplex L2 has no public token list dawns can use yet: its assets are the ones in pools dawns reads
      a = { ...(prev.get(id) ?? {}), id, chain, standard: "erc20", ref: addr, symbol: v.symbol, name: v.symbol, decimals: v.decimals, logo: null,
        price: null, priceSrc: null, mcap: null, vol24: null, volSrc: null, supply: null, maxSupply: null, mintedShare: null, premineShare: null,
        state: null, launched: null, holders: null, top10: null, topHolders: null, holdersAt: null, liquidity: null, pools: [], rank: null, updatedAt: Date.now() } as Asset;
      next.set(id, a);
    }
    if (!a) continue;
    a.liquidity = v.liquidity;
    a.pools = [...new Set(v.pools)];
    if (v.price != null) { a.price = v.price; a.priceSrc = "dawns: DEX pools and lending markets read on-chain"; }
    a.updatedAt = Date.now();
  }
  // KAS itself is what the WiKAS / iKAS pools price; link its opportunities too
  if (kas) {
    const k = [...venues.values()].filter((v) => /^w?i?kas$/i.test(v.symbol));
    kas.pools = [...new Set(k.flatMap((v) => v.pools))];
    kas.liquidity = k.reduce((x, v) => x + v.liquidity, 0) || null;
  }
  for (const a of next.values()) if (a.price != null && a.supply != null && a.standard !== "native") a.mcap = a.price * a.supply;

  // holder lists: the most significant first, stalest first
  const due = [...next.values()]
    .filter((a) => a.standard !== "native" && (a.holdersAt == null || Date.now() - a.holdersAt > HOLDERS_EVERY))
    .sort((x, y) => (y.mcap ?? y.liquidity ?? 0) - (x.mcap ?? x.liquidity ?? 0) || (y.holders ?? 0) - (x.holders ?? 0))
    .slice(0, HOLDERS_PER_TICK);
  let read = 0;
  for (let i = 0; i < due.length; i += 6) {
    await Promise.all(due.slice(i, i + 6).map(async (a) => {
      try {
        const h = a.standard === "krc20" ? await readKrc20Holders(a.ref) : a.chain === "igra" ? await readIgraHolders(a.ref, a.supply, a.decimals ?? 18) : null;
        a.holdersAt = Date.now();
        if (h) { a.top10 = h.top10; a.topHolders = h.top; read++; }
        const n = h && "holders" in h ? (h.holders as number | null) : null;
        if (n != null) a.holders = n;
      } catch { /* try again next tick */ }
    }));
  }
  report.holders = `${read}/${due.length}`;

  const rows = [...next.values()];
  await insertJson("assets", [["id", "text"], ["chain", "text"], ["standard", "text"], ["symbol", "text"], ["data", "jsonb"]],
    rows.map((a) => ({ id: a.id, chain: a.chain, standard: a.standard, symbol: a.symbol, data: a })),
    "on conflict (id) do update set data = excluded.data, symbol = excluded.symbol, updated_at = now()");
  const day = new Date().toISOString().slice(0, 10);
  await insertJson("asset_daily", [["id", "text"], ["day", "date"], ["price", "float8"], ["holders", "float8"], ["mcap", "float8"], ["vol24", "float8"], ["supply", "float8"]],
    rows.filter((a) => a.price != null || a.holders != null).map((a) => ({ id: a.id, day, price: a.price, holders: a.holders, mcap: a.mcap, vol24: a.vol24, supply: a.supply })),
    "on conflict (id, day) do update set price = excluded.price, holders = excluded.holders, mcap = excluded.mcap, vol24 = excluded.vol24, supply = excluded.supply");
  report.assets = rows.length;
  return report;
}

export const getAssets = unstable_cache(async (): Promise<Asset[]> => (hasDb() ? loadAll() : []), ["dawns-assets-v1"], { revalidate: 300, tags: ["assets"] });

export const getAssetHistory = unstable_cache(async (id: string): Promise<AssetDay[]> => {
  if (!hasDb()) return [];
  const r = (await sql().query("select to_char(day, 'YYYY-MM-DD') as day, price, holders, mcap, vol24, supply from asset_daily where id = $1 and day > now() - interval '180 days' order by day", [id])) as AssetDay[];
  return r;
}, ["dawns-asset-history-v1"], { revalidate: 600, tags: ["assets"] });
