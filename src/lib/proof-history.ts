import "server-only";
import { unstable_cache } from "next/cache";
import { sql, hasDb } from "./db";
import type { Proof } from "./proof";
import type { Snapshot } from "./types";

/** Reserves against what is owed, hourly, from dawns' own readings (30 days). */
export interface ProofHistory { t: number[]; reserves: number[]; owed: number[]; kind: "both" | "reserves" | "ratio" }

type R = Record<string, unknown>;
const n = (x: unknown) => (x == null ? 0 : Number(x));

async function load(id: string, kind: Proof["kind"]): Promise<ProofHistory | null> {
  if (!hasDb()) return null;
  const q = sql();
  let rows: R[] = [];
  try {
    if (kind === "bridge") {
      rows = (await q.query(`select extract(epoch from date_trunc('hour', taken_at)) * 1000 as t, avg(locked_kas) as a, avg(ikas_supply) as o
        from bridge_metrics where taken_at > now() - interval '30 days' group by 1 order by 1`)) as unknown as R[];
    } else if (kind === "lending") {
      rows = (await q.query(`select extract(epoch from date_trunc('hour', taken_at)) * 1000 as t, avg(a) as a, avg(o) as o from (
          select taken_at, sum(cash_usd + borrowed_usd) as a, sum(supplied_usd) as o from market_metrics
          where protocol = $1 and taken_at > now() - interval '30 days' group by taken_at) x group by 1 order by 1`, [id])) as unknown as R[];
    } else {
      rows = (await q.query(`select extract(epoch from date_trunc('hour', taken_at)) * 1000 as t, avg(tvl) as a, avg(tvl) as o
        from protocol_metrics where protocol = $1 and taken_at > now() - interval '30 days' group by 1 order by 1`, [id])) as unknown as R[];
    }
  } catch { return null; }
  if (rows.length < 3) return null;
  return { t: rows.map((r) => n(r.t)), reserves: rows.map((r) => n(r.a)), owed: rows.map((r) => n(r.o)), kind: kind === "dex" ? "reserves" : "both" };
}

const cached = unstable_cache(load, ["dawns-proof-history-v1"], { revalidate: 600, tags: ["proof"] });

/** dawns' stored readings; without a database, the hourly history the snapshot already carries. */
export async function proofHistory(s: Snapshot, p: Proof): Promise<ProofHistory | null> {
  if (p.series) return p.series.t.length >= 3 ? { t: p.series.t, reserves: p.series.v, owed: [], kind: "reserves" } : null;
  const h = await cached(p.id, p.kind).catch(() => null);
  if (h) return h;
  if (p.kind === "bridge" && s.bridge?.history && s.bridge.history.length >= 3)
    return { t: s.bridge.history.map((x) => x.t), reserves: s.bridge.history.map((x) => x.v), owed: [], kind: "ratio" };
  const pv = s.protocols.find((x) => x.id === p.id);
  if (p.kind === "dex" && pv && pv.intraday.length >= 3)
    return { t: pv.intraday.map((x) => x.t), reserves: pv.intraday.map((x) => x.v), owed: [], kind: "reserves" };
  return null;
}
