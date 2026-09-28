import type { Holder } from "./types";

/**
 * Who holds supply, by kind. Fixed order = fixed colour: categorical slots validated for the
 * dark card surface (#1C1642) with the dataviz validator (CVD ≥ 8.4, normal vision ≥ 19.3,
 * contrast ≥ 3:1). "Everyone else" is neutral, never a hue.
 */
export const HOLDER_CATS = [
  { key: "pool", label: "Pools & markets", color: "#3987e5" },
  { key: "exchange", label: "Exchanges", color: "#d95926" },
  { key: "wallet", label: "Large wallets", color: "#199e70" },
  { key: "vesting", label: "Vesting & locks", color: "#c98500" },
  { key: "multisig", label: "Multisig treasuries", color: "#d55181" },
  { key: "staking", label: "Staking & attestation", color: "#008300" },
  { key: "contract", label: "Other contracts & funds", color: "#9085e9" },
  { key: "burn", label: "Burned", color: "#e66767" },
] as const;
export type HolderCat = (typeof HOLDER_CATS)[number]["key"];
export const REST_COLOR = "#4A4270";

export function holderCat(h: Holder): HolderCat {
  const n = h.label ?? "";
  if (h.kind === "burn" || /burn|dead/i.test(n)) return "burn";
  if (h.kind === "exchange") return "exchange";
  if (/vest|lock|timelock|escrow/i.test(n)) return "vesting";
  if (/safe|multisig|gnosis/i.test(n)) return "multisig";
  if (/diamond|attest|stak|infinity|xzeal|xnacho/i.test(n)) return "staking";
  if (/pair|pool|router|swap|kaskad|atoken|market|lp\b/i.test(n)) return "pool";
  if (h.kind === "project" || h.contract) return "contract";
  return "wallet";
}

export interface SupplyPart { key: string; label: string; color: string; share: number; count: number }
/** The top holders grouped by kind, in fixed order, plus everyone else. */
export function supplyParts(top: Holder[] | null, top10: number | null): SupplyPart[] {
  if (!top?.length || top10 == null) return [];
  const parts: SupplyPart[] = HOLDER_CATS.map((c) => ({ ...c, share: 0, count: 0 }));
  for (const h of top) { const p = parts.find((x) => x.key === holderCat(h))!; p.share += h.share; p.count++; }
  const shown = parts.filter((p) => p.share > 0);
  const rest = Math.max(0, 1 - shown.reduce((s, p) => s + p.share, 0));
  return [...shown, ...(rest > 0.0005 ? [{ key: "rest", label: "Everyone else", color: REST_COLOR, share: rest, count: 0 }] : [])];
}
export const catOf = (key: string) => HOLDER_CATS.find((c) => c.key === key);
