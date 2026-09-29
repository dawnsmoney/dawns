import "server-only";
import { unstable_cache } from "next/cache";
import { sql, hasDb } from "./db";
import type { IntelRaw } from "./intel";

/** Daily averages of dawns' own 10-minute readings, last 31 days. */
async function load(): Promise<IntelRaw> {
  const empty: IntelRaw = { markets: [], pools: [], vol: [], tvl: [], eco: [], volStart: null };
  if (!hasDb()) return empty;
  const q = sql();
  type R = Record<string, unknown>;
  const safe = (p: Promise<unknown>) => (p as Promise<R[]>).catch(() => [] as R[]);
  const n = (x: unknown) => (x == null ? 0 : Number(x));
  const nn = (x: unknown) => (x == null ? null : Number(x));
  const D = `extract(epoch from date_trunc('day', taken_at)) * 1000`;
  const [markets, pools, vol, tvl, eco, start] = await Promise.all([
    safe(q.query(`select protocol, market, ${D} as day, avg(supply_apy) as apy, avg(supplied_usd) as supplied, avg(cash_usd) as cash, avg(util) as util,
        avg(supplied_usd / nullif(coalesce(oracle_price, market_price), 0)) as qty
      from market_metrics where taken_at > now() - interval '31 days' group by 1, 2, 3`)),
    safe(q.query(`select protocol, lower(pair) as pair, ${D} as day, avg(usd) as usd, avg(reserve0) as r0, avg(reserve1) as r1
      from pool_metrics where taken_at > now() - interval '31 days' group by 1, 2, 3`)),
    safe(q.query(`select lower(pair) as pair, extract(epoch from date_trunc('day', t)) * 1000 as day, sum(usd) as usd, count(*) as swaps
      from dex_events where kind = 'swap' and t > now() - interval '31 days' group by 1, 2`)),
    safe(q.query(`select protocol, ${D} as day, avg(tvl) as v from protocol_metrics where taken_at > now() - interval '31 days' group by 1, 2`)),
    safe(q.query(`select ${D} as day, avg(eco_tvl) as v, avg(kas_usd) as kas from snapshots where taken_at > now() - interval '31 days' group by 1 order by 1`)),
    safe(q.query(`select extract(epoch from min(t)) * 1000 as t from dex_events`)),
  ]);
  return {
    markets: markets.map((r) => ({ protocol: String(r.protocol), market: String(r.market), day: n(r.day), apy: n(r.apy), supplied: n(r.supplied), cash: n(r.cash), util: n(r.util), qty: nn(r.qty) })),
    pools: pools.map((r) => ({ protocol: String(r.protocol), pair: String(r.pair), day: n(r.day), usd: n(r.usd), r0: n(r.r0), r1: n(r.r1) })),
    vol: vol.map((r) => ({ pair: String(r.pair), day: n(r.day), usd: n(r.usd), swaps: n(r.swaps) })),
    tvl: tvl.map((r) => ({ protocol: String(r.protocol), day: n(r.day), v: n(r.v) })),
    eco: eco.map((r) => ({ day: n(r.day), v: n(r.v), kas: nn(r.kas) })),
    volStart: nn(start[0]?.t),
  };
}

export const getIntelRaw = unstable_cache(load, ["dawns-intel-v1"], { revalidate: 600, tags: ["intel"] });
