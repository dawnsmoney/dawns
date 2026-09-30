import type { Metadata } from "next";
import { IntelDay } from "@/components/pioneer-ping";
import { getSnapshot } from "@/lib/snapshot";
import { getIntelRaw } from "@/lib/intel-db";
import { buildIntel } from "@/lib/intel";
import { MCard, MHead, MLinkButton, MNote, MStats } from "@/components/m/kit";
import { MTabs } from "@/components/m/tabs";
import { MOpp } from "@/components/m/opps";
import { FlowBalance, FlowBars, Movers, signedUsd, pp } from "@/components/intel";
import { AreaChart, Bars as DayBars } from "@/components/charts";
import { usd, pct } from "@/lib/format";

export const metadata: Metadata = {
  title: "Intelligence",
  description: "Where capital and yield moved in Kaspa DeFi this week: net flows by protocol, rising and falling yields, and emerging opportunities, measured from dawns' own on-chain readings.",
};
export const revalidate = 300;

export default async function MIntelligence() {
  const [s, raw] = await Promise.all([getSnapshot(), getIntelRaw()]);
  const I = buildIntel(raw, s);
  const within = I.span >= 1.5 ? `${Math.round(I.span)} days` : "readings so far";
  const m = I.market;
  const opp = new Map(s.opportunities.map((o) => [o.id, o]));
  const emerging = I.emerging.map((id) => opp.get(id)!).filter(Boolean).slice(0, 6);
  const volCh = m.vol7 != null && m.volPrev7 ? m.vol7 / m.volPrev7 - 1 : null;
  return (
    <>
      <IntelDay />
      <MHead eyebrow="Kaspa DeFi" title="Intelligence" clamp
        sub="Where capital and yield moved this week, from dawns' own readings every 10 minutes. Flows are counted in tokens, so a price move is never mistaken for money arriving." />
      <div className="m-screen">
        <MStats items={[
          { label: `Net new capital · ${within}`, value: signedUsd(I.flows.total), sub: `lending ${signedUsd(I.flows.lending)} · pools ${signedUsd(I.flows.liquidity)}` },
          { label: "Ecosystem TVL", value: usd(m.tvlNow), sub: m.tvlThen != null ? `${signedUsd(m.tvlNow - m.tvlThen)}, incl. price` : "incl. price" },
          { label: "Swap volume · 7 days", value: m.vol7 != null ? usd(m.vol7) : "—", sub: volCh != null ? `${volCh >= 0 ? "+" : "−"}${pct(Math.abs(volCh), 0)} on the week before` : "not two full weeks yet" },
          { label: "Lending utilization", value: m.utilNow != null ? pct(m.utilNow, 0) : "—", sub: m.utilNow != null && m.utilThen != null ? `${pp(m.utilNow - m.utilThen)} in ${within}` : "borrowed / supplied" },
        ]} />
        <MTabs tabs={[{ key: "f", label: "Capital" }, { key: "y", label: "Yield" }, { key: "e", label: "Emerging", badge: emerging.length || null }, { key: "m", label: "Market" }]}>
          <div className="m-panel">
            <MCard title="Net by protocol" tag={within}>
              {I.flows.byProtocol.length ? <><FlowBalance rows={I.flows.byProtocol} /><FlowBars rows={I.flows.byProtocol} span={I.span} /></> : <MNote>No readings yet.</MNote>}
              <MNote>Tokens supplied and added to pools, valued at today&apos;s prices.</MNote>
            </MCard>
            <MCard title="Arriving"><Movers rows={I.flows.into} kind="flow" empty="No opportunity gained more than $500." /></MCard>
            <MCard title="Leaving"><Movers rows={I.flows.out} kind="flow" empty="No opportunity lost more than $500." /></MCard>
          </div>
          <div className="m-panel">
            <MCard title="Rising" tag="native yield"><Movers rows={I.yieldUp} kind="yield" empty="No yield rose by more than 15% and 0.25 pp." /></MCard>
            <MCard title="Falling" tag="native yield"><Movers rows={I.yieldDown} kind="yield" empty="No yield fell by more than 15% and 0.25 pp." /></MCard>
          </div>
          <div className="m-panel">
            <MNote>Yield rising, capital not leaving, exit open. Tap one for the reading.</MNote>
            {emerging.length ? <div className="m-opps">{emerging.map((o) => <MOpp key={o.id} o={o} t={I.byOpp[o.id]} />)}</div> : <MNote>Nothing meets all three this week.</MNote>}
          </div>
          <div className="m-panel">
            <MCard title="Ecosystem TVL, daily">{m.tvl.length >= 2 ? <AreaChart label="Ecosystem TVL, daily" dates={m.dates} series={[{ name: "TVL", color: "#9085e9", values: m.tvl }]} zero={false} stats height={200} /> : <MNote>Needs two days of readings.</MNote>}</MCard>
            <MCard title="Swap volume, daily">{m.vol.length ? <DayBars label="Swap volume by day" values={m.vol} dates={m.volDates} pos="#3987e5" neg="#3987e5" posLabel="Volume" negLabel="" stats height={190} /> : <MNote>Needs one full day of indexed swaps.</MNote>}</MCard>
            {m.util.length >= 2 && <MCard title="Lending utilization, daily"><AreaChart label="Lending utilization, daily" dates={m.utilDates} series={[{ name: "Utilization", color: "#3987e5", values: m.util }]} fmt="pct" zero stats height={180} /></MCard>}
          </div>
        </MTabs>
        <MLinkButton href="/opportunities" kind="ghost">Every opportunity, with its Dawns view</MLinkButton>
      </div>
    </>
  );
}
