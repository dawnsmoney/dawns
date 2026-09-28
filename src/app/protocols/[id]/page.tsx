import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getSnapshot, findProtocol } from "@/lib/snapshot";
import { toLite, names } from "@/lib/view";
import type { ProtocolView, Snapshot } from "@/lib/types";
import { usd, pct } from "@/lib/format";
import { AssetCoin, Change, Clouds, BANNER_CLOUDS, Pill, ProtocolCoin, UtilMeter, SERIES, assetColor } from "@/components/bits";
import { Alert, Check, External, Info, Minus } from "@/components/icons";
import { Kpi, ProvRow, WatchButton } from "@/components/actions";
import { RangeChart, Bars, AreaChart } from "@/components/charts";
import { Feed, SubNav } from "@/components/sections";
import { DataBridge } from "@/components/providers";
import { Fresh } from "@/components/Fresh";
import { getAssets } from "@/lib/assets";
import { assetPath } from "@/lib/assets/types";

/** Asset profile links for this protocol: by chain:address, and by symbol for composition. */
type Links = Map<string, string>;
const AssetName = ({ sym, href }: { sym: string; href?: string }) => (href ? <Link href={href}>{sym}</Link> : <>{sym}</>);

export const revalidate = 120;
export const dynamicParams = true;

export async function generateStaticParams() {
  try {
    const s = await getSnapshot();
    return s.protocols.map((p) => ({ id: p.id }));
  } catch {
    return [];
  }
}

export async function generateMetadata({ params }: PageProps<"/protocols/[id]">): Promise<Metadata> {
  const { id } = await params;
  const p = findProtocol(await getSnapshot(), id);
  return p ? { title: `${p.name} health`, description: `Live health for ${p.name} in Kaspa DeFi: liquidity, ${p.kind === "lending" ? "utilization, coverage, oracle checks" : "pools and depth"}, contracts and verification.` } : {};
}

const explorer = (chain: string, a: string) => `${chain === "kasplex" ? "https://explorer.kasplex.org" : "https://explorer.igralabs.com"}/address/${a}`;
const short = (a: string) => (a.startsWith("0x") && a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

function Kpis({ p }: { p: ProtocolView }) {
  const id = p.id;
  if (p.lending) {
    const L = p.lending;
    return (
      <>
        <Kpi label="Total supplied" value={usd(L.suppliedUsd)} ctx={<>{L.markets.length} markets</>} prov={`${id}-sup`} />
        <Kpi label="Borrowed" value={usd(L.borrowedUsd)} ctx={<>{pct(L.utilization)} of supply</>} prov={`${id}-bor`} />
        <Kpi label="Withdrawable now" value={usd(L.cashUsd)} ctx={<Change v={p.d24} />} prov={`${id}-liq`} />
        <Kpi label="Utilization" value={pct(L.utilization)} ctx={<span className={L.utilization > 0.8 ? "down" : "flat"}>{L.utilization > 0.8 ? "high" : "healthy range"}</span>} prov={`${id}-util`} />
        <Kpi label="Asset coverage" value={pct(L.coverage)} ctx={<span className={L.coverage >= 1 ? "up" : "down"}>{L.coverage >= 1 ? "claims covered" : "claims not covered"}</span>} prov={`${id}-cov`} />
      </>
    );
  }
  if (p.dex) {
    const d = p.dex;
    return (
      <>
        <Kpi label="Total liquidity" value={usd(p.tvl)} ctx={<><Change v={p.d24} /> 24h</>} prov={`${id}-tvl`} />
        <Kpi label="24h volume" value={d.vol24 != null ? usd(d.vol24) : "—"} ctx={<span className="flat">{p.activity && p.asOf && p.activity.upTo > p.asOf.timestamp * 1000 - 45 * 60_000 ? "read on-chain" : "DefiLlama"}</span>} prov={`${id}-vol`} />
        <Kpi label="24h fees" value={d.fees24 != null ? usd(d.fees24) : "—"} ctx={<span className="flat">{d.fees24 != null && p.tvl ? `${pct((d.fees24 * 365) / p.tvl)} fee APR` : "—"}</span>} prov={`${id}-fee`} />
        <Kpi label="Pools" value={String(d.pairCount)} ctx={<span className="flat">{d.pools.filter((x) => x.usd >= 1000).length} over $1K</span>} />
        <Kpi label="Largest pool" value={d.pools[0] ? pct(d.pools[0].share) : "—"} ctx={<span className="flat">{d.pools[0]?.symbols.join(" / ")}</span>} />
      </>
    );
  }
  return (
    <>
      <Kpi label="Total value locked" value={usd(p.tvl)} ctx={<span className="flat">DefiLlama</span>} prov={`${id}-tvl`} />
      <Kpi label="24h" value={p.d24 != null ? `${(p.d24 * 100).toFixed(1)}%` : "—"} ctx={<Change v={p.d24} />} />
      <Kpi label="7d" value={p.d7 != null ? `${(p.d7 * 100).toFixed(1)}%` : "—"} ctx={<Change v={p.d7} />} />
      <Kpi label="Networks" value={String(p.chains.length)} ctx={<span className="flat">{p.chains.join(", ")}</span>} />
      <Kpi label="Category" value={p.category} ctx={<span className="flat">{p.source === "onchain" ? "read on-chain" : "not yet read on-chain"}</span>} />
    </>
  );
}

function History({ p }: { p: ProtocolView }) {
  if (p.history.length < 3) return <p className="muted">No history yet.</p>;
  return (
    <>
      <RangeChart title={p.lending ? "Withdrawable liquidity (TVL)" : "Value locked"} label={`${p.name} TVL`} zero dates={p.history.map((h) => h.t)} series={[{ name: "TVL", color: SERIES[1], values: p.history.map((h) => h.v) }]} />
      <p className="foot">Daily history from DefiLlama{p.historyCleaned > 0 ? ` (${p.historyCleaned} mispriced day${p.historyCleaned > 1 ? "s" : ""} smoothed out)` : ""}{p.source === "onchain" ? `. Today's figure on this page is read on-chain (${usd(p.tvl)}); DefiLlama currently shows ${usd(p.llamaTvl)}.` : "."}</p>
    </>
  );
}

function Financials({ p }: { p: ProtocolView }) {
  if (p.lending) {
    const L = p.lending;
    return (
      <div className="grid gA">
        <div className="card"><History p={p} /></div>
        <div className="card">
          <div className="c-head"><h3>Balance sheet</h3>{p.asOf && <span className="tag">block #{p.asOf.block.toLocaleString("en-US")}</span>}</div>
          <div className="vlist">
            <ProvRow id={`${p.id}-liq`} className="vrow"><span style={{ color: "var(--ink-3)" }}><Info /></span><div>Cash in the markets<small>Tokens held by the aToken contracts</small></div><b>{usd(L.cashUsd)}</b></ProvRow>
            <ProvRow id={`${p.id}-bor`} className="vrow"><span style={{ color: "var(--ink-3)" }}><Info /></span><div>Outstanding loans<small>Owed by borrowers</small></div><b>{usd(L.borrowedUsd)}</b></ProvRow>
            <div className="vrow"><span /><div><b style={{ fontSize: 15 }}>Total assets</b></div><b>{usd(L.cashUsd + L.borrowedUsd)}</b></div>
            <ProvRow id={`${p.id}-sup`} className="vrow"><span style={{ color: "var(--ink-3)" }}><Info /></span><div>Supplier claims<small>What the protocol owes depositors</small></div><b>{usd(L.suppliedUsd)}</b></ProvRow>
            <ProvRow id={`${p.id}-cov`} className="vrow"><span style={{ color: L.coverage >= 1 ? "var(--good)" : "var(--crit)" }}>{L.coverage >= 1 ? <Check /> : <Alert />}</span><div><b style={{ fontSize: 15 }}>Asset coverage</b><small>Assets ÷ supplier claims</small></div><b className={L.coverage >= 1 ? "up" : "down"}>{pct(L.coverage)}</b></ProvRow>
          </div>
        </div>
      </div>
    );
  }
  if (p.dex) {
    const d = p.dex;
    return (
      <div className="grid gA">
        <div className="card"><History p={p} /></div>
        <div className="card">
          <div className="c-head"><h3>By network</h3></div>
          <div style={{ display: "grid", gap: 18 }}>
            {(["igra", "kasplex"] as const).map((c, i) => (
              <div key={c} style={{ display: "grid", gap: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}><b style={{ fontFamily: "var(--display)" }}>{c === "igra" ? "Igra" : "Kasplex"}</b><span>{usd(d.byChain[c])}</span></div>
                <div className="bar-h"><i style={{ width: `${p.tvl ? (d.byChain[c] / p.tvl) * 100 : 0}%`, background: SERIES[i + 1] }} /></div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }
  return <div className="card"><History p={p} /></div>;
}

function Markets({ p, links }: { p: ProtocolView; links: Links }) {
  if (p.lending)
    return (
      <>
        <div className="card flush"><div className="tbl-wrap"><table>
          <thead><tr><th>Market</th><th>Supplied</th><th>Borrowed</th><th>Utilization</th><th>Supply APY</th><th>Borrow APR</th><th>Max LTV</th><th>State</th></tr></thead>
          <tbody>
            {p.lending.markets.map((m) => (
              <tr key={m.symbol}>
                <td><span className="proto"><AssetCoin a={m.symbol} size={34} /><span><b><AssetName sym={m.symbol} href={links.get(`igra:${m.asset.toLowerCase()}`)} /></b><small>{m.supplied.toLocaleString("en-US", { maximumFractionDigits: m.supplied < 10 ? 4 : 0 })} tokens</small></span></span></td>
                <td>{usd(m.suppliedUsd)}</td><td>{usd(m.borrowedUsd)}</td><td><UtilMeter v={m.utilization} /></td>
                <td><b style={{ fontFamily: "var(--display)" }}>{pct(m.supplyApy, 2)}</b></td><td>{pct(m.borrowApr, 2)}</td><td>{pct(m.ltv, 0)}</td>
                <td>{m.frozen ? <Pill t="warn">Frozen</Pill> : m.paused ? <Pill t="crit">Paused</Pill> : m.utilization >= 0.95 ? <Pill t="crit">No liquidity</Pill> : <Pill t="good">Active</Pill>}</td>
              </tr>
            ))}
          </tbody>
        </table></div></div>
        <p className="foot">Rates are read from the pool at the block above. Supply APY is paid by borrowers; KSKD incentives are separate and not included.</p>
      </>
    );
  if (p.dex)
    return (
      <>
        <div className="card flush"><div className="tbl-wrap"><table>
          <thead><tr><th>Pool</th><th>Network</th><th>Liquidity</th><th>Share</th><th>Reserves</th><th>$10K trade impact</th></tr></thead>
          <tbody>
            {p.dex.pools.slice(0, 15).map((q) => (
              <tr key={q.chain + q.pair}>
                <td><span className="proto"><span style={{ display: "flex" }}>{q.symbols.map((a, j) => (<span key={j} style={j ? { marginLeft: -10 } : undefined}><AssetCoin a={a} size={30} /></span>))}</span><b>{q.symbols.map((a, j) => (<span key={j}>{j ? " / " : ""}<AssetName sym={a} href={links.get(`${q.chain}:${q.tk[j].a.toLowerCase()}`)} /></span>))}</b><a href={explorer(q.chain, q.pair)} target="_blank" rel="noopener noreferrer" aria-label={`${q.symbols.join(" / ")} pool on the explorer`} title="Pool on the explorer" style={{ display: "inline-flex", color: "var(--ink-3)" }}><External width={14} height={14} /></a></span></td>
                <td>{q.chain === "igra" ? "Igra" : "Kasplex"}</td>
                <td>{usd(q.usd)}</td><td>{pct(q.share)}</td>
                <td className="muted" style={{ fontSize: 13 }}>{q.reserves.map((r, j) => `${r.toLocaleString("en-US", { maximumFractionDigits: r < 10 ? 3 : 0 })} ${q.symbols[j]}`).join(" + ")}</td>
                <td className={q.impact10k != null && q.impact10k > 0.05 ? "down" : ""}>{q.usd > 2e4 && q.impact10k != null ? pct(q.impact10k) : <span className="muted">too shallow</span>}</td>
              </tr>
            ))}
          </tbody>
        </table></div></div>
        <p className="foot">Top {Math.min(15, p.dex.pools.length)} of {p.dex.pairCount} pools, valued at twice their priced side. Impact is the constant-product price move for a $10K trade.</p>
      </>
    );
  return null;
}

function Liquidity({ p }: { p: ProtocolView }) {
  if (!p.lending) return null;
  return (
    <div className="grid g2">
      <div className="card">
        <div className="c-head"><h3>Withdrawable right now</h3></div>
        <div style={{ display: "grid", gap: 22 }}>
          {p.lending.markets.map((m) => {
            const a = m.supplied ? Math.max(0, m.cash / m.supplied) : 0;
            return (
              <div key={m.symbol} style={{ display: "grid", gap: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                  <span className="proto" style={{ gap: 10 }}><AssetCoin a={m.symbol} size={26} /><b style={{ fontSize: 15 }}>{m.symbol}</b></span>
                  <span className="muted" style={{ fontSize: 13.5 }}>{usd(m.cashUsd)} of {usd(m.suppliedUsd)}</span>
                </div>
                <div className="bar-h"><i style={{ width: `${Math.min(100, a * 100)}%`, background: assetColor(m.symbol) }} /></div>
                <span style={{ font: "500 13.5px var(--display)" }} className={a < 0.2 ? "down" : "muted"}>{pct(a)} of {m.symbol} suppliers could exit now</span>
              </div>
            );
          })}
        </div>
      </div>
      <div className="card flush">
        <div className="c-head" style={{ padding: "22px 22px 0" }}><h3>Oracle vs market</h3><span className="tag">liquidation prices</span></div>
        <div className="tbl-wrap"><table>
          <thead><tr><th>Asset</th><th>Oracle</th><th>Market</th><th>Gap</th></tr></thead>
          <tbody>
            {p.lending.markets.map((m) => (
              <tr key={m.symbol}>
                <td><b>{m.symbol}</b></td>
                <td>{m.oracleOk ? `$${m.price.toPrecision(5)}` : <span className="down">Reverted</span>}</td>
                <td>{m.marketPrice != null ? `$${m.marketPrice.toPrecision(5)}` : "—"}</td>
                <td className={m.oracleDeviation != null && Math.abs(m.oracleDeviation) >= 0.02 ? "down" : "muted"}>{m.oracleDeviation != null ? `${m.oracleDeviation >= 0 ? "+" : ""}${(m.oracleDeviation * 100).toFixed(2)}%` : m.oracleOk ? "—" : m.oracleError}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>
    </div>
  );
}

function Assets({ p, links }: { p: ProtocolView; links: Links }) {
  const comp = p.tokens.filter((t) => t.usd > 0);
  const tot = comp.reduce((s, c) => s + c.usd, 0);
  if (!comp.length) return <p className="muted">No composition data.</p>;
  const colors = comp.map((c, i) => (assetColor(c.sym) !== "#6E6788" ? assetColor(c.sym) : SERIES[(i + 2) % 5]));
  return (
    <div className="card">
      <div className="c-head"><h3>{p.lending ? "Cash held by asset" : "Assets held"}</h3><span className="tag">{usd(tot)}</span></div>
      <div className="stack">{comp.map((c, i) => (<i key={c.sym} style={{ width: `${(c.usd / tot) * 100}%`, background: colors[i] }} />))}</div>
      <div className="comp">{comp.slice(0, 8).map((c) => (<div key={c.sym}><AssetCoin a={c.sym} size={28} /><span><AssetName sym={c.sym} href={links.get(`sym:${c.sym.toUpperCase()}`)} /></span><b>{usd(c.usd)}</b><small>{pct(c.usd / tot)}</small></div>))}</div>
    </div>
  );
}

const EV_TXT: Record<string, string> = { swap: "Swap", remove: "Liquidity removed", supply: "Supply", withdraw: "Withdrawal", borrow: "Borrow", repay: "Repay", liquidation: "Liquidation" };
const txUrl = (chain: string, tx: string) => `${chain === "kasplex" ? "https://explorer.kasplex.org" : "https://explorer.igralabs.com"}/tx/${tx}`;
const since = (t: number, now: number) => { const h = Math.max(0, (now - t) / 3600_000); return h < 1 ? `${Math.max(1, Math.round(h * 60))} min ago` : h < 48 ? `${Math.round(h)} h ago` : `${Math.round(h / 24)} days ago`; };

function Activity({ p, s }: { p: ProtocolView; s: Snapshot }) {
  const sig = s.signals.filter((g) => g.p === p.id);
  const a = p.activity;
  const hoursIndexed = a && a.upTo > s.asOf - 45 * 60_000 ? (s.asOf - a.since) / 3600_000 : 0;
  const behind = a && a.upTo <= s.asOf - 45 * 60_000;
  return (
    <div style={{ display: "grid", gap: 22 }}>
      {(p.intraday.length >= 3 || a) && (
        <div className="grid gA">
          <div className="card">
            <div className="c-head"><h3>{p.lending ? "Withdrawable liquidity" : "Value locked"} · hourly</h3><span className="tag">dawns history</span></div>
            {p.intraday.length >= 3
              ? <AreaChart label={`${p.name} hourly`} hourly zero={false} dates={p.intraday.map((x) => x.t)} series={[{ name: p.lending ? "Withdrawable" : "TVL", color: SERIES[2], values: p.intraday.map((x) => x.v) }]} height={230} />
              : <p className="muted">dawns started recording this protocol recently. The hourly chart appears after a few readings.</p>}
            <p className="foot">Read by dawns every 10 minutes and stored in its own database{p.d24Source === "dawns" ? ". The 24h change on this page uses these readings." : "."}</p>
          </div>
          {a && p.dex && (
            <div className="card">
              <div className="c-head"><h3>Swap volume</h3><span className="tag">{behind ? "catching up" : hoursIndexed >= 24 ? "on-chain" : `indexing · ${Math.floor(hoursIndexed)}h of 24h`}</span></div>
              <div className="vlist" style={{ marginBottom: 14 }}>
                <div className="vrow"><span /><div>Last 24 hours<small>{a.swaps24.toLocaleString("en-US")} swaps</small></div><b>{usd(a.vol24)}</b></div>
                <div className="vrow"><span /><div>Last 7 days</div><b>{a.vol7 != null ? usd(a.vol7) : "—"}</b></div>
              </div>
              {a.volDays.length >= 3 && <Bars label="Daily swap volume" values={a.volDays.map((d) => d.v)} dates={a.volDays.map((d) => d.t)} pos={SERIES[1]} neg={SERIES[3]} posLabel="Volume" negLabel="" height={170} />}
              <p className="foot">Every Swap event on every pool, valued at the priced leg at current token prices.</p>
            </div>
          )}
          {a && p.lending && (
            <div className="card flush">
              <div style={{ padding: "22px 24px 8px" }} className="c-head"><h3>Flows · last 24 hours</h3><span className="tag">{behind ? "catching up" : hoursIndexed >= 24 ? "on-chain" : `indexing · ${Math.floor(hoursIndexed)}h`}</span></div>
              <div className="tbl-wrap"><table>
                <thead><tr><th>Market</th><th>Supplied</th><th>Withdrawn</th><th>Borrowed</th><th>Repaid</th></tr></thead>
                <tbody>
                  {a.lendFlows.length ? a.lendFlows.sort((x, y) => y.supply + y.withdraw - x.supply - x.withdraw).map((f) => (
                    <tr key={f.market}><td><span className="proto"><AssetCoin a={f.market} size={28} /><b>{f.market}</b></span></td><td>{usd(f.supply)}</td><td>{usd(f.withdraw)}</td><td>{usd(f.borrow)}</td><td>{usd(f.repay)}</td></tr>
                  )) : <tr><td colSpan={5} className="muted">No supply, withdrawal, borrow or repay in the last 24 hours.</td></tr>}
                </tbody>
              </table></div>
            </div>
          )}
        </div>
      )}
      {a && a.events.length > 0 && (
        <div className="card flush"><div className="tbl-wrap"><table>
          <thead><tr><th>Largest events · 7 days</th><th>Value</th><th>When</th><th>Transaction</th></tr></thead>
          <tbody>
            {a.events.slice(0, 10).map((e) => (
              <tr key={e.tx + e.kind + e.usd}>
                <td><b>{EV_TXT[e.kind] ?? e.kind}</b> <span className="muted">{e.label}</span></td>
                <td>{usd(e.usd)}</td><td className="muted">{since(e.t, s.asOf)}</td>
                <td className="mono" style={{ fontSize: 13 }}><a href={txUrl(e.chain, e.tx)} target="_blank" rel="noopener noreferrer">{e.tx.slice(0, 10)}…</a></td>
              </tr>
            ))}
          </tbody>
        </table></div></div>
      )}
      <div className="grid gA">
        <div className="card">
          <div className="c-head"><h3>Net flows · 30 days</h3><span className="tag">DefiLlama token balances</span></div>
          {p.flows.length > 3
            ? <Bars label="Net flows" values={p.flows.map((f) => f.v)} dates={p.flows.map((f) => f.t)} pos={SERIES[4]} neg={SERIES[3]} posLabel="Net inflow" negLabel="Net outflow" diverging height={230} />
            : <p className="muted">Not enough history.</p>}
        </div>
        <div className="card">
          <div className="c-head"><h3>Signals</h3></div>
          <Feed list={sig} names={names(s)} />
        </div>
      </div>
    </div>
  );
}

function Borrowers({ p }: { p: ProtocolView }) {
  const P = p.lending?.positions;
  if (!P) return <p className="muted">dawns is still reading every account. This appears after the next runs.</p>;
  const maxDebt = Math.max(1, ...P.buckets.map((b) => b.debtUsd));
  const hfColor = (hf: number | null) => (hf == null ? "var(--ink-3)" : hf < 1 ? "var(--crit)" : hf < 1.1 ? "var(--warn)" : "var(--good)");
  return (
    <div style={{ display: "grid", gap: 22 }}>
      <div className="grid gA">
        <div className="card">
          <div className="c-head"><h3>Debt by health factor</h3><span className="tag">{P.borrowers} borrowers</span></div>
          <div style={{ display: "grid", gap: 14 }}>
            {P.buckets.map((b, i) => (
              <div key={b.label} style={{ display: "grid", gap: 6 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14.5 }}><span>{b.label}</span><span><b>{usd(b.debtUsd)}</b> <span className="muted">· {b.accounts}</span></span></div>
                <div className="bar-h"><i style={{ width: `${(b.debtUsd / maxDebt) * 100}%`, background: i === 0 ? "var(--crit)" : i === 1 ? "var(--warn)" : SERIES[2] }} /></div>
              </div>
            ))}
          </div>
          <p className="foot">Health factor below 1 means the loan can be liquidated. Computed from every account&apos;s balances at market prices.</p>
        </div>
        <div className="card">
          <div className="c-head"><h3>Solvency of loans</h3></div>
          <div className="vlist">
            <ProvRow id={`${p.id}-pos`} className="vrow"><span style={{ color: "var(--ink-3)" }}><Info /></span><div>Accounts ever active<small>{P.suppliers} with a balance now · {P.borrowers} borrowing</small></div><b>{P.accounts.toLocaleString("en-US")}</b></ProvRow>
            <div className="vrow"><span /><div>Debt outstanding</div><b>{usd(P.debtUsd)}</b></div>
            <div className="vrow"><span style={{ color: P.liquidatableUsd > 0 ? "var(--warn)" : "var(--good)" }}>{P.liquidatableUsd > 0 ? <Alert /> : <Check />}</span><div>Can be liquidated now<small>{P.liquidatable} accounts below 1.0</small></div><b>{usd(P.liquidatableUsd)}</b></div>
            <div className="vrow"><span style={{ color: P.badDebtUsd > 0 ? "var(--crit)" : "var(--good)" }}>{P.badDebtUsd > 0 ? <Alert /> : <Check />}</span><div><b style={{ fontSize: 15 }}>Bad debt</b><small>Debt larger than collateral · {P.badDebtAccounts} accounts</small></div><b className={P.badDebtUsd > 0 ? "down" : "up"}>{usd(P.badDebtUsd)}</b></div>
          </div>
          {P.unread > 0 && <p className="foot">{P.unread} accounts hold no balance now.</p>}
        </div>
      </div>
      <div className="card flush"><div className="tbl-wrap"><table>
        <thead><tr><th>Largest borrowers</th><th>Collateral</th><th>Debt</th><th>Health factor</th></tr></thead>
        <tbody>
          {P.top.map((b) => (
            <tr key={b.address}>
              <td className="mono" style={{ fontSize: 13 }}><a href={explorer("igra", b.address)} target="_blank" rel="noopener noreferrer">{short(b.address)}</a></td>
              <td>{usd(b.collateralUsd)}</td><td>{usd(b.debtUsd)}</td>
              <td><b style={{ color: hfColor(b.hf), fontFamily: "var(--display)" }}>{b.hf == null ? "—" : b.hf > 100 ? ">100" : b.hf.toFixed(2)}</b></td>
            </tr>
          ))}
        </tbody>
      </table></div></div>
    </div>
  );
}

function Contracts({ p }: { p: ProtocolView }) {
  if (!p.contracts.length) return <p className="muted">dawns has not mapped this protocol&apos;s contracts yet.</p>;
  return (
    <div className="card flush"><div className="tbl-wrap"><table>
      <thead><tr><th>Contract</th><th>Address</th><th>Upgradeability</th><th>Control</th><th>Can pause</th><th /></tr></thead>
      <tbody>
        {p.contracts.map((c) => (
          <tr key={c.n + c.chain}>
            <td><b style={{ fontFamily: "var(--display)" }}>{c.n}</b></td>
            <td className="mono" style={{ fontSize: 13 }}><a href={explorer(c.chain, c.addr)} target="_blank" rel="noopener noreferrer">{short(c.addr)}</a></td>
            <td>{c.up}</td><td>{c.admin}</td><td>{c.pause}</td>
            <td><Pill t={c.t}>{c.t === "good" ? "OK" : c.t === "warn" ? "Review" : "Noted"}</Pill></td>
          </tr>
        ))}
      </tbody>
    </table></div></div>
  );
}

function Verification({ p }: { p: ProtocolView }) {
  const share = p.verifiedShare ?? 0;
  return (
    <div className="grid gA">
      <div className="card">
        {p.canVerify.length > 0 && (
          <>
            <div className="c-head"><h3>What dawns reads directly</h3></div>
            <div className="vlist">
              {p.canVerify.map(([a, b, c]) => (<div className="vrow" key={a}><span style={{ color: "var(--good)" }}><Check /></span><div>{a}<small>{b}</small></div><span className="src">{c}</span></div>))}
            </div>
          </>
        )}
        <div className="c-head" style={{ margin: p.canVerify.length ? "26px 0 6px" : "0 0 6px" }}><h3>What dawns cannot verify yet</h3></div>
        <div className="vlist">
          {p.cannotVerify.map(([a, b]) => (<div className="vrow" key={a}><span style={{ color: "var(--ink-3)" }}><Minus /></span><div>{a}<small>{b}</small></div><span className="src">Pending</span></div>))}
        </div>
      </div>
      <div className="card">
        <div className="c-head"><h3>Source of headline figures</h3></div>
        <div style={{ display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap" }}>
          <div className="ring" style={{ ["--p" as string]: Math.round(share * 100) }}><span>{pct(share, 0)}</span></div>
          <p style={{ margin: 0, fontSize: 15, color: "var(--ink-2)", flex: 1, minWidth: 180 }}>
            {p.source === "onchain" ? "Read from contracts at a known block. Click any headline number for the contract, block and calculation." : "Taken from DefiLlama. dawns will read this protocol directly once its contracts are mapped."}
          </p>
        </div>
        {p.audits.length > 0 && (
          <div style={{ marginTop: 20, display: "flex", gap: 8, flexWrap: "wrap" }}>
            {p.audits.slice(0, 3).map((a, i) => (<a key={a} className="btn ghost sm" href={a} target="_blank" rel="noopener noreferrer"><External />Audit {i + 1}</a>))}
          </div>
        )}
      </div>
    </div>
  );
}

export default async function ProtocolPage({ params }: PageProps<"/protocols/[id]">) {
  const { id } = await params;
  const [s, assets] = await Promise.all([getSnapshot(), getAssets()]);
  const p = findProtocol(s, id);
  if (!p) notFound();
  const links: Links = new Map();
  for (const a of assets) {
    if (a.standard !== "erc20") continue;
    links.set(`${a.chain}:${a.ref}`, assetPath(a.id));
    if (!a.pools.some((x) => x.startsWith(`${p.id}:`))) continue;
    const k = `sym:${a.symbol.toUpperCase()}`;
    if (!links.has(k)) links.set(k, assetPath(a.id));
  }
  // composition groups KAS wrappers as KAS: point it at the KAS profile
  if (assets.some((a) => a.id === "kaspa:native:KAS")) links.set("sym:KAS", assetPath("kaspa:native:KAS"));
  const tabs: [string, React.ReactNode][] = [
    ["Financials", <Financials key="f" p={p} />],
    ...(p.lending || p.dex ? ([[p.lending ? "Markets" : "Pools", <Markets key="m" p={p} links={links} />]] as [string, React.ReactNode][]) : []),
    ...(p.lending ? ([["Liquidity", <Liquidity key="l" p={p} />], ["Borrowers", <Borrowers key="b" p={p} />]] as [string, React.ReactNode][]) : []),
    ["Assets", <Assets key="a" p={p} links={links} />],
    ["Activity", <Activity key="ac" p={p} s={s} />],
    ["Contracts", <Contracts key="c" p={p} />],
    ["Verification", <Verification key="v" p={p} />],
  ];
  return (
    <>
      <DataBridge prov={s.prov} protocols={s.protocols.map(toLite)} signals={s.signals} />
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
                  <span className="tag">{p.category}</span>
                  {p.chains.map((c) => (<span className="tag" key={c}>{c}</span>))}
                  <Pill t={p.status}>{p.statusText}</Pill>
                  <span style={{ fontSize: 13.5, color: "rgba(255,255,255,.8)" }}>
                    {p.source === "onchain" && p.asOf ? <>Read at block #{p.asOf.block.toLocaleString("en-US")} · <Fresh since={p.asOf.timestamp * 1000} /></> : <>DefiLlama · <Fresh since={s.asOf} /></>}
                  </span>
                </div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {!p.floor && <WatchButton id={p.id} variant="sun" />}
              {p.site && <a className="btn glass" href={`https://${p.site}`} target="_blank" rel="noopener noreferrer"><External />{p.site}</a>}
            </div>
          </div>
          {p.flags.length > 0 && <div className="tags" style={{ marginTop: 18 }}>{p.flags.map(([t, x]) => (<Pill key={x} t={t}>{x}</Pill>))}</div>}
          {p.floor && <p className="lede" style={{ fontSize: 15 }}>{p.name} holds {usd(p.tvl)}, below the $10K floor for alerts. dawns still tracks it.</p>}
        </div>
      </section>
      <div className="wrap">
        <div className="grid g5 lift"><Kpis p={p} /></div>
        <SubNav tabs={tabs.map((t) => t[0])} />
        {tabs.map(([title, node], i) => (
          <section className="ps" id={`s-${i}`} key={title}>
            <h2>{title}</h2>
            {node}
          </section>
        ))}
      </div>
    </>
  );
}
