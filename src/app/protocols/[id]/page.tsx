import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PROTOCOLS, P, EVENTS, DATES, C, ASSET_COLOR, blockAgo, dexComp, type AssetSym, type Protocol } from "@/lib/data";
import { usd, pct } from "@/lib/format";
import { AssetCoin, Change, Clouds, BANNER_CLOUDS, Pill, ProtocolCoin, UtilMeter } from "@/components/bits";
import { Alert, Check, External, Info, Minus } from "@/components/icons";
import { Kpi, ProvRow, WatchButton } from "@/components/actions";
import { RangeChart, Bars } from "@/components/charts";
import { Feed, SubNav } from "@/components/sections";
import { Fresh } from "@/components/Fresh";
import Link from "next/link";

export function generateStaticParams() {
  return PROTOCOLS.map((p) => ({ id: p.id }));
}
export const dynamicParams = false;

export async function generateMetadata({ params }: PageProps<"/protocols/[id]">): Promise<Metadata> {
  const { id } = await params;
  const p = P[id];
  return p ? { title: `${p.name} health`, description: `On-chain health for ${p.name}: liquidity, ${p.cat === "Lending" ? "utilization, coverage" : "pools, volume"}, contracts and verification.` } : {};
}

function Kpis({ p }: { p: Protocol }) {
  const id = p.id;
  if (p.cat === "Lending")
    return (
      <>
        <Kpi label="Total supplied" value={usd(p.supplied!)} ctx={<><Change v={-0.082} /> 24h</>} prov={`${id}-sup`} />
        <Kpi label="Borrowed" value={usd(p.borrowed!)} ctx={<><Change v={0.012} /> 24h</>} prov={`${id}-bor`} />
        <Kpi label="Available liquidity" value={usd(p.tvl)} ctx={<><Change v={p.d24} /> 24h</>} prov={`${id}-liq`} />
        <Kpi label="Utilization" value={pct(p.util!)} ctx={<><Change v={p.utilD7!} unit="pp" /> 7d</>} prov={`${id}-util`} />
        <Kpi label="Asset coverage" value="100.0%" ctx={<span className="up">Loans backed 310%</span>} prov={`${id}-cov`} />
      </>
    );
  const pools = p.pools!;
  return (
    <>
      <Kpi label="Total liquidity" value={usd(p.tvl)} ctx={<><Change v={p.d24} /> 24h</>} prov={`${id}-tvl`} />
      <Kpi label="24h volume" value={p.vol24 ? usd(p.vol24) : "$0"} ctx={p.vol24 ? <><Change v={0.18} /> vs 7d avg</> : <span className="flat">—</span>} prov={`${id}-vol`} />
      <Kpi label="24h fees" value={`$${p.fees24}`} ctx={<span className="flat">0.30% of volume</span>} prov={`${id}-fee`} />
      <Kpi label="Pools" value={String(p.poolsN)} ctx={<span className="flat">{p.poolsN! - pools.length + 1} under $5K</span>} />
      <Kpi label="Largest pool" value={pct(pools[0].liq / p.tvl)} ctx={<span className="flat">{pools[0].p}</span>} />
    </>
  );
}

function Financials({ p }: { p: Protocol }) {
  if (p.cat === "Lending")
    return (
      <div className="grid gA">
        <div className="card">
          <RangeChart title="Supplied vs borrowed" label="Supplied vs borrowed" legend zero area="all" dates={DATES}
            series={[{ name: "Supplied", color: C.s5, values: p.supS! }, { name: "Borrowed", color: C.s1, values: p.borS! }]} />
        </div>
        <div className="card">
          <div className="c-head"><h3>Balance sheet</h3><span className="tag">block {blockAgo(0)}</span></div>
          <div className="vlist">
            <ProvRow id={`${p.id}-liq`} className="vrow"><span style={{ color: "var(--ink-3)" }}><Info /></span><div>Reserves in pool<small>Tokens held by the contract</small></div><b>{usd(p.tvl)}</b></ProvRow>
            <ProvRow id={`${p.id}-bor`} className="vrow"><span style={{ color: "var(--ink-3)" }}><Info /></span><div>Outstanding loans<small>Owed by 212 borrowers</small></div><b>{usd(p.borrowed!)}</b></ProvRow>
            <div className="vrow"><span /><div><b style={{ fontSize: 15 }}>Total assets</b></div><b>{usd(p.supplied!)}</b></div>
            <ProvRow id={`${p.id}-sup`} className="vrow"><span style={{ color: "var(--ink-3)" }}><Info /></span><div>Supplier claims<small>What the protocol owes depositors</small></div><b>{usd(p.supplied!)}</b></ProvRow>
            <ProvRow id={`${p.id}-cov`} className="vrow"><span style={{ color: "var(--good)" }}><Check /></span><div><b style={{ fontSize: 15 }}>Asset coverage</b><small>Loans backed by $1.09M collateral (310%)</small></div><b className="up">100.0%</b></ProvRow>
          </div>
        </div>
      </div>
    );
  return (
    <div className="grid g2">
      <div className="card"><RangeChart title="Liquidity" label={`${p.name} liquidity`} zero dates={DATES} series={[{ name: "Liquidity", color: C.s2, values: p.series }]} /></div>
      <div className="card">
        <div className="c-head"><h3>Daily volume · 30d</h3><span className="tag">{usd(p.volS!.reduce((a, b) => a + b, 0))} total</span></div>
        <Bars label="Daily volume" values={p.volS!} dates={DATES.slice(-30)} pos={C.s5} neg={C.s4} posLabel="Volume" negLabel="" height={220} />
      </div>
    </div>
  );
}

function Markets({ p }: { p: Protocol }) {
  if (p.cat === "Lending")
    return (
      <>
        <div className="card flush"><div className="tbl-wrap"><table>
          <thead><tr><th>Market</th><th>Supplied</th><th>Borrowed</th><th>Utilization</th><th>Supply APY</th><th>Incentive</th><th>Borrow APY</th><th>Max LTV</th></tr></thead>
          <tbody>
            {p.markets!.map((m) => (
              <tr key={m.a}>
                <td><span className="proto"><AssetCoin a={m.a} size={34} /><b>{m.a}</b></span></td>
                <td>{usd(m.sup)}</td><td>{usd(m.bor)}</td><td><UtilMeter v={m.bor / m.sup} /></td>
                <td><b style={{ fontFamily: "var(--display)" }}>{pct(m.sApy)}</b></td><td><span className="tag">+{pct(m.inc)} KSKD</span></td>
                <td>{pct(m.bApy)}</td><td>{pct(m.ltv, 0)}</td>
              </tr>
            ))}
          </tbody>
        </table></div></div>
        <p className="foot">Supply APY is paid by borrowers. KSKD incentives are token emissions, so dawns shows them separately and never adds them together.</p>
      </>
    );
  return (
    <>
      <div className="card flush"><div className="tbl-wrap"><table>
        <thead><tr><th>Pool</th><th>Liquidity</th><th>24h</th><th>24h volume</th><th>Fee APR</th><th>$10K sale impact</th></tr></thead>
        <tbody>
          {p.pools!.map((q) => (
            <tr key={q.p}>
              <td><span className="proto"><span style={{ display: "flex" }}>{q.a.map((a, j) => (<span key={a} style={j ? { marginLeft: -10 } : undefined}><AssetCoin a={a} size={30} /></span>))}</span><b>{q.p}</b></span></td>
              <td>{usd(q.liq)}</td><td><Change v={q.c24} /></td><td>{q.v ? usd(q.v) : "—"}</td>
              <td>{q.v ? pct((q.v * 0.003 * 365) / q.liq) : "—"}</td>
              <td>{q.liq > 2e4 ? pct(1e4 / (q.liq / 2 + 1e4)) : <span className="muted">too shallow</span>}</td>
            </tr>
          ))}
        </tbody>
      </table></div></div>
      <p className="foot">Fee APR is trading fees only, annualised from 24h volume. Farm rewards are left out.</p>
    </>
  );
}

function Liquidity({ p }: { p: Protocol }) {
  if (p.cat === "Lending")
    return (
      <div className="grid gA">
        <div className="card"><RangeChart title="Utilization by market" label="Utilization by market" legend zero area="none" fmt="pct" refLine={0.8} refLabel="80% rate kink" dates={DATES} series={p.utilS!} /></div>
        <div className="card">
          <div className="c-head"><h3>Withdrawable right now</h3></div>
          <div style={{ display: "grid", gap: 22 }}>
            {p.markets!.map((m) => {
              const a = (m.sup - m.bor) / m.sup;
              return (
                <div key={m.a} style={{ display: "grid", gap: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                    <span className="proto" style={{ gap: 10 }}><AssetCoin a={m.a} size={26} /><b style={{ fontSize: 15 }}>{m.a}</b></span>
                    <span className="muted" style={{ fontSize: 13.5 }}>{usd(m.sup - m.bor)} of {usd(m.sup)}</span>
                  </div>
                  <div className="bar-h"><i style={{ width: `${a * 100}%`, background: ASSET_COLOR[m.a] }} /></div>
                  <span style={{ font: "500 13.5px var(--display)" }} className={a < 0.3 ? "down" : "muted"}>{pct(a)} of suppliers could exit today</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  return (
    <div className="card flush">
      <div className="c-head" style={{ padding: "22px 22px 0" }}><h3>Price impact by trade size</h3><span className="tag">constant-product estimate</span></div>
      <div className="tbl-wrap"><table>
        <thead><tr><th>Pool</th><th>$1K</th><th>$5K</th><th>$10K</th><th>$25K</th></tr></thead>
        <tbody>
          {p.pools!.filter((q) => q.liq > 5000).map((q) => (
            <tr key={q.p}><td><b>{q.p}</b></td>
              {[1e3, 5e3, 1e4, 2.5e4].map((s) => { const im = s / (q.liq / 2 + s); return <td key={s} className={im > 0.05 ? "down" : ""}>{pct(im)}</td>; })}
            </tr>
          ))}
        </tbody>
      </table></div>
    </div>
  );
}

function Assets({ p }: { p: Protocol }) {
  const L = p.cat === "Lending";
  const comp: [AssetSym, number][] = L ? p.markets!.map((m) => [m.a, m.sup]) : dexComp(p);
  const tot = comp.reduce((s, c) => s + c[1], 0);
  const ikas = comp.find((c) => c[0] === "iKAS")?.[1] ?? 0;
  return (
    <div className="grid g2">
      <div className="card">
        <div className="c-head"><h3>{L ? "Supplied assets" : "Assets in pools"}</h3><span className="tag">{usd(tot)}</span></div>
        <div className="stack">{comp.map(([a, v]) => (<i key={a} style={{ width: `${(v / tot) * 100}%`, background: ASSET_COLOR[a] }} />))}</div>
        <div className="comp">{comp.map(([a, v]) => (<div key={a}><AssetCoin a={a} size={28} /><span>{a}</span><b>{usd(v)}</b><small>{pct(v / tot)}</small></div>))}</div>
      </div>
      <div className="card">
        <div className="c-head"><h3>Concentration</h3></div>
        <div className="vlist">
          {L ? (
            <>
              <div className="vrow"><span /><div>Largest supplier<small>Single address</small></div><b>{pct(p.concentration!.top1, 0)}</b></div>
              <div className="vrow"><span /><div>Top 10 suppliers</div><b>{pct(p.concentration!.top10, 0)}</b></div>
              <div className="vrow"><span /><div>Supplier addresses</div><b>{p.concentration!.holders.toLocaleString("en-US")}</b></div>
            </>
          ) : (
            <>
              <div className="vrow"><span /><div>Largest pool<small>{p.pools![0].p}</small></div><b>{pct(p.pools![0].liq / p.tvl, 0)}</b></div>
              <div className="vrow"><span /><div>Top 3 LPs in largest pool</div><b>{p.id === "zealous" ? "47%" : "—"}</b></div>
            </>
          )}
          <div className="vrow"><span style={{ color: "var(--warn)" }}><Alert /></span><div>Exposure to bridged KAS<small>{L ? "iKAS depends on the Igra bridge" : "Every pool pairs against iKAS"}</small></div><b>{pct(ikas / tot, 0)}</b></div>
        </div>
      </div>
    </div>
  );
}

function Activity({ p }: { p: Protocol }) {
  const L = p.cat === "Lending";
  const evs = EVENTS.filter((e) => e.p === p.id);
  return (
    <div className="grid gA">
      <div className="card">
        <div className="c-head"><h3>{L ? "Net deposits and withdrawals" : "Liquidity added and removed"} · 30d</h3></div>
        <div className="legend" style={{ marginBottom: 12 }}><span><i style={{ background: C.s5 }} />{L ? "Net deposits" : "Added"}</span><span><i style={{ background: C.s4 }} />{L ? "Net withdrawals" : "Removed"}</span></div>
        <Bars label="Net flows" values={p.flows} dates={DATES.slice(-30)} pos={C.s5} neg={C.s4} posLabel={L ? "Net deposits" : "Liquidity added"} negLabel={L ? "Net withdrawals" : "Liquidity removed"} diverging height={230} />
      </div>
      <div className="card">
        <div className="c-head"><h3>Recent events</h3></div>
        {evs.length ? <Feed list={evs} /> : <p className="muted" style={{ margin: 0 }}>No notable events in the last 7 days.</p>}
      </div>
    </div>
  );
}

function Contracts({ p }: { p: Protocol }) {
  return (
    <div className="card flush"><div className="tbl-wrap"><table>
      <thead><tr><th>Contract</th><th>Address</th><th>Upgradeability</th><th>Admin</th><th>Can pause</th><th /></tr></thead>
      <tbody>
        {p.contracts.map((c) => (
          <tr key={c.n}>
            <td><b style={{ fontFamily: "var(--display)" }}>{c.n}</b></td><td className="mono" style={{ fontSize: 13 }}>{c.addr}</td>
            <td>{c.up}</td><td>{c.admin}</td><td>{c.pause}</td>
            <td><Pill t={c.t}>{c.t === "good" ? "OK" : c.t === "warn" ? "Review" : "Noted"}</Pill></td>
          </tr>
        ))}
      </tbody>
    </table></div></div>
  );
}

function Verification({ p }: { p: Protocol }) {
  const L = p.cat === "Lending";
  return (
    <div className="grid gA">
      <div className="card">
        <div className="c-head"><h3>What dawns can verify</h3></div>
        <div className="vlist">
          {p.canVerify.map(([a, b, c]) => (<div className="vrow" key={a}><span style={{ color: "var(--good)" }}><Check /></span><div>{a}<small>{b}</small></div><span className="src">{c}</span></div>))}
        </div>
        <div className="c-head" style={{ margin: "26px 0 6px" }}><h3>What dawns cannot verify</h3></div>
        <div className="vlist">
          {p.cannotVerify.map(([a, b]) => (<div className="vrow" key={a}><span style={{ color: "var(--ink-3)" }}><Minus /></span><div>{a}<small>{b}</small></div><span className="src">Off-chain</span></div>))}
        </div>
      </div>
      <div className="card">
        <div className="c-head"><h3>Verification coverage</h3></div>
        <div style={{ display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap" }}>
          <div className="ring" style={{ ["--p" as string]: Math.round(p.verif * 100) }}><span>{pct(p.verif, 0)}</span></div>
          <p style={{ margin: 0, fontSize: 15, color: "var(--ink-2)", flex: 1, minWidth: 180 }}>{pct(p.verif, 0)} of identified {L ? "liabilities and assets" : "reserves and obligations"} are read straight from contracts at a known block.</p>
        </div>
        <div className="note" style={{ marginTop: 20 }}>Click any headline number on this page to see its contract, block, read and calculation.</div>
      </div>
    </div>
  );
}

export default async function ProtocolPage({ params }: PageProps<"/protocols/[id]">) {
  const { id } = await params;
  const p = P[id];
  if (!p) notFound();
  const tabs = ["Financials", p.cat === "Lending" ? "Markets" : "Pools", "Liquidity", "Assets", "Activity", "Contracts", "Verification"];
  const sections = [Financials, Markets, Liquidity, Assets, Activity, Contracts, Verification];
  return (
    <>
      <section className="sky">
        <Clouds set={BANNER_CLOUDS} />
        <div className="wrap banner">
          <div className="crumb"><Link href="/protocols">Protocols</Link><span>/</span><span>{p.name}</span></div>
          <div className="ptitle" style={{ marginTop: 4 }}>
            <div className="l">
              <ProtocolCoin p={p} size={84} />
              <div>
                <h1>{p.name}</h1>
                <div className="tags">
                  <span className="tag">{p.cat}</span><span className="tag">{p.chain}</span><Pill t={p.status}>{p.statusText}</Pill>
                  <span style={{ fontSize: 13.5, color: "rgba(255,255,255,.75)" }}>Updated <Fresh /> ago</span>
                </div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {!p.floor && <WatchButton id={p.id} variant="sun" />}
              {p.site && <a className="btn glass" href={`https://${p.site}`} target="_blank" rel="noopener noreferrer"><External />{p.site}</a>}
            </div>
          </div>
          {p.flags.length > 0 && <div className="tags" style={{ marginTop: 18 }}>{p.flags.map(([t, x]) => (<Pill key={x} t={t}>{x}</Pill>))}</div>}
          {p.floor && <p className="lede" style={{ fontSize: 15 }}>{p.name} holds {usd(p.tvl)}, below the $10K floor for full monitoring. dawns tracks its balances but sends no alerts for it.</p>}
        </div>
      </section>
      <div className="wrap">
        <div className="grid g5 lift"><Kpis p={p} /></div>
        <SubNav tabs={tabs} />
        {sections.map((S, i) => (
          <section className="ps" id={`s-${i}`} key={tabs[i]}>
            <h2>{tabs[i]}</h2>
            <S p={p} />
          </section>
        ))}
      </div>
    </>
  );
}

