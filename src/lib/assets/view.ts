import type { AssetLite } from "@/components/assets";
import { analyse } from "./analysis";
import { CHAIN_NAME, STANDARD_NAME, assetPath, type Asset } from "./types";

/** An asset is listed by default once something real happens with it. */
export const significant = (a: Asset) =>
  a.standard === "native" || a.pools.length > 0 || (a.holders ?? 0) >= 100 || (a.price != null && ((a.vol24 ?? 0) > 0 || (a.liquidity ?? 0) > 0));

export function toAssetLite(a: Asset): AssetLite {
  const r = analyse(a);
  return {
    id: a.id, path: assetPath(a.id), symbol: a.symbol, name: a.name, chain: a.chain, chainName: CHAIN_NAME[a.chain],
    standard: a.standard, standardName: STANDARD_NAME[a.standard],
    price: a.price, mcap: a.mcap, vol24: a.vol24, holders: a.holders, liquidity: a.liquidity, top10: a.top10,
    venues: a.pools.length, grade: r.grade.t, gradeLabel: r.grade.label, significant: significant(a),
  };
}
