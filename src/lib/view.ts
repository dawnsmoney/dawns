import type { ProtocolView, Snapshot } from "./types";
import type { ProtoRow } from "@/components/sections";
import type { ProtoLite } from "@/components/providers";

export const toRow = (p: ProtocolView): ProtoRow => ({
  id: p.id, name: p.name, letter: p.letter, category: p.category, kind: p.kind, chains: p.chains,
  tvl: p.tvl, d24: p.d24, d7: p.d7, spark: p.history.slice(-30).map((h) => h.v),
  util: p.lending?.utilization ?? null, vol24: p.dex?.vol24 ?? null,
  source: p.source, status: p.status, statusText: p.statusText, floor: p.floor,
});

export const toLite = (p: ProtocolView): ProtoLite => ({
  id: p.id, name: p.name, letter: p.letter, status: p.status, statusText: p.statusText, kind: p.kind, tvl: p.tvl, floor: p.floor,
});

export const names = (s: Snapshot) => Object.fromEntries(s.protocols.map((p) => [p.id, p.name]));

export function ago(ms: number) {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 90) return `${s}s ago`;
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  return `${Math.round(s / 3600)}h ago`;
}
