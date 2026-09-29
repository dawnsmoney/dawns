import type { Evaluation, StrategyDoc } from "./model";

/** Leg colours follow the leg's slot (fixed order); the reserve is neutral. Server- and client-safe. */
export const LEG_COLORS = ["#D17A30", "#2FA88F", "#8578E6", "#D55A7C"];
export const RESERVE_COLOR = "#6E6788";
/** A leg's name when its opportunity is not listed right now: never a raw 60-character id. */
export const legName = (id: string, name?: string | null) => name ?? id.replace(/^([a-z0-9-]+):(?:[a-z]+:)?(0x[0-9a-f]{4})[0-9a-f]{32}([0-9a-f]{4})$/i, "$1 pool $2…$3");
const bp = (b: number) => `${(b / 100).toFixed(b % 100 ? 1 : 0)}%`;

export interface SplitPart { key: string; label: string; color: string; share: number; note?: string }
export function splitParts(doc: StrategyDoc, ev: Evaluation): SplitPart[] {
  return [
    ...ev.legs.map((l, i) => ({ key: l.leg.opp, label: legName(l.leg.opp, l.o?.name), color: LEG_COLORS[i], share: l.share, note: `${l.o?.pname ?? "not listed"} · cap ${bp(l.leg.cap)}` })),
    ...(doc.reserveBps ? [{ key: "reserve", label: "Reserve (KAS in the vault)", color: RESERVE_COLOR, share: doc.reserveBps / 10_000, note: "pays redemptions at once" }] : []),
  ];
}
