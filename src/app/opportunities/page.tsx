import type { Metadata } from "next";
import Link from "next/link";
import { Banner } from "@/components/Banner";
import { DataBridge } from "@/components/providers";
import { FarmPanel, OpportunityTable, YieldLadder } from "@/components/opportunities";
import { getSnapshot } from "@/lib/snapshot";
import { getAssets } from "@/lib/assets";
import { knownOf } from "@/lib/assets/view";
import { toLite } from "@/lib/view";
import { usd, pct } from "@/lib/format";

export const metadata: Metadata = {
  title: "Opportunities",
  description: "Native yield in Kaspa DeFi, next to what it costs to get out: exit liquidity, rate stability and price exposure, read on-chain.",
};
export const revalidate = 120;

export default async function OpportunitiesPage() {
  const [s, assets] = await Promise.all([getSnapshot(), getAssets()]);
  const rows = s.opportunities;
  const known = knownOf(assets, rows.flatMap((o) => o.assetIds ?? []));
  const lend = rows.filter((o) => o.kind === "supply");
  const lp = rows.filter((o) => o.kind === "lp" && !o.farm);
  const farms = rows.filter((o) => o.farm);
  const farm = s.protocols.flatMap((p) => (p.dex?.farms ?? []).map((f) => ({ p, f })))[0] ?? null;
  const bestOpen = lend.filter((o) => o.status === "good").sort((a, b) => (b.apy ?? 0) - (a.apy ?? 0))[0];
  const bestLp = lp.filter((o) => o.apy != null && o.status === "good")[0];
  const blocked = lend.filter((o) => o.status === "crit");
  const measuring = lp.every((o) => o.apy == null);
  return (
    <>
      <DataBridge prov={s.prov} protocols={s.protocols.map(toLite)} signals={s.signals} />
      <Banner short crumb={[{ label: "Beta" }]} title="Opportunities"
        lede="Every yield in Kaspa DeFi next to what it costs to get out. Native yield only: paid by borrowers or traders, never token incentives." />
      <div className="wrap" style={{ paddingTop: 40 }}>
        <div className="grid g3" style={{ marginBottom: 28 }}>
          <div className="card">
            <span className="eyebrow muted">Best open lending rate</span>
            <b style={{ display: "block", font: "600 30px var(--display)", margin: "8px 0 4px" }}>{bestOpen?.apy != null ? pct(bestOpen.apy, 2) : "—"}</b>
            <span className="muted">{bestOpen ? `${bestOpen.name} on ${bestOpen.pname} · ${usd(bestOpen.exitNow ?? 0)} withdrawable` : "No lending market is fully open"}</span>
          </div>
          <div className="card">
            <span className="eyebrow muted">Best fee yield for liquidity</span>
            <b style={{ display: "block", font: "600 30px var(--display)", margin: "8px 0 4px" }}>{bestLp?.apy != null ? pct(bestLp.apy, 1) : "—"}</b>
            <span className="muted">{bestLp ? `${bestLp.assets.join("/")} on ${bestLp.pname}` : measuring ? "Measuring: dawns needs 24 hours of swaps" : "No pool without warnings"}</span>
          </div>
          <div className="card">
            <span className="eyebrow muted">Exits blocked</span>
            <b style={{ display: "block", font: "600 30px var(--display)", margin: "8px 0 4px", color: blocked.length ? "var(--crit)" : undefined }}>{blocked.length}</b>
            <span className="muted">{blocked.length ? `${blocked.map((o) => o.assets[0]).join(", ")}: the highest rates, because suppliers can't leave` : "Every listed market can be withdrawn"}</span>
          </div>
        </div>

        <div className="card" style={{ marginBottom: 28 }}>
          <div className="c-head"><h3>Highest native yields, and whether you can get out</h3>
            <div className="split-legend" style={{ marginTop: 0 }}><span><i style={{ background: "#3987e5" }} />Lending</span><span><i style={{ background: "#d95926" }} />Liquidity</span></div>
          </div>
          <YieldLadder rows={rows.filter((o) => !o.farm)} />
        </div>

        {farm && <div style={{ marginBottom: 28 }}><FarmPanel p={{ id: farm.p.id, name: farm.p.name }} f={farm.f} opps={farms} now={s.asOf} /></div>}

        <OpportunityTable rows={rows} known={known} />

        <div className="grid gA" style={{ marginTop: 28 }}>
          <div className="card">
            <div className="c-head"><h3>How dawns measures yield</h3></div>
            <div className="vlist">
              <div className="vrow"><span /><div>Lending<small>The current supply rate read from the Kaskad contracts. Its range comes from dawns&apos; own readings every 10 minutes.</small></div><b /></div>
              <div className="vrow"><span /><div>Liquidity<small>Swap volume read from every pool on-chain × the fee rate × the LPs&apos; share of fees, per year, ÷ pool size. V3 pools use their own fee tier; V2 fee rates and the LP share come from DefiLlama.</small></div><b /></div>
              <div className="vrow"><span /><div>Price exposure<small>The widest price range the pool went through in dawns&apos; readings, and how far an LP would trail simply holding at that move.</small></div><b /></div>
            </div>
          </div>
          <div className="card">
            <div className="c-head"><h3>Not counted</h3></div>
            <div className="vlist">
              <div className="vrow"><span /><div>Token incentives<small>KSKD, ZEAL and farm rewards are paid in the protocol&apos;s own token. Farms show them next to the fee yield, never added to it.</small></div><b /></div>
              <div className="vrow"><span /><div>Markets and pools under $5K<small>Too small to enter and leave without moving the price.</small></div><b /></div>
            </div>
          </div>
        </div>
        <div className="preview" style={{ marginTop: 18 }}>
          <span>A high rate next to a blocked exit is a warning, not an opportunity. dawns can turn these into a split that fits your risk and exit window.</span>
          <span style={{ display: "flex", gap: 10, flexWrap: "wrap" }}><Link className="btn glass" href="/strategies/new">Write a strategy</Link><Link className="btn iris" href="/allocate">Build an allocation</Link></span>
        </div>
      </div>
    </>
  );
}
