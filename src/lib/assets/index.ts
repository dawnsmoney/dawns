import "server-only";
import { unstable_cache } from "next/cache";
import { sql, insertJson, getMeta, setMeta, hasDb, ensureSchema } from "../db";
import type { Snapshot } from "../types";
import { assetId, type Asset, type AssetDay } from "./types";
import { sampleProducers } from "../chain/zkas";
import type { Producers } from "./types";
import { readKas, readZkas, readKrc20, readKrc20Holders, readIgraTokens, readIgraHolders, venuesFromSnapshot, readKaspaNames, nameHolders, readCovenantTokens, readCovenantDepth } from "./sources";

const LIST_EVERY = 55 * 60_000;      // full token lists: hourly
const HOLDERS_EVERY = 24 * 3600_000; // a holder list is refreshed daily
const HOLDERS_PER_TICK = 24;

async function loadAll(): Promise<Asset[]> {
  await ensureSchema(); // pages can render (and build) before the first tick has created the tables
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
    if (p) { a.top10 = p.top10; a.topHolders = p.topHolders; a.holdersAt = p.holdersAt; if (a.holders == null) a.holders = p.holders; if (p.cov) a.cov = p.cov; }
    return a;
  };

  // natives
  const kas = await readKas(s).catch((e) => { report.kas = (e as Error).message; return prev.get("kaspa:native:KAS") ?? null; });
  if (kas) next.set(kas.id, kas);
  const zk = await readZkas(kas?.net?.hashrate ?? null).catch((e) => { report.zkas = (e as Error).message; return prev.get("zkas:native:ZKAS") ?? null; });
  if (zk) {
    next.set(zk.id, zk);
    try {
      const got = await sampleProducers(40);
      const day = new Date().toISOString().slice(0, 10);
      await insertJson("zkas_producers", [["day", "date"], ["producer", "text"], ["blocks", "int"]], got.map((g) => ({ day, ...g })),
        "on conflict (day, producer) do update set blocks = zkas_producers.blocks + excluded.blocks");
      report.zkasSample = got.reduce((x, g) => x + g.blocks, 0);
    } catch (e) { report.zkasSample = (e as Error).message.slice(0, 120); }
    if (zk.net) zk.net.producers = await producerStats(7).catch(() => null);
  }

  // token lists
  const lastList = Number((await getMeta("assets_list_at")) ?? 0);
  const hasCovenant = [...prev.values()].some((x) => x.standard === "kcc20" || x.standard === "kron");
  if (Date.now() - lastList > LIST_EVERY || prev.size < 50 || !hasCovenant) {
    const [krc, igra, cov] = await Promise.all([
      readKrc20().catch((e) => { report.krc20 = (e as Error).message; return null; }),
      readIgraTokens().catch((e) => { report.igra = (e as Error).message; return null; }),
      readCovenantTokens(s.kasUsd).catch((e) => { report.kcc20 = (e as Error).message; return null; }),
    ]);
    for (const a of cov ?? [...prev.values()].filter((x) => x.standard === "kcc20" || x.standard === "kron")) next.set(a.id, keepHolders(a));
    for (const a of krc ?? [...prev.values()].filter((x) => x.standard === "krc20")) next.set(a.id, keepHolders(a));
    for (const a of igra ?? [...prev.values()].filter((x) => x.chain === "igra" && x.standard === "erc20")) next.set(a.id, keepHolders(a));
    if (krc && igra) await setMeta("assets_list_at", String(Date.now()));
    report.lists = { krc20: krc?.length ?? "kept", igra: igra?.length ?? "kept", covenant: cov?.length ?? "kept" };
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
    if (v.price != null) {
      // the headline price follows the site-wide rule (CoinGecko where it lists the token);
      // the pool price is what the token trades at in its own pools on this chain
      const anchored = v.poolPrice == null || Math.abs(v.price / v.poolPrice - 1) > 0.001;
      a.price = v.price;
      a.priceSrc = anchored ? "CoinGecko via DefiLlama" : "dawns: pools and markets read on-chain";
      a.poolPrice = v.poolPrice;
    }
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
        const h = a.standard === "krc20" ? await readKrc20Holders(a.ref)
          : a.standard === "kcc20" || a.standard === "kron" ? await readCovenantDepth(a.ref, a.decimals ?? 0)
          : a.chain === "igra" ? await readIgraHolders(a.ref, a.supply, a.decimals ?? 18) : null;
        a.holdersAt = Date.now();
        if (h) { a.top10 = h.top10; a.topHolders = h.top; read++; }
        if (h && "cov" in h) a.cov = h.cov as Asset["cov"];
        const n = h && "holders" in h ? (h.holders as number | null) : null;
        if (n != null) a.holders = n;
      } catch { /* try again next tick */ }
    }));
  }
  report.holders = `${read}/${due.length}`;

  // name KRC-20 holders (exchanges, burn, funds) from the Kaspa REST API's published list
  const names = await readKaspaNames().catch(() => null);
  if (names) {
    for (const a of next.values()) if ((a.standard === "krc20" || a.standard === "kcc20" || a.standard === "kron") && a.topHolders) a.topHolders = nameHolders(a.topHolders, names);
    report.names = names.size;
  }

  // a week ago, from dawns' own daily record: the nearest day at least 7 days back (within 10)
  const week = (await sql().query("select distinct on (id) id, holders, price from asset_daily where day <= now() - interval '7 days' and day > now() - interval '10 days' order by id, day desc")) as { id: string; holders: number | null; price: number | null }[];
  const ago = new Map(week.map((w) => [w.id, w]));
  for (const a of next.values()) { const w = ago.get(a.id); a.holders7 = w?.holders ?? null; a.price7 = w?.price ?? null; }

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

/** Block producers over the last `days` days of dawns' samples. */
async function producerStats(days: number): Promise<Producers | null> {
  const r = (await sql().query("select producer, sum(blocks)::int as blocks, count(distinct day)::int as d from zkas_producers where day > now() - make_interval(days => $1) group by producer order by 2 desc", [days])) as { producer: string; blocks: number; d: number }[];
  const known = r.filter((x) => x.producer !== "unknown");
  const total = known.reduce((s, x) => s + x.blocks, 0);
  if (total < 50) return null;
  let acc = 0, toMajority = 0;
  for (const x of known) { acc += x.blocks; toMajority++; if (acc > total / 2) break; }
  const span = (await sql().query("select count(distinct day)::int as d from zkas_producers where day > now() - make_interval(days => $1)", [days])) as { d: number }[];
  return {
    days: span[0]?.d ?? 0, sampled: total, distinct: known.length, toMajority,
    top: known.slice(0, 6).map((x) => ({ id: x.producer, share: x.blocks / total })),
    unknown: r.find((x) => x.producer === "unknown")?.blocks ?? 0,
  };
}

export const getAssets = unstable_cache(async (): Promise<Asset[]> => (hasDb() ? loadAll() : []), ["dawns-assets-v1"], { revalidate: 300, tags: ["assets"] });

export const getAssetHistory = unstable_cache(async (id: string): Promise<AssetDay[]> => {
  if (!hasDb()) return [];
  await ensureSchema();
  const r = (await sql().query("select to_char(day, 'YYYY-MM-DD') as day, price, holders, mcap, vol24, supply from asset_daily where id = $1 and day > now() - interval '180 days' order by day", [id])) as AssetDay[];
  return r;
}, ["dawns-asset-history-v1"], { revalidate: 600, tags: ["assets"] });
