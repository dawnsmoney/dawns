"use client";

import Link from "next/link";
import { useState } from "react";
import type { Status } from "@/lib/types";

/* Small, readable charts. Text stays in ink colours; colour carries identity or status only.
   Every mark has a hover/focus tooltip and every colour a label (legend or direct label). */

const pctS = (x: number, d = 0) => `${(x * 100).toFixed(x > 0 && x < 0.01 && d === 0 ? 1 : d)}%`;

export interface Part { key: string; label: string; color: string; share: number; note?: string }

/** A 100% stacked bar with a legend: how one whole splits. Fixed order, 2px gaps, rounded ends. */
export function SplitBar({ parts, height = 34, label, legend = true }: { parts: Part[]; height?: number; label: string; legend?: boolean }) {
  const [hover, setHover] = useState<string | null>(null);
  const total = parts.reduce((s, p) => s + p.share, 0) || 1;
  const on = parts.find((p) => p.key === hover) ?? null;
  return (
    <div className="split">
      <div className="split-bar" role="img" aria-label={`${label}: ${parts.map((p) => `${p.label} ${pctS(p.share / total)}`).join(", ")}`} style={{ height }}>
        {parts.map((p) => (
          <span key={p.key} tabIndex={0} onMouseEnter={() => setHover(p.key)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(p.key)} onBlur={() => setHover(null)}
            style={{ flexGrow: p.share / total, background: p.color, opacity: hover && hover !== p.key ? 0.45 : 1 }} aria-label={`${p.label} ${pctS(p.share / total, 1)}`} />
        ))}
      </div>
      <div className="split-tip" aria-live="polite">{on ? <><i style={{ background: on.color }} /><b>{on.label}</b> {pctS(on.share / total, 1)}{on.note ? <span className="muted"> · {on.note}</span> : null}</> : <span className="muted">Hover a segment</span>}</div>
      {legend && (
        <div className="split-legend">
          {parts.map((p) => (
            <span key={p.key} onMouseEnter={() => setHover(p.key)} onMouseLeave={() => setHover(null)}><i style={{ background: p.color }} />{p.label}<b>{pctS(p.share / total, p.share / total < 0.1 ? 1 : 0)}</b></span>
          ))}
        </div>
      )}
    </div>
  );
}

/** A ring for one share of a whole: merged-mining share, minted share, reserve. */
export function Ring({ value, label, sub, color = "#9085e9", size = 132, display }: { value: number; label: string; sub?: string; color?: string; size?: number; display?: string }) {
  const v = Math.max(0, Math.min(1, value));
  const r = size / 2 - 9, c = 2 * Math.PI * r;
  return (
    <div className="gauge">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${label}: ${pctS(v, 1)}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,.1)" strokeWidth={12} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={12} strokeLinecap="round"
          strokeDasharray={`${Math.max(0.001, v * c - (v > 0 && v < 1 ? 4 : 0))} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
        <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central" fill="#fff" style={{ font: `600 ${size / (display && display.length > 4 ? 6.2 : 5.2)}px var(--display)` }}>{display ?? pctS(v, v < 0.1 ? 1 : 0)}</text>
      </svg>
      <b>{label}</b>
      {sub && <small className="muted">{sub}</small>}
    </div>
  );
}

export interface Tile { key: string; title: string; t: Status; big: string; small: string }
/** A scorecard: one tile per dimension, status by colour AND by word. */
export function Tiles({ tiles }: { tiles: Tile[] }) {
  const word: Record<Status, string> = { good: "OK", warn: "Watch", crit: "High", info: "Note" };
  return (
    <div className="tiles">
      {tiles.map((x) => (
        <div key={x.key} className={`tile t-${x.t}`}>
          <span className="tile-h"><span>{x.title}</span><em>{word[x.t]}</em></span>
          <b>{x.big}</b>
          <small>{x.small}</small>
        </div>
      ))}
    </div>
  );
}

export interface BarRow { key: string; label: string; sub?: string; value: number; display: string; color?: string; href?: string }
/** Horizontal bars, largest first, label on the left and value on the right. */
export function Bars({ rows, max }: { rows: BarRow[]; max?: number }) {
  const m = max ?? Math.max(...rows.map((r) => r.value), 1e-9);
  return (
    <div className="hbars">
      {rows.map((r) => (
        <div key={r.key} className="hbar" title={`${r.label}: ${r.display}`}>
          <div className="hbar-l">{r.href ? <Link href={r.href}>{r.label}</Link> : <span>{r.label}</span>}{r.sub && <small>{r.sub}</small>}</div>
          <div className="hbar-t"><i style={{ width: `${Math.max(1.5, (r.value / m) * 100)}%`, background: r.color ?? "#3987e5" }} /></div>
          <b>{r.display}</b>
        </div>
      ))}
    </div>
  );
}

/** Two values side by side on one scale: e.g. headline price vs the price in its own pools. */
export function Compare({ a, b }: { a: { label: string; value: number; display: string }; b: { label: string; value: number; display: string } }) {
  const m = Math.max(a.value, b.value) || 1;
  return (
    <div className="hbars">
      {[a, b].map((x, i) => (
        <div key={x.label} className="hbar">
          <div className="hbar-l"><span>{x.label}</span></div>
          <div className="hbar-t"><i style={{ width: `${Math.max(1.5, (x.value / m) * 100)}%`, background: i ? "#199e70" : "#9085e9" }} /></div>
          <b>{x.display}</b>
        </div>
      ))}
    </div>
  );
}

/** A tiny stacked bar for table cells. */
export function MiniSplit({ parts, width = 96 }: { parts: Part[]; width?: number }) {
  const total = parts.reduce((s, p) => s + p.share, 0) || 1;
  return (
    <span className="minisplit" style={{ width }} title={parts.map((p) => `${p.label} ${pctS(p.share / total, 1)}`).join(" · ")}>
      {parts.map((p) => <i key={p.key} style={{ flexGrow: p.share / total, background: p.color }} />)}
    </span>
  );
}
