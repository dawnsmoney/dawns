import Link from "next/link";
import { getSnapshot } from "@/lib/snapshot";
import { MCard, MFlags, MHead, MHero, MList, MNote, MStats } from "@/components/m/kit";
import { MTabs } from "@/components/m/tabs";
import { MProtocolRow } from "@/components/m/rows";
import { SplitBar } from "@/components/viz";
import { AreaChart } from "@/components/charts";
import { DataBridge } from "@/components/providers";
import { Fresh } from "@/components/Fresh";
import { SERIES, assetColor } from "@/components/bits";
import { toLite } from "@/lib/view";
import { usd, pct } from "@/lib/format";

export const revalidate = 120;

export default async function MHome() {
  const s = await getSnapshot();
  const onchain = s.eco.tvl ? s.protocols.filter((p) => p.source === "onchain").reduce((a, p) => a + p.tvl, 0) / s.eco.tvl : 0;
  const warn = s.signals.filter((g) => g.t === "crit" || g.t === "warn");
  const blocked = s.opportunities.filter((o) => o.status === "crit");
  const comp = s.eco.composition.filter((c) => c.usd > 0);
  const parts = [...comp.slice(0, 5).map((c, i) => ({ key: c.sym, label: c.sym, color: assetColor(c.sym) !== "#6E6788" ? assetColor(c.sym) : SERIES[i % 5], share: c.usd })),
    ...(comp.length > 5 ? [{ key: "other", label: "Other", color: "#4A4270", share: comp.slice(5).reduce((a, c) => a + c.usd, 0) }] : [])];
  const byTvl = [...s.protocols].sort((a, b) => b.tvl - a.tvl);
  return (
    <>
      <DataBridge prov={s.prov} protocols={s.protocols.map(toLite)} signals={s.signals} />
      <MHead eyebrow={<>Kaspa DeFi · updated <Fresh since={s.asOf} /></>} title="Kaspa DeFi, in plain daylight" />
      <div className="m-screen">
        <MHero label="Value locked in Kaspa DeFi" value={usd(s.eco.tvl)}
          sub={<>{s.protocols.length} protocols · {pct(onchain, 0)} read on-chain{s.kas24 != null ? <> · KAS {s.kas24 >= 0 ? "+" : ""}{pct(s.kas24, 1)} 24h</> : null}</>} />
        <MStats items={[
          { label: "Lending, withdrawable", value: usd(s.eco.lendingLiq), sub: s.eco.lendingUtil != null ? `${pct(s.eco.lendingUtil)} utilized` : undefined },
          { label: "DEX liquidity", value: usd(s.eco.dexLiq), sub: `${s.protocols.filter((p) => p.kind === "dex" && p.tvl > 0).length} DEXs` },
          { label: "Exits blocked", value: String(blocked.length), sub: blocked.length ? blocked.map((o) => o.assets[0]).join(", ") : "every market can be left", tone: blocked.length ? "crit" : "good" },
          ...(s.bridge ? [{ label: "iKAS backing", value: pct(s.bridge.coverage, 1), sub: "KAS locked ÷ iKAS", tone: (s.bridge.coverage >= 1 ? "good" : "crit") as "good" | "crit" }] : []),
        ]} />

        <MTabs tabs={[{ key: "now", label: "Right now", badge: warn.length || null }, { key: "protocols", label: "Protocols", badge: s.protocols.length }, { key: "value", label: "Where value sits" }]}>
          <div className="m-panel">
            <MCard title="Worth a look" tag={warn.length ? `${warn.length} warnings` : "all clear"}>
              {warn.length ? <MFlags flags={warn.slice(0, 6).map((g) => [g.t, g.strong] as [typeof g.t, string])} /> : <MNote>Nothing needs attention at the latest block.</MNote>}
            </MCard>
            <MCard title="Largest protocols" flush>
              <MList>{byTvl.slice(0, 4).map((p) => <MProtocolRow key={p.id} p={p} />)}</MList>
            </MCard>
            <div className="m-stats">
              <Link href="/opportunities" className="m-card" style={{ textDecoration: "none", color: "var(--ink)" }}><b style={{ font: "600 16px var(--display)" }}>Yield →</b><small className="muted">Native yield next to what it costs to leave</small></Link>
              <Link href="/strategies" className="m-card" style={{ textDecoration: "none", color: "var(--ink)" }}><b style={{ font: "600 16px var(--display)" }}>Strategies →</b><small className="muted">Splits with rules, checked live</small></Link>
            </div>
          </div>
          <div className="m-panel">
            <MCard flush><MList>{byTvl.map((p) => <MProtocolRow key={p.id} p={p} />)}</MList></MCard>
            <MNote>Value locked read on-chain where dawns reads the contracts; the rest from DefiLlama.</MNote>
          </div>
          <div className="m-panel">
            <MCard title="By asset" tag={usd(s.eco.tvl)}>
              {parts.length ? <SplitBar parts={parts} label="Value by asset" height={20} /> : <MNote>No composition data this run.</MNote>}
            </MCard>
            <MCard title="Value locked" tag="daily">
              {s.eco.series.length > 2
                ? <AreaChart series={[{ name: "TVL", color: "#8578E6", values: s.eco.series.map((p) => p.v) }]} dates={s.eco.series.map((p) => p.t)} label="Kaspa DeFi value locked" height={190} range="3M" />
                : <MNote>History unavailable this run.</MNote>}
            </MCard>
          </div>
        </MTabs>
      </div>
    </>
  );
}
