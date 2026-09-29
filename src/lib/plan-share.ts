import "server-only";
import type { Snapshot } from "./types";
import type { CardData } from "./cards";
import { allocate, checkPlan, usdPolicy, defaultPerProtocol, type Policy } from "./allocator";

/**
 * A plan share card: the rules someone plans by, not their returns. No wallet, no user id,
 * no yield figure. The amount appears only if they choose to show it.
 */
const RISK = { low: "Low", medium: "Medium", high: "High" } as const;
const RISK_HINT = { low: "stablecoins only", medium: "lending and calm pools", high: "anything open" } as const;
const EXIT = { instant: "Any time", days: "Days", weeks: "Weeks" } as const;
const EXIT_HINT = { instant: "markets hold 3× in cash", days: "markets hold 1.5× in cash", weeks: "markets hold at least 1×" } as const;
const AVOID = { lp: "liquidity pools", lending: "lending", v3: "concentrated liquidity" } as const;

export function planCard(p: Policy, s: Snapshot, showAmount: boolean): { data: CardData; reading: string } {
  const up = usdPolicy(p, s.kasUsd);
  const plan = allocate(s.opportunities, up);
  const checks = checkPlan(plan, up, s.opportunities);
  const breaches = checks.filter((c) => !c.ok).length;
  const perProtocol = p.maxProtocol ?? defaultPerProtocol(p.risk);
  const protocols = new Set(plan.lines.map((l) => l.protocol)).size;
  const amount = `${Math.round(p.amount).toLocaleString("en-US")} ${p.unit === "KAS" ? "KAS" : "USD"}`;
  const reserve = plan.cash && plan.cash.share >= 0.005 ? `, ${Math.round(plan.cash.share * 100)}% kept in the wallet as a reserve` : "";
  const reading = [
    `Spread across ${plan.lines.length} position${plan.lines.length === 1 ? "" : "s"} in ${protocols} protocol${protocols === 1 ? "" : "s"}${reserve}.`,
    p.horizon ? `Planned for ${p.horizon} month${p.horizon > 1 ? "s" : ""}.` : "",
    p.avoid.length ? `Avoids ${p.avoid.map((a) => AVOID[a]).join(" and ")}.` : "",
    "Native yield only: token incentives are never counted. Rules first, yield second.",
  ].filter(Boolean).join(" ");
  return {
    data: {
      kind: "plan", ref: "", kicker: "MY CAPITAL RULES", title: showAmount ? amount : "My Kaspa plan", sub: "planned with dawns",
      tiles: [
        { title: "Max per protocol", big: `${Math.round(perProtocol * 100)}%`, small: "of the amount", t: "info" },
        { title: "Exit within", big: EXIT[p.exit], small: EXIT_HINT[p.exit], t: "info" },
        { title: "Risk", big: RISK[p.risk], small: RISK_HINT[p.risk], t: "info" },
        { title: "Mandate check", big: `${breaches} breach${breaches === 1 ? "" : "es"}`, small: `${checks.length} rules checked`, t: breaches ? "crit" : "good" },
      ],
      grade: breaches ? { t: "crit", label: "Breaches found" } : { t: "good", label: "Within its rules" },
      path: "/allocate", asOf: s.asOf, block: s.blocks.igra?.block ?? null,
      foot: "Advisory only, not advice", lead: "Plan yours at", readingLabel: "THE PLAN",
      caption: `My Kaspa capital rules: max ${Math.round(perProtocol * 100)}% per protocol, exit within ${EXIT[p.exit].toLowerCase()}, ${breaches} mandate breach${breaches === 1 ? "" : "es"}.\n\nPlanned with dawns · {url}`,
    },
    reading,
  };
}
