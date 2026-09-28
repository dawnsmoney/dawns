import type { Metadata } from "next";
import { Banner } from "@/components/Banner";
import { AssetTable } from "@/components/assets";
import { Bars } from "@/components/viz";
import { assetPath, valueCredible, STANDARD_NAME } from "@/lib/assets/types";
import { getAssets } from "@/lib/assets";
import { toAssetLite, significant } from "@/lib/assets/view";
import { usd } from "@/lib/format";

export const metadata: Metadata = {
  title: "Assets",
  description: "Every asset in the Kaspa ecosystem in one index: KAS, KRC-20, Igra and Kasplex tokens, ZKAS. Supply, holders, concentration, liquidity and dawns' reading of each.",
};
export const revalidate = 300;

export default async function AssetsPage() {
  const all = await getAssets();
  const rows = all.map(toAssetLite);
  const live = all.filter(significant);
  const inDefi = all.filter((a) => a.pools.length > 0).length;
  const traded = all.reduce((s, a) => s + (a.standard !== "native" ? a.vol24 ?? 0 : 0), 0);
  const updated = all.reduce((m, a) => Math.max(m, a.updatedAt), 0);
  // this week, from dawns' own daily record
  const growth = all.filter((a) => (a.holders7 ?? 0) >= 50 && a.holders != null && a.holders !== a.holders7)
    .map((a) => ({ a, v: a.holders! / a.holders7! - 1 })).sort((x, y) => y.v - x.v).slice(0, 5);
  const moves = all.filter((a) => a.price7 && a.price != null && valueCredible(a))
    .map((a) => ({ a, v: a.price! / a.price7! - 1 })).filter((x) => Math.abs(x.v) >= 0.01).sort((x, y) => Math.abs(y.v) - Math.abs(x.v)).slice(0, 5);
  const newest = all.filter((a) => a.launched && a.launched > updated - 30 * 86_400_000 && (a.holders ?? 0) > 0)
    .sort((x, y) => (y.launched ?? 0) - (x.launched ?? 0)).slice(0, 5);
  const sign = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(1)}%`;
  return (
    <>
      <Banner short crumb={[{ label: "Beta" }]} title="Assets"
        lede="Every asset in the Kaspa ecosystem, whatever issued it: KAS, KRC-20 and covenant tokens (KCC-20) on Kaspa L1, tokens on Igra and Kasplex, and ZKAS. Each one identified by chain and contract, never by ticker alone." />
      <div className="wrap" style={{ paddingTop: 40 }}>
        {!all.length ? (
          <div className="card"><p className="muted" style={{ margin: 0 }}>The asset index is being built. It fills on the next data refresh.</p></div>
        ) : (
          <>
            <div className="grid g3" style={{ marginBottom: 28 }}>
              <div className="card"><span className="eyebrow muted">Indexed</span><b style={{ display: "block", font: "600 30px var(--display)", margin: "8px 0 4px" }}>{all.length.toLocaleString("en-US")}</b><span className="muted">{live.length} with real activity; the rest are dormant tokens</span></div>
              <div className="card"><span className="eyebrow muted">In DeFi</span><b style={{ display: "block", font: "600 30px var(--display)", margin: "8px 0 4px" }}>{inDefi}</b><span className="muted">assets in a pool or lending market dawns reads on-chain</span></div>
              <div className="card"><span className="eyebrow muted">Tokens traded, 24h</span><b style={{ display: "block", font: "600 30px var(--display)", margin: "8px 0 4px" }}>{usd(traded)}</b><span className="muted">KRC-20 marketplace volume; native coins excluded</span></div>
            </div>
            <div className="grid g3" style={{ marginBottom: 28, alignItems: "start" }}>
              <div className="card">
                <div className="c-head"><h3>Holders growing fastest</h3><span className="tag">7 days</span></div>
                {growth.length ? <Bars rows={growth.map(({ a, v }) => ({ key: a.id, label: a.symbol, sub: STANDARD_NAME[a.standard], href: assetPath(a.id), value: Math.max(0, v), display: sign(v), color: "#199e70" }))} />
                  : <p className="muted" style={{ margin: 0 }}>dawns records every asset daily since 28 September. Weekly changes appear from 5 October.</p>}
              </div>
              <div className="card">
                <div className="c-head"><h3>Biggest price moves</h3><span className="tag">7 days</span></div>
                {moves.length ? <Bars rows={moves.map(({ a, v }) => ({ key: a.id, label: a.symbol, sub: STANDARD_NAME[a.standard], href: assetPath(a.id), value: Math.abs(v), display: sign(v), color: v >= 0 ? "#199e70" : "#d95926" }))} />
                  : <p className="muted" style={{ margin: 0 }}>Only markets with real trading count. Weekly changes appear from 5 October.</p>}
              </div>
              <div className="card">
                <div className="c-head"><h3>New in the last 30 days</h3><span className="tag">{newest.length}</span></div>
                {newest.length ? <Bars rows={newest.map((a) => ({ key: a.id, label: a.symbol, sub: `${STANDARD_NAME[a.standard]} · ${new Date(a.launched!).toISOString().slice(5, 10)}`, href: assetPath(a.id), value: a.holders ?? 0, display: `${(a.holders ?? 0).toLocaleString("en-US")} holders`, color: "#9085e9" }))} />
                  : <p className="muted" style={{ margin: 0 }}>No new token with holders this month.</p>}
              </div>
            </div>
            <AssetTable rows={rows} />
            <p className="muted" style={{ fontSize: 13.5, marginTop: 22, lineHeight: 1.6 }}>
              Sources: KaspaCom (KRC-20 prices, volume, holders), the KCC20 indexer (covenant tokens, validated from chain data), Igra Blockscout (tokens, holders), the Kaspa and ZKas REST APIs (supply, emission, hashrate), the ZKas OTC desk (price), and dawns&apos; own reads of every DEX pool and lending market. &ldquo;Value&rdquo; is price × circulating supply on that chain. &ldquo;Reading&rdquo; is dawns&apos; flags, never a buy or sell call. Updated {new Date(updated).toISOString().slice(11, 16)} UTC.
            </p>
          </>
        )}
      </div>
    </>
  );
}
