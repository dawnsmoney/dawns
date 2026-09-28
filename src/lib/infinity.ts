import "server-only";
import { sql, hasDb, ensureSchema } from "./db";
import type { Snapshot } from "./types";

/** Record each staking vault's exchange rate once a day (idempotent within the day). */
export async function recordInfinityRates(s: Snapshot) {
  const vs = s.protocols.flatMap((p) => p.dex?.infinity ?? []).filter((v) => v.rate != null);
  if (!vs.length) return "no rates";
  await ensureSchema();
  const day = new Date().toISOString().slice(0, 10);
  for (const v of vs) await sql().query("insert into infinity_rates (day, chain, vault, rate) values ($1, $2, $3, $4) on conflict do nothing", [day, v.chain, v.vault, v.rate]);
  return `${vs.length} vaults`;
}

export interface RateHistory { key: string; points: { day: string; rate: number }[]; apy7: number | null; apy30: number | null }
/** Measured yield from recorded rates: annualised growth over the last 7 and 30 days, when dawns has them. */
export async function infinityHistory(): Promise<Map<string, RateHistory>> {
  const out = new Map<string, RateHistory>();
  if (!hasDb()) return out;
  try {
    await ensureSchema();
    const r = (await sql().query("select day, chain, vault, rate from infinity_rates where day > now() - interval '120 days' order by day")) as { day: string; chain: string; vault: string; rate: number }[];
    for (const x of r) {
      const key = `${x.chain}:${x.vault}`;
      const h = out.get(key) ?? { key, points: [], apy7: null, apy30: null };
      h.points.push({ day: new Date(x.day).toISOString().slice(0, 10), rate: x.rate });
      out.set(key, h);
    }
    for (const h of out.values()) {
      const last = h.points[h.points.length - 1];
      const back = (days: number) => {
        const target = Date.parse(last.day) - days * 86_400_000;
        const p = h.points.find((q) => Date.parse(q.day) >= target);
        if (!p || p === last) return null;
        const span = (Date.parse(last.day) - Date.parse(p.day)) / 86_400_000;
        return span >= days * 0.8 ? Math.pow(last.rate / p.rate, 365 / span) - 1 : null;
      };
      h.apy7 = back(7); h.apy30 = back(30);
    }
  } catch { /* measured yield is optional */ }
  return out;
}
