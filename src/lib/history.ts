import "server-only";
import { sql, hasDb } from "./db";
import type { Activity, ActivityEvent, Pt } from "./types";

/** Everything the snapshot takes from dawns' own database: history, indexed events, bridge payouts. */
export interface OwnData {
  series: Map<string, Pt[]>;          // protocol → hourly TVL, 7 days
  at24: Map<string, number>;          // protocol → TVL about 24h ago
  eco: Pt[];                          // hourly ecosystem TVL
  backing: Pt[];                      // hourly iKAS backing ratio
  activity: Map<string, Activity>;
  indexedSince: number | null;        // ms: the later of the two chains' index start
  indexedUpTo: number | null;         // ms: the earlier of the two chains' cursor timestamps
  exits: ExitRow[];
  pairs: Map<string, { vol24: number; vol7: number; swaps24: number }>;
  fees: Map<string, { median: number; n: number }>;
  kaskad: { accounts: number; unread: number; updatedAt: number; rows: { address: string; coll: number; debt: number; hf: number | null }[] } | null;      // protocol → median fee real swaps paid, 7 days
  pairRange: Map<string, { min: number; max: number; hours: number }>;   // price of token0 in token1
  marketRange: Map<string, { apyMin: number; apyMax: number; utilMin: number; utilMax: number; hours: number }>; // "protocol:SYMBOL"
  exitStats: { indexed: number; unchecked: number; paid: number; unpaid: number; unpaidKas: number; late: number; lateKas: number; medianHours: number | null; checkedSince: number | null };
}
export interface ExitRow { tx: string; request_id: number | null; block: number; at: number; payout: string; kas: number; paid_tx: string | null; paid_at: number | null; paid_kas: number | null }

const n = (x: unknown) => (x == null ? 0 : Number(x));

export async function readOwn(): Promise<OwnData | null> {
  if (!hasDb()) return null;
  const q = sql();
  const safe = <T,>(p: Promise<unknown>) => (p as Promise<T>).catch(() => [] as unknown as T); // tables may not exist before the first tick
  type R = Record<string, unknown>;
  const [hourly, back24, eco, backing, dexAgg, dexDays, lendAgg, top, meta, exits, exitStats, pairAgg, pairRng, mktRng, feeAgg, kPos, kAcc] = await Promise.all([
    safe<R[]>(q.query(`select protocol, extract(epoch from date_trunc('hour', taken_at)) * 1000 as t, avg(tvl) as v
      from protocol_metrics where taken_at > now() - interval '7 days' group by 1, 2 order by 2`)),
    safe<R[]>(q.query(`select distinct on (protocol) protocol, tvl from protocol_metrics
      where taken_at between now() - interval '25 hours' and now() - interval '23 hours'
      order by protocol, abs(extract(epoch from taken_at - (now() - interval '24 hours')))`)),
    safe<R[]>(q.query(`select extract(epoch from date_trunc('hour', taken_at)) * 1000 as t, avg(eco_tvl) as v
      from snapshots where taken_at > now() - interval '7 days' group by 1 order by 1`)),
    safe<R[]>(q.query(`select extract(epoch from date_trunc('hour', taken_at)) * 1000 as t, avg(coverage) as v
      from bridge_metrics where taken_at > now() - interval '7 days' group by 1 order by 1`)),
    safe<R[]>(q.query(`select protocol,
        count(*) filter (where kind = 'swap' and t > now() - interval '24 hours') as swaps24,
        coalesce(sum(usd) filter (where kind = 'swap' and t > now() - interval '24 hours'), 0) as vol24,
        coalesce(sum(usd) filter (where kind = 'swap' and t > now() - interval '7 days'), 0) as vol7
      from dex_events group by protocol`)),
    safe<R[]>(q.query(`select protocol, extract(epoch from date_trunc('day', t)) * 1000 as t, sum(usd) as v
      from dex_events where kind = 'swap' and t > now() - interval '8 days' group by 1, 2 order by 2`)),
    safe<R[]>(q.query(`select protocol, market, kind, sum(usd) as v from lending_events
      where t > now() - interval '24 hours' group by 1, 2, 3`)),
    safe<R[]>(q.query(`select * from (
        select *, row_number() over (partition by protocol order by usd desc) as rn from (
          select protocol, kind, usd, label, tx, chain, extract(epoch from t) * 1000 as t from dex_events where t > now() - interval '7 days' and kind = 'remove'
          union all
          select protocol, kind, usd, label, tx, chain, extract(epoch from t) * 1000 as t from dex_events where t > now() - interval '7 days' and kind = 'swap' and usd >= 1000
          union all
          select protocol, kind, usd, market as label, tx, chain, extract(epoch from t) * 1000 as t from lending_events where t > now() - interval '7 days'
        ) x) y where rn <= 12`)),
    safe<R[]>(q.query(`select k, v from meta where k like 'idx%'`)),
    safe<R[]>(q.query(`select tx, request_id, block, extract(epoch from requested_at) * 1000 as at, payout_address as payout,
        amount_sompi / 1e8 as kas, paid_tx, extract(epoch from paid_at) * 1000 as paid_at, paid_sompi / 1e8 as paid_kas
      from bridge_exits order by block desc, tx limit 60`)),
    safe<R[]>(q.query(`select count(*) as indexed,
        count(*) filter (where checks = 0) as unchecked,
        count(paid_tx) as paid,
        count(*) filter (where paid_tx is null and checks > 0) as unpaid,
        coalesce(sum(amount_sompi) filter (where paid_tx is null and checks > 0 and requested_at > now() - interval '30 days'), 0) / 1e8 as unpaid_kas,
        count(*) filter (where paid_tx is null and checks > 0 and requested_at < now() - interval '72 hours' and requested_at > now() - interval '30 days') as late,
        coalesce(sum(amount_sompi) filter (where paid_tx is null and checks > 0 and requested_at < now() - interval '72 hours' and requested_at > now() - interval '30 days'), 0) / 1e8 as late_kas,
        percentile_cont(0.5) within group (order by extract(epoch from paid_at - requested_at) / 3600) filter (where paid_tx is not null and requested_at > now() - interval '30 days') as median_h,
        extract(epoch from min(last_checked) filter (where paid_tx is null and requested_at > now() - interval '30 days')) * 1000 as checked_since
      from bridge_exits`)),
    safe<R[]>(q.query(`select pair,
        coalesce(sum(usd) filter (where t > now() - interval '24 hours'), 0) as vol24,
        coalesce(sum(usd), 0) as vol7,
        count(*) filter (where t > now() - interval '24 hours') as swaps24
      from dex_events where kind = 'swap' and t > now() - interval '7 days' group by pair`)),
    safe<R[]>(q.query(`select pair, min(reserve1 / reserve0) as lo, max(reserve1 / reserve0) as hi,
        extract(epoch from max(taken_at) - min(taken_at)) / 3600 as hours
      from pool_metrics where taken_at > now() - interval '7 days' and reserve0 > 0 and reserve1 > 0 group by pair`)),
    safe<R[]>(q.query(`select protocol || ':' || market as k, min(supply_apy) as apy_lo, max(supply_apy) as apy_hi,
        min(util) as util_lo, max(util) as util_hi, extract(epoch from max(taken_at) - min(taken_at)) / 3600 as hours
      from market_metrics where taken_at > now() - interval '7 days' group by 1`)),
    safe<R[]>(q.query(`select protocol, percentile_cont(0.5) within group (order by fee) as median, count(*) as n
      from fee_samples where t > now() - interval '7 days' group by protocol`)),
    safe<R[]>(q.query(`select address, collateral_usd as coll, debt_usd as debt, hf, extract(epoch from updated_at) * 1000 as at
      from kaskad_positions where updated_at > now() - interval '2 hours' and (collateral_usd > 0.01 or debt_usd > 0.01)`)),
    safe<R[]>(q.query(`select count(*) as n from kaskad_accounts`)),
  ]);

  const series = new Map<string, Pt[]>();
  for (const r of hourly) { const id = String(r.protocol); series.set(id, [...(series.get(id) ?? []), { t: n(r.t), v: n(r.v) }]); }
  const at24 = new Map(back24.map((r) => [String(r.protocol), n(r.tvl)]));

  const m = Object.fromEntries(meta.map((r) => [String(r.k), String(r.v)]));
  const starts = ["igra", "kasplex"].map((c) => (m[`idx_start:${c}`] ? Number(m[`idx_start:${c}`]) : null)).filter((x): x is number => x != null);
  const indexedSince = starts.length ? Math.max(...starts) : null;
  const ats = ["igra", "kasplex"].map((c) => (m[`idx_at:${c}`] ? Number(m[`idx_at:${c}`]) : null));
  const indexedUpTo = ats.every((x) => x != null) ? Math.min(...(ats as number[])) : null;

  const activity = new Map<string, Activity>();
  const get = (id: string) => {
    let a = activity.get(id);
    if (!a) { a = { since: indexedSince ?? Date.now(), upTo: indexedUpTo ?? 0, swaps24: 0, vol24: 0, vol7: null, volDays: [], lendFlows: [], events: [] }; activity.set(id, a); }
    return a;
  };
  const caughtUp = indexedUpTo != null && indexedUpTo > Date.now() - 45 * 60_000;
  const covered = caughtUp && indexedSince != null ? Date.now() - indexedSince : 0;
  for (const r of dexAgg) { const a = get(String(r.protocol)); a.swaps24 = n(r.swaps24); a.vol24 = n(r.vol24); a.vol7 = covered >= 6.9 * 86_400_000 ? n(r.vol7) : null; }
  for (const r of dexDays) get(String(r.protocol)).volDays.push({ t: n(r.t), v: n(r.v) });
  for (const r of lendAgg) {
    const a = get(String(r.protocol));
    let row = a.lendFlows.find((x) => x.market === r.market);
    if (!row) { row = { market: String(r.market), supply: 0, withdraw: 0, borrow: 0, repay: 0, liquidations: 0 }; a.lendFlows.push(row); }
    const k = String(r.kind) === "liquidation" ? "liquidations" : (String(r.kind) as "supply" | "withdraw" | "borrow" | "repay");
    row[k] += n(r.v);
  }
  for (const r of top) get(String(r.protocol)).events.push({ t: n(r.t), kind: String(r.kind) as ActivityEvent["kind"], usd: n(r.usd), label: String(r.label ?? ""), tx: String(r.tx), chain: String(r.chain) as ActivityEvent["chain"] });
  activity.forEach((a) => a.events.sort((x, y) => y.usd - x.usd));

  const s = exitStats[0] ?? {};
  return {
    series, at24, activity, indexedSince, indexedUpTo,
    kaskad: kPos.length ? {
      accounts: n(kAcc[0]?.n), unread: 0, updatedAt: Math.max(...kPos.map((r) => n(r.at))),
      rows: kPos.map((r) => ({ address: String(r.address), coll: n(r.coll), debt: n(r.debt), hf: r.hf == null ? null : n(r.hf) })),
    } : null,
    fees: new Map(feeAgg.map((r) => [String(r.protocol), { median: n(r.median), n: n(r.n) }])),
    pairs: new Map(pairAgg.map((r) => [String(r.pair).toLowerCase(), { vol24: n(r.vol24), vol7: n(r.vol7), swaps24: n(r.swaps24) }])),
    pairRange: new Map(pairRng.map((r) => [String(r.pair).toLowerCase(), { min: n(r.lo), max: n(r.hi), hours: n(r.hours) }])),
    marketRange: new Map(mktRng.map((r) => [String(r.k), { apyMin: n(r.apy_lo), apyMax: n(r.apy_hi), utilMin: n(r.util_lo), utilMax: n(r.util_hi), hours: n(r.hours) }])),
    eco: eco.map((r) => ({ t: n(r.t), v: n(r.v) })),
    backing: backing.map((r) => ({ t: n(r.t), v: n(r.v) })),
    exits: exits.map((r) => ({ tx: String(r.tx), request_id: r.request_id == null ? null : n(r.request_id), block: n(r.block), at: n(r.at), payout: String(r.payout), kas: n(r.kas), paid_tx: (r.paid_tx as string) ?? null, paid_at: r.paid_at == null ? null : n(r.paid_at), paid_kas: r.paid_kas == null ? null : n(r.paid_kas) })),
    exitStats: {
      indexed: n(s.indexed), unchecked: n(s.unchecked), paid: n(s.paid), unpaid: n(s.unpaid), unpaidKas: n(s.unpaid_kas), late: n(s.late), lateKas: n(s.late_kas),
      medianHours: s.median_h == null ? null : n(s.median_h), checkedSince: s.checked_since == null ? null : n(s.checked_since),
    },
  };
}
