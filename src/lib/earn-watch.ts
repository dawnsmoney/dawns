import "server-only";
import { sql, ensureSchema } from "./db";
import { getSnapshot } from "./snapshot";
import { accountOf } from "./auth/session";
import { readWalletCached } from "./portfolio-read";
import { buildPortfolio, type Position } from "./portfolio";
import type { PlanCheck } from "./plan-alerts";
import type { Snapshot } from "./types";
import { usd, pct } from "./format";

/**
 * Earn positions dawns watches for a user. When watching starts, dawns records the
 * market's numbers (native yield, size) and what the user's wallets held in that
 * option, so later it can say what changed since: the yield, the pool, the position,
 * and the result against simply holding what went in.
 */

export interface Held { sym: string; amount: number }
export interface EarnWatch { opp: string; started_at: string; apy0: number | null; size0: number | null; kas0: number | null; under0: Held[] | null; usd0: number | null }

/** The signed-in user's positions in one option, read now from their EVM wallets. */
export async function positionIn(userId: string, opp: string, s?: Snapshot): Promise<Position[]> {
  const snap = s ?? await getSnapshot();
  const acct = await accountOf(userId);
  const evm = acct.wallets.filter((w) => w.kind === "evm").map((w) => w.address);
  if (!evm.length) return [];
  const reads = await Promise.all(evm.map((a) => readWalletCached(a).catch(() => null)));
  const pf = buildPortfolio(snap, reads.filter((r): r is NonNullable<typeof r> => !!r));
  return pf.positions.filter((p) => p.opp === opp);
}

const sumHeld = (ps: Position[]): Held[] => {
  const m = new Map<string, number>();
  for (const p of ps) for (const u of p.under) m.set(u.sym, (m.get(u.sym) ?? 0) + u.amount);
  return [...m].map(([sym, amount]) => ({ sym, amount }));
};

export async function startWatch(userId: string, opp: string) {
  await ensureSchema();
  const s = await getSnapshot();
  const o = s.opportunities.find((x) => x.id === opp);
  if (!o) throw new Error("That option is not in dawns' latest read.");
  const pos = await positionIn(userId, opp, s).catch(() => []);
  const held = pos.length ? sumHeld(pos) : null;
  const v = pos.reduce((t, p) => t + (p.usd ?? 0), 0);
  await sql().query(`insert into earn_watch (user_id, opp, apy0, size0, kas0, under0, usd0) values ($1, $2, $3, $4, $5, $6::jsonb, $7)
    on conflict (user_id, opp) do nothing`, [userId, opp, o.apy, o.size, s.kasUsd, held ? JSON.stringify(held) : null, pos.length ? v : null]);
}

export async function stopWatch(userId: string, opp: string) {
  await ensureSchema();
  await sql().query("delete from earn_watch where user_id = $1 and opp = $2", [userId, opp]);
}

export async function watchesOf(userId: string): Promise<EarnWatch[]> {
  await ensureSchema();
  return (await sql().query("select opp, started_at, apy0, size0, kas0, under0, usd0 from earn_watch where user_id = $1 order by started_at", [userId])) as EarnWatch[];
}

/** A baseline taken before the position existed: fill it the first time the position shows up. */
export async function fillBaseline(userId: string, w: EarnWatch, pos: Position[]) {
  if (w.under0 || !pos.length) return w;
  const held = sumHeld(pos), v = pos.reduce((t, p) => t + (p.usd ?? 0), 0);
  await sql().query("update earn_watch set under0 = $3::jsonb, usd0 = $4 where user_id = $1 and opp = $2 and under0 is null", [userId, w.opp, JSON.stringify(held), v]);
  return { ...w, under0: held, usd0: v };
}

/**
 * The checks behind Earn alerts, against the numbers when watching started. Keys are
 * stable per condition, so an alert fires once and clears when the condition ends.
 */
export function earnChecks(s: Snapshot, rows: EarnWatch[]): PlanCheck[] {
  const out: PlanCheck[] = [];
  for (const w of rows) {
    const o = s.opportunities.find((x) => x.id === w.opp);
    const name = o ? `${o.name.replace(/ liquidity$/, " pool")} on ${o.pname}` : w.opp;
    const add = (cond: string, t: PlanCheck["t"], strong: string, rest: string) => out.push({ lineId: w.opp, key: `e:${w.opp}:${cond}`, t, strong, rest });
    if (!o) { add("gone", "warn", `${name} is no longer listed`, ". It fell below dawns' size floor or could not be read this run."); continue; }
    if (w.apy0 != null && o.apy != null && o.apy < w.apy0 / 2 && w.apy0 - o.apy > 0.02)
      add("yield", "info", `Yield on ${name} halved`, `: ${pct(w.apy0)} when you started watching, ${pct(o.apy)} now.`);
    if (w.size0 != null && w.size0 > 0 && o.size < w.size0 * 0.8)
      add("capital", "warn", `Capital is leaving ${name}`, `: ${usd(w.size0)} when you started watching, ${usd(o.size)} now.`);
    if (o.kind === "supply" && o.exitShare != null && o.exitShare < 0.2)
      add("exit", o.exitShare < 0.05 ? "crit" : "warn", `Only ${pct(o.exitShare, 0)} of ${name} could leave now`, `: ${usd(o.exitNow ?? 0)} is withdrawable; the rest waits for borrowers to repay.`);
    if (o.notes.some((n) => /^frozen/i.test(n))) add("frozen", "warn", `${name} is frozen`, ". No new deposits; withdrawals still work while cash is there.");
    if (o.kind === "lp" && o.ilAtMove != null && o.ilAtMove >= 0.03)
      add("swing", "warn", `Price swing in ${name}`, `: the pool moved ${pct(o.priceMove ?? 0, 0)}, so an LP trails simply holding by ${pct(o.ilAtMove, 1)}.`);
  }
  return out;
}

/** What changed for one watched option, for Portfolio: then and now, and against holding. */
export function earnView(s: Snapshot, w: EarnWatch, pos: Position[]) {
  const o = s.opportunities.find((x) => x.id === w.opp) ?? null;
  const usdNow = pos.length ? pos.reduce((t, p) => t + (p.usd ?? 0), 0) : null;
  const now = new Map<string, { amount: number; px: number | null }>();
  for (const p of pos) for (const u of p.under) {
    const e = now.get(u.sym) ?? { amount: 0, px: null };
    e.amount += u.amount; if (u.usd != null && u.amount > 0) e.px = u.usd / u.amount;
    now.set(u.sym, e);
  }
  // what the tokens you started with would be worth today, had you just held them
  let hold: number | null = null;
  if (w.under0?.length) {
    hold = 0;
    for (const h of w.under0) { const px = now.get(h.sym)?.px ?? null; if (px == null) { hold = null; break; } hold += h.amount * px; }
  }
  const kas = s.kasUsd;
  return {
    o, usdNow, hold, vsHold: usdNow != null && hold != null ? usdNow - hold : null,
    inKas: (v: number | null) => (v != null && kas ? v / kas : null),
    held0: w.under0, heldNow: [...now].map(([sym, e]) => ({ sym, amount: e.amount })),
  };
}
