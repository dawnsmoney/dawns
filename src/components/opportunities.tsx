"use client";
import { track } from "@/lib/track";

import Link from "next/link";
import { Fragment, useState } from "react";
import { AssetCoin, Pill } from "./bits";
import { usd, pct } from "@/lib/format";
import type { FarmView, Opportunity } from "@/lib/types";

type Filter = "All" | "Lending" | "Liquidity" | "Farms";
const inFilter = (o: Opportunity, f: Filter) => f === "All" || (f === "Lending" ? o.kind === "supply" : f === "Farms" ? !!o.farm : o.kind === "lp" && !o.farm);

const hrs = (h: number) => (h >= 48 ? `${Math.round(h / 24)}\u00a0days` : `${Math.max(1, Math.round(h))}\u00a0h`);

const pathOf = (id: string) => `/assets/${id.split(":").map(encodeURIComponent).join("/")}`;

function Pair({ o, known }: { o: Opportunity; known: Set<string> }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center" }}>
      {o.assets.slice(0, 2).map((a, i) => {
        const id = o.assetIds?.[i];
        const coin = <AssetCoin a={a} size={34} />;
        return (
          <span key={a + i} style={{ marginLeft: i ? -12 : 0, borderRadius: "50%", boxShadow: i ? "0 0 0 3px var(--card, #1C1642)" : undefined, display: "inline-flex" }}>
            {id && known.has(id) ? <Link href={pathOf(id)} aria-label={`${a}: asset profile`} title={`${a}: asset profile`} style={{ display: "inline-flex" }}>{coin}</Link> : coin}
          </span>
        );
      })}
    </span>
  );
}

function Exit({ o }: { o: Opportunity }) {
  if (o.kind === "lp") return <span>Any time<small className="muted" style={{ display: "block" }}>price exposure on exit</small></span>;
  const s = o.exitShare ?? 0;
  const color = s < 0.05 ? "var(--crit)" : s < 0.2 ? "var(--warn, #FFC061)" : "var(--good)";
  return (
    <span style={{ display: "grid", gap: 6, minWidth: 130 }}>
      <span>{usd(o.exitNow ?? 0)} <span className="muted">({pct(s, 0)})</span></span>
      <span className="bar-h" style={{ height: 6 }}><i style={{ width: `${Math.max(2, s * 100)}%`, background: color }} /></span>
    </span>
  );
}

function Risk({ o }: { o: Opportunity }) {
  if (o.kind === "supply")
    return o.apyRange ? <span>{pct(o.apyRange[0], 1)} – {pct(o.apyRange[1], 1)}<small className="muted" style={{ display: "block" }}>rate range, {hrs(o.rangeHours)}</small></span> : <span className="muted">building history</span>;
  if (o.ilAtMove == null) return <span className="muted">building history</span>;
  return <span>{pct(o.priceMove ?? 0, 0)} move<small className="muted" style={{ display: "block" }}>trails holding by {pct(o.ilAtMove, 1)} · {hrs(o.rangeHours)}</small></span>;
}

export function OpportunityTable({ rows, known: knownIds = [] }: { rows: Opportunity[]; known?: string[] }) {
  const known = new Set(knownIds);
  const [f, setF] = useState<Filter>("All");
  const [open, setOpen] = useState<string | null>(null);
  const shown = rows.filter((o) => inFilter(o, f));
  const filters = (["All", "Lending", "Liquidity", "Farms"] as Filter[]).filter((x) => x !== "Farms" || rows.some((o) => o.farm));
  return (
    <>
      <div className="filters" style={{ marginBottom: 20, justifyContent: "flex-end" }}>
        {filters.map((x) => (
          <button key={x} type="button" className={x === f ? "on" : ""} onClick={() => setF(x)}>{x} <span className="muted">{rows.filter((o) => inFilter(o, x)).length}</span></button>
        ))}
      </div>
      <div className="card flush"><div className="tbl-wrap"><table className="opps-tbl">
        <thead><tr><th>Opportunity</th><th>Native yield</th><th>Size</th><th>Exit now</th><th>Stability · 7 days</th><th>State</th></tr></thead>
        <tbody>
          {shown.map((o) => (
            <Fragment key={o.id}>
              <tr onClick={() => { if (open !== o.id) track("opportunity_open", { id: o.id }); setOpen(open === o.id ? null : o.id); }} style={{ cursor: "pointer" }} aria-expanded={open === o.id}>
                <td>
                  <span className="proto"><span onClick={(e) => e.stopPropagation()} style={{ display: "inline-flex" }}><Pair o={o} known={known} /></span><span className="opp-name"><b>{o.name}</b><small><Link href={`/protocols/${o.protocol}`} onClick={(e) => e.stopPropagation()}>{o.pname}</Link> · {o.chain === "igra" ? "Igra" : "Kasplex"}</small></span></span>
                </td>
                <td>
                  <b style={{ font: "600 18px var(--display)" }}>{o.apy != null ? pct(o.apy, o.apy < 0.1 ? 2 : 1) : "—"}</b>
                  <small className="muted" style={{ display: "block", whiteSpace: "nowrap" }} title={o.apyBasis}>{o.apyShort}</small>
                  {o.farm && <small style={{ display: "block", whiteSpace: "nowrap", color: o.farm.on ? "var(--ink-2)" : "var(--warn)" }} title="Paid in the protocol's token: shown, never added to native yield">{o.farm.on ? `+ ${o.farm.apr != null ? pct(o.farm.apr, 1) : "?"} ${o.farm.reward}, not added` : `${o.farm.reward} rewards off`}</small>}
                </td>
                <td>{usd(o.size)}{o.vol24 != null && <small className="muted" style={{ display: "block" }}>{usd(o.vol24)} traded 24h</small>}</td>
                <td><Exit o={o} /></td>
                <td className="soft"><Risk o={o} /></td>
                <td><Pill t={o.status}>{o.statusText}</Pill><small className="muted" style={{ display: "block", marginTop: 6 }}>{open === o.id ? "Less ▴" : `${o.notes.length} notes ▾`}</small></td>
              </tr>
              {open === o.id && (
                <tr>
                  <td colSpan={6} className="wrap" style={{ background: "rgba(255,255,255,.03)" }}>
                    <ul style={{ margin: "4px 0", paddingLeft: 18, display: "grid", gap: 6, color: "var(--ink-2)", fontSize: 14.5 }}>
                      {o.notes.map((n) => <li key={n}>{n}</li>)}
                      {o.assetIds?.some((id) => known.has(id)) && (
                        <li>Assets: {o.assets.map((a, i) => { const id = o.assetIds[i]; return <Fragment key={a + i}>{i ? " · " : ""}{id && known.has(id) ? <Link href={pathOf(id)}>{a} profile</Link> : a}</Fragment>; })}</li>
                      )}
                    </ul>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table></div></div>
    </>
  );
}

/**
 * The best native yields, ranked, each next to how much of it you could take out today.
 * One bar to compare yields, one word and one number for the exit. No axes to decode.
 */
export function YieldLadder({ rows, limit = 8 }: { rows: Opportunity[]; limit?: number }) {
  const top = rows.filter((o) => o.apy != null && o.apy >= 0.005).sort((a, b) => b.apy! - a.apy!).slice(0, limit);
  const max = Math.max(...top.map((o) => o.apy!), 0.01);
  const exit = (o: Opportunity): { t: "good" | "warn" | "crit"; word: string; amount: string } => {
    if (o.status === "crit") return { t: "crit", word: "Blocked", amount: `${usd(o.exitNow ?? 0)} withdrawable` };
    const room = o.exitNow ?? 0;
    if (o.kind === "lp") return { t: room >= 50_000 ? "good" : room >= 10_000 ? "warn" : "crit", word: room >= 50_000 ? "Room" : room >= 10_000 ? "Shallow" : "Thin", amount: `${usd(room)} pool, at its price` };
    return { t: room >= 50_000 && (o.exitShare ?? 0) >= 0.2 ? "good" : room >= 5_000 ? "warn" : "crit", word: room >= 50_000 && (o.exitShare ?? 0) >= 0.2 ? "Room" : room >= 5_000 ? "Tight" : "Thin", amount: `${usd(room)} withdrawable` };
  };
  return (
    <div className="ladder">
      {top.map((o, i) => {
        const e = exit(o);
        return (
          <div key={o.id} className="ladder-row">
            <span className="ladder-n">{i + 1}</span>
            <span className="ladder-name"><b>{o.name.replace(/ liquidity$/, "")}</b><small>{o.pname} · {o.kind === "supply" ? "lending" : "liquidity"}</small></span>
            <span className="ladder-bar"><i style={{ width: `${Math.max(2, (o.apy! / max) * 100)}%`, background: o.kind === "supply" ? "#3987e5" : "#d95926" }} /></span>
            <b className="ladder-y">{pct(o.apy!, o.apy! < 0.1 ? 1 : 0)}</b>
            <span className={`ladder-exit x-${e.t}`}><em>{e.word}</em><small>{e.amount}</small></span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * A farm at a glance: its reward rate over time, what each farmed pool pays in fees next to
 * what it pays in the protocol's token (never summed), and what leaving costs.
 */
export function FarmPanel({ p, f, opps, now }: { p: { id: string; name: string }; f: FarmView; opps: Opportunity[]; now: number }) {
  const [hi, setHi] = useState<number | null>(null);
  const on = f.perDay > 0;
  const hist = (f.history ?? []).map((h) => ({ t: h.t, perDay: h.perBlock * (86_400 / f.blockSec) }));
  const pts = hist.length ? [...hist, { t: now, perDay: f.perDay }] : [{ t: now - 30 * 86_400_000, perDay: f.perDay }, { t: now, perDay: f.perDay }];
  const t0 = pts[0].t, t1 = now, maxY = Math.max(1, ...pts.map((x) => x.perDay)) * 1.15;
  const W = 520, H = 180, L = 52, R = 10, T = 10, B = 24;
  const x = (t: number) => L + ((t - t0) / Math.max(1, t1 - t0)) * (W - L - R), y = (v: number) => T + (1 - v / maxY) * (H - T - B);
  let d = `M${x(pts[0].t)},${y(pts[0].perDay)}`;
  for (let i = 1; i < pts.length; i++) d += `H${x(pts[i].t)}V${y(pts[i].perDay)}`;
  const day = (t: number) => new Date(t).toISOString().slice(0, 10);
  const rows = f.pools.map((q) => ({ q, o: opps.find((o) => o.id.endsWith(`:farm:${q.pair}`)) ?? null }));
  const maxA = Math.max(0.01, ...rows.map((r) => Math.max(r.o?.apy ?? 0, r.q.apr ?? 0)));
  return (
    <div className="card">
      <div className="c-head"><h3>{p.name} farm</h3><Pill t={on ? "good" : "warn"}>{on ? "Rewards on" : "Rewards off"}</Pill></div>
      <div className="farm-figs">
        <span><small>{f.reward.sym} a day now</small><b>{Math.round(f.perDay).toLocaleString("en-US")}</b></span>
        <span><small>Held by the farm</small><b>{Math.round(f.budget / 1e6 * 10) / 10}M {f.reward.sym}</b></span>
        <span><small>Lasts at this rate</small><b>{f.budgetDays != null ? `${Math.round(f.budgetDays).toLocaleString("en-US")} days` : "—"}</b></span>
        <span><small>Emergency exit</small><b>{pct(f.emergencyFeeBps / 10_000, 0)} fee</b></span>
      </div>
      <div className="grid g2" style={{ gap: 24, marginTop: 18 }}>
        <div>
          <b style={{ fontSize: 14 }}>{f.reward.sym} paid a day, every rate the owner set</b>
          <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`Farm reward rate: ${hist.map((h) => `${day(h.t)} ${Math.round(h.perDay)} a day`).join(", ") || "no changes read"}; now ${Math.round(f.perDay)} a day`} style={{ marginTop: 8 }}>
            {[0].map((v) => <g key={v}><line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="rgba(255,255,255,.08)" /><text x={L - 6} y={y(v)} textAnchor="end" dominantBaseline="central" fill="var(--ink-3)" fontSize="11">0</text></g>)}
            <path d={d} fill="none" stroke="#c98500" strokeWidth={2} />
            {hist.map((h, i) => (
              <g key={h.t} onMouseEnter={() => setHi(i)} onMouseLeave={() => setHi(null)}>
                <circle cx={x(h.t)} cy={y(h.perDay)} r={12} fill="transparent" />
                <circle cx={x(h.t)} cy={y(h.perDay)} r={hi === i ? 6 : 4} fill="#c98500" stroke="var(--card)" strokeWidth={2} />
                <text x={x(h.t) + 8} y={y(h.perDay) - 8} fill="var(--ink-2)" fontSize="11.5">{h.perDay ? `${Math.round(h.perDay).toLocaleString("en-US")} a day · ${day(h.t)}` : `0 · ${day(h.t)}`}</text>
              </g>
            ))}
            <text x={L} y={H - 6} fill="var(--ink-3)" fontSize="11">{day(t0)}</text>
            <text x={W - R} y={H - 6} textAnchor="end" fill="var(--ink-3)" fontSize="11">today</text>
          </svg>
          <div className="split-tip">{hi != null ? <span><b>{day(hist[hi].t)}</b> · owner set {Math.round(hist[hi].perDay).toLocaleString("en-US")} {f.reward.sym} a day</span> : <span className="muted">{hist.length ? `${hist.length} rate changes read from the explorer. Hover a change.` : "Rate history not read this run."}</span>}</div>
        </div>
        <div>
          <b style={{ fontSize: 14 }}>Per farmed pool: trading fees vs {f.reward.sym} rewards (never summed)</b>
          <div className="farm-rows">
            {rows.map(({ q, o }) => (
              <div key={q.pair} className="farm-row">
                <span className="farm-n"><b>{q.symbols.join(" / ")}</b><small>{pct(q.stakedShare, 0)} of its LP staked · {pct(q.allocShare, 0)} of rewards</small></span>
                <span className="farm-bars">
                  <span title={`Trading fees ${o?.apy != null ? pct(o.apy, 1) : "measuring"}`}><i style={{ width: `${((o?.apy ?? 0) / maxA) * 100}%`, background: "#d95926" }} /><em>{o?.apy != null ? pct(o.apy, 1) : "—"}</em></span>
                  <span title={`${f.reward.sym} rewards ${q.apr != null ? pct(q.apr, 1) : "unpriced"}`}><i className="hatch" style={{ width: `${((q.apr ?? 0) / maxA) * 100}%` }} /><em>{on ? (q.apr != null ? pct(q.apr, 1) : "unpriced") : "0%"}</em></span>
                </span>
              </div>
            ))}
          </div>
          <div className="split-legend"><span><i style={{ background: "#d95926" }} />Trading fees (native)</span><span><i className="hatch" />{f.reward.sym} rewards (incentive)</span></div>
        </div>
      </div>
      <p className="muted" style={{ fontSize: 13, margin: "16px 0 0" }}>{on ? `The owner can change the rate or the pools at any time; rewards are worth what ${f.reward.sym} can be sold for.` : `Rewards are off: a staked LP earns the same trading fees as an unstaked one, with one more contract in between and a ${pct(f.emergencyFeeBps / 10_000, 0)} fee on emergency exits.`} Contract <a href={`https://explorer.igralabs.com/address/${f.address}`} target="_blank" rel="noopener noreferrer">{f.address.slice(0, 8)}…{f.address.slice(-4)}</a>, not verified on the explorer; see <Link href={`/protocols/${p.id}`}>{p.name}</Link>.</p>
    </div>
  );
}
