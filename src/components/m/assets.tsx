"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AssetCoin, Pill } from "../bits";
import { usd, price } from "@/lib/format";
import type { AssetLite } from "../assets";

type Group = "All" | "Native" | "KRC-20" | "Covenant" | "Igra" | "Kasplex";
type Key = "mcap" | "vol24" | "holders" | "liquidity";
const inGroup = (a: AssetLite, g: Group) =>
  g === "All" || (g === "Native" ? a.standard === "native" : g === "KRC-20" ? a.standard === "krc20" : g === "Covenant" ? a.standard === "kcc20" || a.standard === "kron" : g === "Igra" ? a.chain === "igra" : a.chain === "kasplex");
const count = (v: number | null) => (v == null ? "—" : v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e4 ? `${(v / 1e3).toFixed(1)}K` : Math.round(v).toLocaleString("en-US"));
const SORTS: [Key, string][] = [["mcap", "Value"], ["vol24", "Traded"], ["holders", "Holders"], ["liquidity", "In DeFi"]];

/** The asset index on a phone: search, a group, a sort, and one row per asset. */
export function MAssetList({ rows }: { rows: AssetLite[] }) {
  const [g, setG] = useState<Group>("All");
  const [q, setQ] = useState("");
  const [key, setKey] = useState<Key>("mcap");
  const [n, setN] = useState(30);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows.filter((a) => inGroup(a, g) && (s || a.significant) && (!s || a.symbol.toLowerCase().includes(s) || a.name.toLowerCase().includes(s) || a.id.includes(s)))
      .sort((x, y) => key === "mcap" ? (Number(y.credible) - Number(x.credible)) || (y.mcap ?? -1) - (x.mcap ?? -1) : (y[key] ?? -1) - (x[key] ?? -1));
  }, [rows, g, q, key]);
  const figure = (a: AssetLite) => key === "vol24" ? (a.vol24 != null ? usd(a.vol24) : "—") : key === "holders" ? count(a.holders) : key === "liquidity" ? (a.liquidity ? usd(a.liquidity) : "—") : a.mcap != null ? usd(a.mcap) : "—";
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <input className="m-search" type="search" placeholder="Search ticker, name or address" value={q} onChange={(e) => { setQ(e.target.value); setN(30); }} aria-label="Search assets" />
      <div className="m-chips">{(["All", "Native", "KRC-20", "Covenant", "Igra", "Kasplex"] as Group[]).map((x) => <button key={x} type="button" className={g === x ? "on" : ""} onClick={() => { setG(x); setN(30); }}>{x}</button>)}</div>
      <div className="m-chips">{SORTS.map(([k, l]) => <button key={k} type="button" className={key === k ? "on" : ""} onClick={() => setKey(k)}>By {l.toLowerCase()}</button>)}</div>
      <div className="m-card flush"><div className="m-list">
        {shown.slice(0, n).map((a) => (
          <Link key={a.id} href={a.path} className="m-row">
            <span className="m-row-i"><AssetCoin a={a.symbol} size={34} /></span>
            <span className="m-row-t"><b>{a.symbol}</b><small>{a.standard === "native" ? a.chainName : `${a.standardName} · ${a.chainName}`} · {price(a.price)}</small>{a.grade !== "good" && <span className="m-row-p"><Pill t={a.grade}>{a.grade === "crit" ? "High" : "Watch"}</Pill></span>}</span>
            <span className="m-row-v"><b style={{ color: key === "mcap" && !a.credible ? "var(--ink-3)" : undefined }}>{figure(a)}</b><small>{SORTS.find((s) => s[0] === key)![1].toLowerCase()}{key === "mcap" && !a.credible ? ", not realizable" : ""}</small></span>
            <i className="m-chev" aria-hidden>›</i>
          </Link>
        ))}
        {!shown.length && <div className="m-row"><span className="m-row-t"><small>No assets match.</small></span></div>}
        {shown.length > n && <button type="button" className="m-more" onClick={() => setN((x) => x + 50)}>Show {Math.min(50, shown.length - n)} more of {shown.length}</button>}
      </div></div>
    </div>
  );
}
