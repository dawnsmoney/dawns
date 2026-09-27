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
    if (o.notes.some((n) => n.includes("oracle is stale"))) add("oracle", "warn", `The price oracle behind ${l.name} is stale`, ". Liquidations cannot run until it updates, so bad loans can build up. Withdrawing without a loan still works.");
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

/* ---------- a user's own Watch thresholds, per protocol ---------- */
type Rule = { on: boolean; v: number | null };
export type WatchEntryLite = { rules: Partial<Record<string, Rule>>; ch: string[] };

/**
 * Evaluate Watch rules (the sliders in the Watch window) against today's data.
 * poolThen: pair → pool USD about 24h ago (for "a pool's liquidity drops by more than").
 */
export function watchChecks(s: Snapshot, entries: Record<string, WatchEntryLite>, poolThen: Map<string, number>): PlanCheck[] {
  const out: PlanCheck[] = [];
  const day = s.asOf - 24 * 3600_000;
  for (const [id, e] of Object.entries(entries)) {
    if (!e?.ch?.includes("telegram")) continue;
    const p = s.protocols.find((x) => x.id === id);
    if (!p) continue;
    const on = (k: string) => (e.rules[k]?.on ? e.rules[k] : null);
    const add = (cond: string, t: Status, strong: string, rest: string) => out.push({ lineId: id, key: `w:${id}:${cond}`, t, strong, rest });

    const liq = on("liq");
    if (liq?.v != null) {
      if (p.lending && p.lending.cashUsd < liq.v * 1000)
        add("liq", "warn", `${p.name} withdrawable liquidity is ${usd(p.lending.cashUsd)}`, `, below your ${usd(liq.v * 1000)} line.`);
      if (p.dex) for (const pool of p.dex.pools) {
        const then = poolThen.get(pool.pair.toLowerCase());
        if (!then || then < 5_000) continue;
        const drop = 1 - pool.usd / then;
        if (drop >= liq.v / 100) add(`liq:${pool.pair.toLowerCase()}`, "warn", `${pool.symbols.join("/")} liquidity on ${p.name} fell ${pct(drop, 0)} in 24h`, ` (${usd(then)} → ${usd(pool.usd)}), past your ${liq.v}% line.`);
      }
    }
    const util = on("util");
    if (util?.v != null && p.lending) {
      const worst = [...p.lending.markets].sort((a, b) => b.utilization - a.utilization)[0];
      if (worst && worst.utilization * 100 > util.v) add("util", worst.utilization >= 0.95 ? "crit" : "warn", `${p.name} ${worst.symbol} utilization is ${pct(worst.utilization)}`, `, above your ${util.v}% line. ${usd(worst.cashUsd)} can be withdrawn now.`);
    }
    const large = on("large");
    if (large?.v != null && p.activity) for (const ev of p.activity.events) {
      if (ev.t < day || ev.usd < large.v * 1000 || !(ev.kind === "withdraw" || ev.kind === "remove")) continue;
      add(`large:${ev.tx}`, "info", ev.kind === "withdraw" ? `${usd(ev.usd)} of ${ev.label} withdrawn from ${p.name}` : `${usd(ev.usd)} of ${ev.label} liquidity left ${p.name}`, `, above your ${usd(large.v * 1000)} line.`);
    }
    const tvl = on("tvl");
    if (tvl?.v != null && p.d24 != null && Math.abs(p.d24) * 100 >= tvl.v)
      add("tvl", p.d24 < 0 ? "warn" : "info", `${p.name} TVL ${p.d24 < 0 ? "fell" : "rose"} ${pct(Math.abs(p.d24))} in 24h`, `, past your ${tvl.v}% line.`);
    const vol = on("vol");
    if (vol?.v != null && p.activity?.vol7 != null && p.activity.vol7 > 0) {
      const avg = p.activity.vol7 / 7;
      if (p.activity.vol24 > avg * (1 + vol.v / 100)) add("vol", "info", `${p.name} volume is ${(p.activity.vol24 / avg).toFixed(1)}× its 7-day average`, ` (${usd(p.activity.vol24)} in 24h), past your +${vol.v}% line.`);
    }
    if (on("contract")) for (const g of s.signals.filter((x) => x.p === id && x.rule === "contract"))
      add(`contract:${g.key}`, g.t, g.strong, g.rest);
  }
  return out;
}
