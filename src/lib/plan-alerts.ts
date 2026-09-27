import { EXIT_COVER, type FollowedPlan, type Policy } from "./allocator";
import type { Snapshot, Status } from "./types";
import { usd, pct } from "./format";

/** How far a pool's price may swing (as LP shortfall vs holding) before dawns warns, by risk level. */
const IL_WARN = { low: 0.01, medium: 0.03, high: 0.08 } as const;

export interface PlanCheck { lineId: string; key: string; t: Status; strong: string; rest: string }

/**
 * Check each position of a followed plan against today's data and the user's own rules.
 * Pure: the same snapshot and plan always give the same checks.
 */
export function planChecks(s: Snapshot, plan: FollowedPlan, policy: Policy | null): PlanCheck[] {
  const out: PlanCheck[] = [];
  const risk = policy?.risk ?? "medium";
  const cover = EXIT_COVER[policy?.exit ?? "days"];
  for (const l of plan.lines) {
    const o = s.opportunities.find((x) => x.id === l.id);
    const add = (cond: string, t: Status, strong: string, rest: string) => out.push({ lineId: l.id, key: `${l.id}:${cond}`, t, strong, rest });
    if (!o) { add("gone", "warn", `${l.name} is no longer listed`, ". It fell below $5K or could not be read this run. Check it before adding more."); continue; }
    if (o.status === "crit") add("blocked", "crit", `Exit blocked on ${l.name}`, `. Only ${usd(o.exitNow ?? 0)} can be withdrawn now; your position is ${usd(l.usd)}.`);
    else if (o.kind === "supply" && o.exitNow != null && o.exitNow < cover * l.usd)
      add("exit", "warn", `Withdrawable cash in ${l.name} is below your rule`, `: ${usd(o.exitNow)} available, your rule wants ${cover}× your ${usd(l.usd)} position.`);
    if (o.notes.some((n) => n.startsWith("Frozen"))) add("frozen", "warn", `${l.name} is frozen`, ". No new deposits; existing positions can still withdraw while cash is available.");
    if (o.apy != null && l.apy > 0 && o.apy < l.apy / 2 && l.apy - o.apy > 0.02)
      add("yield", "info", `Yield on ${l.name} fell to ${pct(o.apy)}`, ` from ${pct(l.apy)} when you started following it.`);
    if (o.kind === "lp" && o.ilAtMove != null && o.ilAtMove >= IL_WARN[risk])
      add("swing", "warn", `Price swing in ${l.name}`, `: the pool moved ${pct(o.priceMove ?? 0, 0)}, so an LP now trails simply holding by ${pct(o.ilAtMove, 1)}.`);
    if (o.kind === "lp" && o.turnover != null && o.turnover >= 3)
      add("turnover", "info", `Unusual volume in ${l.name}`, `: ${o.turnover.toFixed(0)}× the pool traded in 24h. The fee yield may not last.`);
  }
  return out;
}
