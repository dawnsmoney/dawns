import type { ProtocolView, Snapshot, Status } from "./types";
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

/**
 * A protocol's reading as scorecard tiles: the few things that decide whether capital can
 * sit there, each with a status, a number and a few words. Built only from fields dawns reads.
 */
export function protocolTiles(p: ProtocolView): { key: string; title: string; t: Status; big: string; small: string }[] {
  const pc = (x: number, d = 0) => `${(x * 100).toFixed(d)}%`;
  const $ = (x: number) => (x >= 1e6 ? `$${(x / 1e6).toFixed(2)}M` : x >= 1e3 ? `$${(x / 1e3).toFixed(1)}K` : `$${Math.round(x)}`);
  const tiles: { key: string; title: string; t: Status; big: string; small: string }[] = [];
  tiles.push({ key: "health", title: "Health", t: p.status, big: p.statusText, small: p.flags[0]?.[1]?.slice(0, 60) ?? "no warnings" });
  if (p.lending) {
    const L = p.lending;
    const cashShare = L.suppliedUsd ? L.cashUsd / L.suppliedUsd : 0;
    const blocked = L.markets.filter((m) => m.utilization >= 0.95);
    tiles.push({ key: "exit", title: "Withdrawable now", t: cashShare < 0.05 ? "crit" : cashShare < 0.2 ? "warn" : "good", big: pc(cashShare), small: blocked.length ? `${blocked.map((m) => m.symbol).join(", ")} blocked` : "of what was supplied" });
    const stale = L.markets.filter((m) => !m.oracleOk);
    tiles.push({ key: "oracle", title: "Price oracle", t: stale.length ? "crit" : "good", big: stale.length ? "Stale" : "Live", small: stale.length ? `${stale.map((m) => m.symbol).join(", ")}: liquidations fail` : "every market priced" });
    const pos = L.positions;
    if (pos) tiles.push({ key: "risk", title: "Loans at risk", t: pos.badDebtUsd > 0 ? "crit" : pos.liquidatableUsd > 0 ? "warn" : "good", big: $(pos.liquidatableUsd), small: pos.badDebtUsd > 0 ? `${$(pos.badDebtUsd)} bad debt` : `liquidatable of ${$(pos.debtUsd)} lent` });
    tiles.push({ key: "admin", title: "Admin", t: L.aclAdminIsContract ? "good" : "warn", big: L.aclAdminIsContract ? "Contract" : "One key", small: L.aclAdminIsContract ? "multisig or timelock" : "a single key controls it" });
  } else if (p.dex) {
    const d = p.dex;
    const top = d.pools[0];
    tiles.push({ key: "conc", title: "Largest pool", t: top && top.share > 0.6 ? "warn" : "good", big: top ? pc(top.share) : "—", small: top ? `${top.symbols.join("/")} of all liquidity` : "" });
    tiles.push({ key: "vol", title: "Traded 24h", t: (d.vol24 ?? 0) > 0 ? "good" : "info", big: d.vol24 != null ? $(d.vol24) : "—", small: d.vol24 && p.tvl ? `${(d.vol24 / p.tvl).toFixed(2)}× its liquidity` : "" });
    tiles.push({ key: "fee", title: "Fee yield", t: "info", big: d.fees24 != null && p.tvl ? pc((d.fees24 * 365) / p.tvl, 1) : "—", small: "fees ÷ liquidity, a year" });
    tiles.push({ key: "depth", title: "Pools over $1K", t: "info", big: String(d.pools.filter((x) => x.usd >= 1000).length), small: `of ${d.pairCount} pools` });
  } else {
    tiles.push({ key: "tvl", title: "Value locked", t: "info", big: $(p.tvl), small: p.source === "onchain" ? "read on-chain" : "from DefiLlama" });
  }
  tiles.push({ key: "verified", title: "Read on-chain", t: (p.verifiedShare ?? 0) >= 0.99 ? "good" : (p.verifiedShare ?? 0) > 0 ? "info" : "warn", big: pc(p.verifiedShare ?? 0), small: `${p.canVerify.length} checks · ${p.cannotVerify.length} pending` });
  return tiles.slice(0, 6);
}

/** Kaspa DeFi today, as tiles. */
export function ecoTiles(s: Snapshot): { key: string; title: string; t: Status; big: string; small: string }[] {
  const pc = (x: number, d = 0) => `${(x * 100).toFixed(d)}%`;
  const $ = (x: number) => (x >= 1e6 ? `$${(x / 1e6).toFixed(2)}M` : x >= 1e3 ? `$${(x / 1e3).toFixed(1)}K` : `$${Math.round(x)}`);
  const markets = s.protocols.flatMap((p) => p.lending?.markets ?? []);
  const stale = markets.filter((m) => !m.oracleOk);
  const blocked = s.opportunities.filter((o) => o.status === "crit");
  const warn = s.signals.filter((g) => g.t === "warn" || g.t === "crit");
  const tiles: { key: string; title: string; t: Status; big: string; small: string }[] = [
    { key: "tvl", title: "Value locked", t: "info", big: $(s.eco.tvl), small: s.kas24 != null ? `KAS ${s.kas24 >= 0 ? "+" : ""}${pc(s.kas24, 1)} in 24h` : `${s.protocols.length} protocols` },
    { key: "util", title: "Lending utilization", t: (s.eco.lendingUtil ?? 0) >= 0.95 ? "crit" : (s.eco.lendingUtil ?? 0) >= 0.8 ? "warn" : "good", big: s.eco.lendingUtil != null ? pc(s.eco.lendingUtil) : "—", small: `${$(s.eco.lendingLiq)} withdrawable` },
    { key: "exits", title: "Exits blocked", t: blocked.length ? "crit" : "good", big: String(blocked.length), small: blocked.length ? blocked.map((o) => o.assets[0]).join(", ") : "every market can be left" },
    { key: "oracle", title: "Price oracles", t: stale.length ? "crit" : "good", big: stale.length ? `${stale.length} stale` : "Live", small: stale.length ? "liquidations fail" : `${markets.length} markets priced` },
  ];
  if (s.bridge) tiles.push({ key: "bridge", title: "iKAS backing", t: s.bridge.coverage >= 1 ? "good" : s.bridge.coverage >= 0.99 ? "warn" : "crit", big: pc(s.bridge.coverage, 1), small: "KAS locked ÷ iKAS" });
  tiles.push({ key: "signals", title: "Warnings", t: warn.length ? "warn" : "good", big: String(warn.length), small: warn[0]?.strong?.slice(0, 48) ?? "nothing needs attention" });
  return tiles;
}
