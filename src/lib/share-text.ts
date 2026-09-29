import type { Opportunity } from "./types";
import type { Tag } from "./intel";

/**
 * What a shared opportunity says on X: the measured change first, then the yield and
 * the way out. Never advice; every figure is one dawns shows on the page.
 */
export function oppShareText(o: Opportunity, tags: Tag[] = []): string {
  const y = o.apy != null ? `${(o.apy * 100).toFixed(o.apy < 0.1 ? 2 : 1)}% native yield` : "yield still measuring";
  const change = tags.filter((t) => t.key !== "new" && t.key !== "steady").slice(0, 2).map((t) => `${t.text}: ${t.why}.`);
  const exit = o.kind === "supply" && o.exitShare != null ? `${Math.round(o.exitShare * 100)}% of the market can leave now.` : o.kind === "lp" ? "Exit at the pool's price." : "";
  return [`Dawns Intelligence · ${o.name} on ${o.pname}`, "", ...(change.length ? change : [`${o.statusText}.`]), `${y}. ${exit}`.trim()].join("\n");
}
