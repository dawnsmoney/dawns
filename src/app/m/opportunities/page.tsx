import type { Metadata } from "next";
import { getSnapshot } from "@/lib/snapshot";
import { infinityHistory } from "@/lib/infinity";
import { MCard, MHead, MLinkButton, MNote, MStats } from "@/components/m/kit";
import { MTabs } from "@/components/m/tabs";
import { MOpp } from "@/components/m/opps";
import { FarmPanel, InfinityPanel } from "@/components/opportunities";
import { pct } from "@/lib/format";

export const metadata: Metadata = { title: "Opportunities", description: "Native yield in Kaspa DeFi, next to what it costs to get out." };
export const revalidate = 120;

export default async function MOpportunities() {
  const [s, rates] = await Promise.all([getSnapshot(), infinityHistory()]);
  const rows = s.opportunities;
  const lend = rows.filter((o) => o.kind === "supply");
  const lp = rows.filter((o) => o.kind === "lp" && !o.farm);
  const farms = rows.filter((o) => o.farm);
  const bestOpen = lend.filter((o) => o.status === "good").sort((a, b) => (b.apy ?? 0) - (a.apy ?? 0))[0];
  const bestLp = lp.filter((o) => o.apy != null && o.status === "good").sort((a, b) => (b.apy ?? 0) - (a.apy ?? 0))[0];
  const blocked = lend.filter((o) => o.status === "crit");
  const farm = s.protocols.flatMap((p) => (p.dex?.farms ?? []).map((f) => ({ p, f })))[0] ?? null;
  const inf = s.protocols.filter((p) => p.dex?.infinity?.length).map((p) => ({ p, rows: p.dex!.infinity!.map((v) => { const h = rates.get(`${v.chain}:${v.vault}`); return { ...v, apy7: h?.apy7 ?? null, apy30: h?.apy30 ?? null, since: h?.points[0]?.day ?? null }; }) }))[0] ?? null;
  const list = (xs: typeof rows) => <div className="m-opps">{xs.map((o) => <MOpp key={o.id} o={o} />)}</div>;
  return (
    <>
      <MHead eyebrow="Kaspa DeFi" title="Yield" sub="Native yield only, paid by borrowers or traders, next to what it costs to leave. Tap one for the reading." />
      <div className="m-screen">
        <MStats items={[
          { label: "Best open lending", value: bestOpen?.apy != null ? pct(bestOpen.apy, 1) : "—", sub: bestOpen ? `${bestOpen.assets[0]} on ${bestOpen.pname}` : "no market fully open" },
          { label: "Best pool fees", value: bestLp?.apy != null ? pct(bestLp.apy, 1) : "—", sub: bestLp ? bestLp.assets.join("/") : "measuring" },
          { label: "Exits blocked", value: String(blocked.length), sub: blocked.length ? `${blocked.map((o) => o.assets[0]).join(", ")}: high rate, no way out` : "every market can be left", tone: blocked.length ? "crit" : "good" },
          { label: "Farm rewards", value: farm ? (farm.f.perDay > 0 ? "On" : "Off") : "—", sub: farm ? (farm.f.perDay > 0 ? `${Math.round(farm.f.perDay).toLocaleString("en-US")} ZEAL a day` : "fees only") : undefined, tone: farm && farm.f.perDay === 0 ? "warn" : undefined },
        ]} />
        <MTabs tabs={[{ key: "all", label: "All", badge: rows.length - farms.length }, { key: "l", label: "Lending", badge: lend.length }, { key: "p", label: "Liquidity", badge: lp.length }, { key: "f", label: "Farms & staking", badge: farms.length || null }]}>
          {list(rows.filter((o) => !o.farm))}
          {list(lend)}
          {list(lp)}
          <div className="m-panel">
            {farm && <FarmPanel p={{ id: farm.p.id, name: farm.p.name }} f={farm.f} opps={farms} now={s.asOf} />}
            {farms.length > 0 && list(farms)}
            {inf && <InfinityPanel p={{ id: inf.p.id, name: inf.p.name }} rows={inf.rows} />}
            {!farm && !inf && <MNote>No farm or staking read this run.</MNote>}
          </div>
        </MTabs>
        <MCard title="Turn these into a plan">
          <MNote>A strategy splits capital across these with caps, a reserve and rules that stop new money when an exit closes.</MNote>
          <MLinkButton href="/strategies/new">Write a strategy</MLinkButton>
          <MLinkButton href="/allocate" kind="ghost">Build an allocation</MLinkButton>
        </MCard>
      </div>
    </>
  );
}
