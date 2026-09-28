import type { Evaluation, StrategyDoc } from "./model";

/** Leg colours follow the leg's slot (fixed order); the reserve is neutral. Server- and client-safe. */
export const LEG_COLORS = ["#D17A30", "#2FA88F", "#8578E6", "#D55A7C"];
export const RESERVE_COLOR = "#6E6788";
const bp = (b: number) => `${(b / 100).toFixed(b % 100 ? 1 : 0)}%`;

export interface SplitPart { key: string; label: string; color: string; share: number; note?: string }
export function splitParts(doc: StrategyDoc, ev: Evaluation): SplitPart[] {
  return [
    ...ev.legs.map((l, i) => ({ key: l.leg.opp, label: l.o?.name ?? l.leg.opp, color: LEG_COLORS[i], share: l.share, note: `${l.o?.pname ?? "not listed"} · cap ${bp(l.leg.cap)}` })),
    ...(doc.reserveBps ? [{ key: "reserve", label: "Reserve (KAS in the vault)", color: RESERVE_COLOR, share: doc.reserveBps / 10_000, note: "pays redemptions at once" }] : []),
  ];
}
