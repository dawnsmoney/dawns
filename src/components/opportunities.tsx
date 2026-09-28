"use client";
import { track } from "@/lib/track";

import Link from "next/link";
import { Fragment, useState } from "react";
import { AssetCoin, Pill } from "./bits";
import { usd, pct } from "@/lib/format";
import type { Opportunity } from "@/lib/types";

type Filter = "All" | "Lending" | "Liquidity";

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
  const shown = rows.filter((o) => f === "All" || (f === "Lending" ? o.kind === "supply" : o.kind === "lp"));
  return (
    <>
      <div className="filters" style={{ marginBottom: 20, justifyContent: "flex-end" }}>
        {(["All", "Lending", "Liquidity"] as Filter[]).map((x) => (
          <button key={x} type="button" className={x === f ? "on" : ""} onClick={() => setF(x)}>{x} <span className="muted">{x === "All" ? rows.length : rows.filter((o) => (x === "Lending" ? o.kind === "supply" : o.kind === "lp")).length}</span></button>
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
