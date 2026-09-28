import type { Metadata } from "next";
import { Banner } from "@/components/Banner";
import { AssetTable } from "@/components/assets";
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
  return (
    <>
      <Banner short crumb={[{ label: "Beta" }]} title="Assets"
        lede="Every asset in the Kaspa ecosystem, whatever issued it: KAS, KRC-20 on Kaspa L1, tokens on Igra and Kasplex, and ZKAS. Each one identified by chain and contract, never by ticker alone." />
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
            <AssetTable rows={rows} />
            <p className="muted" style={{ fontSize: 13.5, marginTop: 22, lineHeight: 1.6 }}>
              Sources: KaspaCom (KRC-20 prices, volume, holders), Igra Blockscout (tokens, holders), the Kaspa and ZKas REST APIs (supply, emission, hashrate), the ZKas OTC desk (price), and dawns&apos; own reads of every DEX pool and lending market. &ldquo;Value&rdquo; is price × circulating supply on that chain. &ldquo;Reading&rdquo; is dawns&apos; flags, never a buy or sell call. Updated {new Date(updated).toISOString().slice(11, 16)} UTC.
            </p>
          </>
        )}
      </div>
    </>
  );
}
