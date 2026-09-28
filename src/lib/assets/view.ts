import type { AssetLite } from "@/components/assets";
import type { Snapshot } from "../types";
import { analyse } from "./analysis";
import { CHAIN_NAME, STANDARD_NAME, assetPath, valueCredible, type Asset } from "./types";

/** An asset is listed by default once something real happens with it. */
export const significant = (a: Asset) =>
  a.standard === "native" || a.pools.length > 0 || (a.holders ?? 0) >= 100 || (a.price != null && ((a.vol24 ?? 0) > 0 || (a.liquidity ?? 0) > 0));

export function toAssetLite(a: Asset): AssetLite {
  const r = analyse(a);
  return {
    id: a.id, path: assetPath(a.id), symbol: a.symbol, name: a.name, chain: a.chain, chainName: CHAIN_NAME[a.chain],
    standard: a.standard, standardName: STANDARD_NAME[a.standard],
    price: a.price, mcap: a.mcap, credible: valueCredible(a), vol24: a.vol24, holders: a.holders, liquidity: a.liquidity, top10: a.top10,
    venues: a.pools.length, grade: r.grade.t, gradeLabel: r.grade.label, significant: significant(a),
  };
}

/** Of the ids a page references, those the asset index has a profile for. */
export function knownOf(assets: Asset[], ids: string[]): string[] {
  const have = new Set(assets.map((a) => a.id));
  return [...new Set(ids)].filter((id) => have.has(id));
}

export interface Holding { protocol: string; name: string; letter: string; usd: number; where: string[] }
/**
 * Which protocols hold an asset, and how much, from dawns' own reads: a pool holds half its
 * value in each token; a lending market holds what was supplied. KAS counts its wrapped
 * forms on the L2s (WiKAS, iKAS, WKAS).
 */
export function holdingsOf(a: Asset, s: Snapshot): Holding[] {
  const kasLike = (sym: string) => /^w?i?kas$/i.test(sym);
  const match = (chain: string, addr: string, sym: string) =>
    a.standard === "native" && a.id === "kaspa:native:KAS" ? kasLike(sym) : a.standard === "erc20" && a.chain === chain && a.ref === addr.toLowerCase();
  const out: Holding[] = [];
  for (const p of s.protocols) {
    let usd = 0;
    const where: string[] = [];
    for (const q of p.dex?.pools ?? []) q.tk.forEach((t, i) => { if (match(q.chain, t.a, q.symbols[i])) { usd += q.usd / 2; where.push(q.symbols.join("/")); } });
    for (const m of p.lending?.markets ?? []) if (match("igra", m.asset, m.symbol)) { usd += m.suppliedUsd; where.push(`${m.symbol} market`); }
    if (usd > 0) out.push({ protocol: p.id, name: p.name, letter: p.letter, usd, where: [...new Set(where)] });
  }
  return out.sort((x, y) => y.usd - x.usd);
}
