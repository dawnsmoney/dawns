"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AssetCoin, Pill } from "./bits";
import { MiniSplit } from "./viz";
import { usd, pct, price } from "@/lib/format";
import type { Status } from "@/lib/types";

export interface AssetLite {
  id: string; path: string; symbol: string; name: string; chain: string; chainName: string; standard: string; standardName: string;
  price: number | null; mcap: number | null; credible: boolean; vol24: number | null; holders: number | null; liquidity: number | null;
  top10: number | null; split: { key: string; label: string; color: string; share: number }[]; venues: number; grade: Status; gradeLabel: string; significant: boolean;
}

const count = (v: number | null) => (v == null ? "—" : v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e4 ? `${(v / 1e3).toFixed(1)}K` : Math.round(v).toLocaleString("en-US"));

type Group = "All" | "Native" | "KRC-20" | "Covenant" | "Igra" | "Kasplex L2";
type Key = "mcap" | "vol24" | "holders" | "liquidity" | "top10";
const inGroup = (a: AssetLite, g: Group) =>
  g === "All" || (g === "Native" ? a.standard === "native" : g === "KRC-20" ? a.standard === "krc20" : g === "Covenant" ? a.standard === "kcc20" || a.standard === "kron" : g === "Igra" ? a.chain === "igra" : a.chain === "kasplex");

export function AssetTable({ rows }: { rows: AssetLite[] }) {
  const [g, setG] = useState<Group>("All");
  const [q, setQ] = useState("");
  const [key, setKey] = useState<Key>("mcap");
  const [all, setAll] = useState(false);
  const [limit, setLimit] = useState(100);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows
      .filter((a) => inGroup(a, g) && (all || s || a.significant) && (!s || a.symbol.toLowerCase().includes(s) || a.name.toLowerCase().includes(s) || a.id.includes(s)))
      // values no market could carry sort below real ones
      .sort((x, y) => key === "mcap" ? (Number(y.credible) - Number(x.credible)) || (y.mcap ?? -1) - (x.mcap ?? -1) || (y.holders ?? 0) - (x.holders ?? 0)
        : (y[key] ?? -1) - (x[key] ?? -1) || (y.holders ?? 0) - (x.holders ?? 0));
  }, [rows, g, q, key, all]);

  const th = (k: Key, label: string) => (
    <th><button type="button" className={`sort ${key === k ? "on" : ""}`} onClick={() => setKey(k)} aria-pressed={key === k}>{label}{key === k ? " ↓" : ""}</button></th>
  );

  return (
    <>
      <div className="filters" style={{ marginBottom: 20, justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <input className="search" type="search" placeholder="Search ticker, name or address" value={q} onChange={(e) => { setQ(e.target.value); setLimit(100); }} aria-label="Search assets" />
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {(["All", "Native", "KRC-20", "Covenant", "Igra", "Kasplex L2"] as Group[]).map((x) => (
            <button key={x} type="button" className={x === g ? "on" : ""} onClick={() => { setG(x); setLimit(100); }}>
              {x} <span className="muted">{rows.filter((a) => inGroup(a, x) && (all || a.significant)).length}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="card flush"><div className="tbl-wrap"><table className="assets-tbl">
        <thead><tr><th>Asset</th><th>Price</th>{th("mcap", "Value")}{th("vol24", "Traded 24h")}{th("holders", "Holders")}{th("top10", "Top 10 hold")}{th("liquidity", "In DeFi")}<th>Reading</th></tr></thead>
        <tbody>
          {shown.slice(0, limit).map((a) => (
            <tr key={a.id}>
              <td>
                <Link href={a.path} className="asset-cell" style={{ display: "inline-flex", alignItems: "center", gap: 12 }}>
                  <AssetCoin a={a.symbol} size={30} />
                  <span><b>{a.symbol}</b><small className="muted" style={{ display: "block", whiteSpace: "nowrap" }}>{a.standard === "native" ? a.chainName : `${a.standardName} · ${a.chainName}`}</small></span>
                </Link>
              </td>
              <td>{price(a.price)}</td>
              <td>{a.mcap == null ? "—" : a.credible ? usd(a.mcap) : <span className="muted" title="Priced by too little trading: no market could realize this value">{usd(a.mcap)}<small style={{ display: "block" }}>not realizable</small></span>}</td>
              <td>{a.vol24 != null ? usd(a.vol24) : "—"}</td>
              <td>{count(a.holders)}</td>
              <td>{a.top10 != null ? <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><MiniSplit parts={a.split} width={48} />{pct(a.top10, 0)}</span> : <span className="muted">—</span>}</td>
              <td>{a.liquidity ? usd(a.liquidity) : a.venues ? `${a.venues} venues` : <span className="muted">—</span>}</td>
              <td title={a.gradeLabel}><Pill t={a.grade}>{a.grade === "crit" ? "High" : a.grade === "warn" ? "Watch" : "OK"}</Pill></td>
            </tr>
          ))}
          {!shown.length && <tr><td colSpan={8} className="muted" style={{ textAlign: "center", padding: 28 }}>No assets match.</td></tr>}
        </tbody>
      </table></div></div>
      <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 16, flexWrap: "wrap" }}>
        {shown.length > limit && <button type="button" className="btn ghost" onClick={() => setLimit((l) => l + 200)}>Show {Math.min(200, shown.length - limit)} more</button>}
        <button type="button" className="btn ghost" onClick={() => setAll((v) => !v)}>{all ? "Hide dormant tokens" : `Include dormant tokens (${rows.filter((a) => !a.significant).length})`}</button>
      </div>
    </>
  );
}
