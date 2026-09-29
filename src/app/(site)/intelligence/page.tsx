import type { Metadata } from "next";
import Link from "next/link";
import { Banner } from "@/components/Banner";
import { AreaChart, Bars as DayBars } from "@/components/charts";
import { FlowBalance, FlowBars, Movers, Stat, Tags, signedUsd, pp } from "@/components/intel";
import { Pill } from "@/components/bits";
import { getSnapshot } from "@/lib/snapshot";
import { getIntelRaw } from "@/lib/intel-db";
import { buildIntel } from "@/lib/intel";
import { usd, pct } from "@/lib/format";

export const metadata: Metadata = {
  title: "Intelligence",
  description: "Where capital and yield moved in Kaspa DeFi this week: net flows by protocol, rising and falling yields, and emerging opportunities, measured from dawns' own on-chain readings.",
};
export const revalidate = 300;

export default async function IntelligencePage() {
  const [s, raw] = await Promise.all([getSnapshot(), getIntelRaw()]);
  const I = buildIntel(raw, s);
  const d = Math.max(1, Math.round(I.span));
  const within = I.span >= 1.5 ? `${d} days` : "the readings so far";
  const m = I.market;
  const opp = new Map(s.opportunities.map((o) => [o.id, o]));
  const emerging = I.emerging.map((id) => opp.get(id)!).filter(Boolean).slice(0, 6);
  const tvlCh = m.tvlThen != null ? m.tvlNow - m.tvlThen : null;
  const kasCh = m.kasThen && m.kasNow ? m.kasNow / m.kasThen - 1 : null;
  const volCh = m.vol7 != null && m.volPrev7 ? m.vol7 / m.volPrev7 - 1 : null;
  const short = I.span < 6.5;

  return (
    <>
      <Banner short crumb={[{ label: "Beta" }]} title="Intelligence"
        lede="Where capital and yield moved in Kaspa DeFi this week. Measured from dawns' own readings every 10 minutes, in token quantities, so a price move is never counted as money arriving." />
      <div className="wrap" style={{ paddingTop: 40 }}>
        {short && I.days > 0 && <p className="muted" style={{ margin: "0 0 18px" }}>dawns holds {I.days} days of readings; comparisons below span {within}, not a full week.</p>}

        <div className="grid g4" style={{ marginBottom: 28 }}>
          <Stat label={`Net new capital · ${within}`} value={signedUsd(I.flows.total)}
            sub={<>Lending {signedUsd(I.flows.lending)} · liquidity {signedUsd(I.flows.liquidity)}, at today&apos;s prices</>} />
          <Stat label="Ecosystem TVL" value={usd(m.tvlNow)}
            delta={tvlCh != null ? { v: tvlCh, text: `${signedUsd(tvlCh)} in ${within}` } : null}
            sub={kasCh != null ? `Includes price: KAS moved ${kasCh >= 0 ? "+" : "−"}${pct(Math.abs(kasCh), 1)}` : "Includes price moves"} />
          <Stat label={`Swap volume · last ${m.volDays || 7} days`} value={m.vol7 != null ? usd(m.vol7) : "—"}
            delta={volCh != null ? { v: volCh, text: `${volCh >= 0 ? "+" : "−"}${pct(Math.abs(volCh), 0)} on the week before` } : null}
            sub={m.volPrev7 == null ? "Every pool read on-chain; not two full weeks yet" : "Every pool read on-chain"} />
          <Stat label="Lending utilization" value={m.utilNow != null ? pct(m.utilNow, 0) : "—"}
            delta={m.utilNow != null && m.utilThen != null ? { v: m.utilNow - m.utilThen, text: `${pp(m.utilNow - m.utilThen)} in ${within}` } : null}
            sub="Borrowed / supplied, all markets. Higher means tighter exits." />
        </div>

        <div className="card" style={{ marginBottom: 28 }}>
          <div className="c-head"><h3>Capital is moving</h3>
            <span className="muted">{within} · in tokens, at today&apos;s prices</span>
          </div>
          {I.flows.byProtocol.length ? <><FlowBalance rows={I.flows.byProtocol} /><FlowBars rows={I.flows.byProtocol} span={I.span} /></> : <p className="muted">No readings yet.</p>}
          <div className="grid g2" style={{ marginTop: 26 }}>
            <div><h4 className="ihead">Arriving</h4><Movers rows={I.flows.into} kind="flow" empty="No opportunity gained more than $500." /></div>
            <div><h4 className="ihead">Leaving</h4><Movers rows={I.flows.out} kind="flow" empty="No opportunity lost more than $500." /></div>
          </div>
        </div>

        <div className="card" style={{ marginBottom: 28 }}>
          <div className="c-head"><h3>Yield movement</h3><span className="muted">Native yield only · change over {within}</span></div>
          <div className="grid g2">
            <div><h4 className="ihead">Rising</h4><Movers rows={I.yieldUp} kind="yield" empty="No yield rose by more than 15% and 0.25 pp." /></div>
            <div><h4 className="ihead">Falling</h4><Movers rows={I.yieldDown} kind="yield" empty="No yield fell by more than 15% and 0.25 pp." /></div>
          </div>
        </div>

        <div className="card" style={{ marginBottom: 28 }}>
          <div className="c-head"><h3>Emerging</h3><span className="muted">Yield rising, capital not leaving, exit open</span></div>
          {emerging.length ? (
            <div className="grid g3 emerge">
              {emerging.map((o) => {
                const x = I.byOpp[o.id];
                return (
                  <div key={o.id} className="emerge-c">
                    <span className="eyebrow muted">{o.pname} · {o.kind === "supply" ? "lending" : "liquidity"}</span>
                    <b>{o.name}</b>
                    <span className="emerge-y">{o.apy != null ? pct(o.apy, o.apy < 0.1 ? 2 : 1) : "—"}<small>{o.apyShort}</small></span>
                    <Tags tags={x.tags} />
                    <small className="muted">{usd(o.size)} in it · <Pill t={o.status}>{o.statusText}</Pill></small>
                  </div>
                );
              })}
            </div>
          ) : <p className="muted" style={{ margin: 0 }}>Nothing meets all three this week. dawns lists an opportunity here only when its yield rose while its capital and its exit held.</p>}
        </div>

        <div className="grid g2" style={{ marginBottom: 28 }}>
          <div className="card">
            <div className="c-head"><h3>Ecosystem TVL, daily</h3><span className="muted">{m.dates.length - 1} days</span></div>
            {m.tvl.length >= 2 ? <AreaChart label="Ecosystem TVL, daily" dates={m.dates} series={[{ name: "TVL", color: "#9085e9", values: m.tvl }]} zero={false} height={220} /> : <p className="muted">Needs two days of readings.</p>}
          </div>
          <div className="card">
            <div className="c-head"><h3>Swap volume, daily</h3><span className="muted">Completed days</span></div>
            {m.vol.length ? <DayBars label="Swap volume by day" values={m.vol} dates={m.volDates} pos="#3987e5" neg="#3987e5" posLabel="Volume" negLabel="" height={220} /> : <p className="muted">Needs one full day of indexed swaps.</p>}
          </div>
        </div>
        {m.util.length >= 2 && (
          <div className="card" style={{ marginBottom: 28 }}>
            <div className="c-head"><h3>Lending utilization, daily</h3><span className="muted">Borrowed / supplied, all markets</span></div>
            <AreaChart label="Lending utilization, daily" dates={m.utilDates} series={[{ name: "Utilization", color: "#3987e5", values: m.util }]} fmt="pct" zero height={200} />
          </div>
        )}

        <div className="card">
          <div className="c-head"><h3>How dawns measures this</h3></div>
          <div className="vlist">
            <div className="vrow"><span /><div>Capital flows<small>Lending: tokens supplied now minus tokens supplied then, × today&apos;s price. Pools: each reserve now minus then, × today&apos;s token price. The largest 15 pools of each exchange are read. A protocol dawns can only see as a total shows its TVL change, which includes price.</small></div><b /></div>
            <div className="vrow"><span /><div>Yield movement<small>Daily averages of native yield. Lending: the supply rate. Liquidity: that day&apos;s swap volume × the LPs&apos; fee ÷ the pool, per year; only full indexed days count. A move is tagged when it is at least 15% and 0.25 pp.</small></div><b /></div>
            <div className="vrow"><span /><div>Dawns view<small>Tags, not a score: yield rising or falling, capital arriving or leaving (10% of the size), exit tightening or easing (10 pp of the market withdrawable). Hover a tag for its numbers.</small></div><b /></div>
          </div>
        </div>
        <div className="preview" style={{ marginTop: 18 }}>
          <span>Every opportunity carries its own Dawns view and 7- and 30-day yield.</span>
          <span style={{ display: "flex", gap: 10, flexWrap: "wrap" }}><Link className="btn iris" href="/opportunities">Open opportunities</Link></span>
        </div>
      </div>
    </>
  );
}
