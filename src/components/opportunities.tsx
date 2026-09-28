"use client";
import { track } from "@/lib/track";

import Link from "next/link";
import { Fragment, useState } from "react";
import { AssetCoin, Pill } from "./bits";
import { usd, pct } from "@/lib/format";
import type { Opportunity } from "@/lib/types";

type Filter = "All" | "Lending" | "Liquidity";

const hrs = (h: number) => (h >= 48 ? `${Math.round(h / 24)} days` : `${Math.max(1, Math.round(h))} h`);

function Pair({ o }: { o: Opportunity }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center" }}>
      {o.assets.slice(0, 2).map((a, i) => (
        <span key={a + i} style={{ marginLeft: i ? -12 : 0, borderRadius: "50%", boxShadow: i ? "0 0 0 3px var(--card, #1C1642)" : undefined, display: "inline-flex" }}>
          <AssetCoin a={a} size={34} />
        </span>
      ))}
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
  return <span>{pct(o.priceMove ?? 0, 0)} move<small className="muted" style={{ display: "block" }}>LP trails holding by {pct(o.ilAtMove, 1)} · {hrs(o.rangeHours)}</small></span>;
}

export function OpportunityTable({ rows }: { rows: Opportunity[] }) {
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
      <div className="card flush"><div className="tbl-wrap"><table>
        <thead><tr><th>Opportunity</th><th>Native yield</th><th>Size</th><th>Exit now</th><th>Stability · 7 days</th><th>State</th><th /></tr></thead>
        <tbody>
          {shown.map((o) => (
            <Fragment key={o.id}>
              <tr onClick={() => { if (open !== o.id) track("opportunity_open", { id: o.id }); setOpen(open === o.id ? null : o.id); }} style={{ cursor: "pointer" }} aria-expanded={open === o.id}>
                <td>
                  <span className="proto"><Pair o={o} /><span><b>{o.name}</b><small><Link href={`/protocols/${o.protocol}`} onClick={(e) => e.stopPropagation()}>{o.pname}</Link> · {o.chain === "igra" ? "Igra" : "Kasplex"}</small></span></span>
                </td>
                <td>
                  <b style={{ font: "600 18px var(--display)" }}>{o.apy != null ? pct(o.apy, o.apy < 0.1 ? 2 : 1) : "—"}</b>
                  <small className="muted" style={{ display: "block", whiteSpace: "nowrap" }} title={o.apyBasis}>{o.apyShort}</small>
                </td>
                <td>{usd(o.size)}{o.vol24 != null && <small className="muted" style={{ display: "block" }}>{usd(o.vol24)} traded 24h</small>}</td>
                <td><Exit o={o} /></td>
                <td><Risk o={o} /></td>
                <td><Pill t={o.status}>{o.statusText}</Pill></td>
                <td className="muted" style={{ fontSize: 13, whiteSpace: "nowrap" }}>{open === o.id ? "Less" : `${o.notes.length} notes`}</td>
              </tr>
              {open === o.id && (
                <tr>
                  <td colSpan={7} className="wrap" style={{ background: "rgba(255,255,255,.03)" }}>
                    <ul style={{ margin: "4px 0", paddingLeft: 18, display: "grid", gap: 6, color: "var(--ink-2)", fontSize: 14.5 }}>
                      {o.notes.map((n) => <li key={n}>{n}</li>)}
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
