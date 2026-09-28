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

export interface Pt2 { key: string; label: string; sub?: string; x: number; y: number; size: number; color: string; alert?: boolean; href?: string }
/**
 * A scatter: x on a log scale (money), y linear (a rate). Dot area ∝ size. Hover or focus a dot
 * for its card; the few largest dots carry direct labels. A shaded corner marks where
 * both axes are good.
 */
export function Scatter({ points, xLabel, yLabel, xFmt, good }: {
  points: Pt2[]; xLabel: string; yLabel: string; xFmt: "usd" | "pct"; good?: { x: number; y: number; label: string };
}) {
  const [on, setOn] = useState<string | null>(null);
  const W = 760, H = 380, L = 58, R = 18, T = 16, B = 44;
  const xs = points.map((p) => Math.max(1, p.x)), ys = points.map((p) => p.y);
  // a blocked exit ($0) sits on the left edge rather than stretching the axis to $1
  const x0 = 1e3, x1 = Math.pow(10, Math.ceil(Math.log10(Math.max(...xs, 1e5))));
  const y1 = Math.max(0.1, Math.ceil(Math.max(...ys, 0.05) * 10) / 10);
  const sx = (v: number) => L + ((Math.log10(Math.max(x0, v)) - Math.log10(x0)) / (Math.log10(x1) - Math.log10(x0))) * (W - L - R);
  const sy = (v: number) => T + (1 - Math.max(0, v) / y1) * (H - T - B);
  const maxSize = Math.max(...points.map((p) => p.size), 1);
  const rad = (s: number) => 5 + Math.sqrt(s / maxSize) * 16;
  const fx = (v: number) => (xFmt === "usd" ? (v >= 1e6 ? `$${+(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `$${+(v / 1e3).toFixed(1)}K` : `$${Math.round(v)}`) : pctS(v));
  const xt: number[] = []; for (let v = x0; v <= x1; v *= 10) xt.push(v);
  const yt = Array.from({ length: 5 }, (_, i) => (y1 * i) / 4);
  const hot = points.find((p) => p.key === on) ?? null;
  // direct labels for the largest dots, skipping any that would collide with one already placed
  const placed: { x: number; y: number }[] = [];
  const labeled = new Set<string>();
  for (const p of [...points].sort((a, b) => b.size - a.size)) {
    if (labeled.size >= 6) break;
    const x = sx(p.x), y = sy(p.y) - rad(p.size) - 6;
    if (placed.some((q) => Math.abs(q.x - x) < 90 && Math.abs(q.y - y) < 18) || y < T + 10) continue;
    placed.push({ x, y }); labeled.add(p.key);
  }
  return (
    <div className="scatter">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${yLabel} against ${xLabel}, ${points.length} opportunities`}>
        {good && <rect x={sx(good.x)} y={T} width={W - R - sx(good.x)} height={sy(good.y) - T} fill="rgba(74,222,155,.07)" rx="6" />}
        {good && <text x={W - R - 8} y={T + 16} textAnchor="end" fill="#4ADE9B" style={{ font: "500 12px var(--body)" }}>{good.label}</text>}
        {yt.map((v) => <g key={v}><line x1={L} x2={W - R} y1={sy(v)} y2={sy(v)} stroke="rgba(255,255,255,.07)" /><text x={L - 8} y={sy(v) + 4} textAnchor="end" fill="var(--ink-3)" style={{ font: "12px var(--body)" }}>{pctS(v)}</text></g>)}
        {xt.map((v, i) => <text key={v} x={sx(v)} y={H - B + 18} textAnchor={i ? "middle" : "start"} fill="var(--ink-3)" style={{ font: "12px var(--body)" }}>{i ? fx(v) : `≤ ${fx(v)}`}</text>)}
        <text x={(L + W - R) / 2} y={H - 6} textAnchor="middle" fill="var(--ink-2)" style={{ font: "12.5px var(--body)" }}>{xLabel} →</text>
        <text x={14} y={(T + H - B) / 2} textAnchor="middle" fill="var(--ink-2)" transform={`rotate(-90 14 ${(T + H - B) / 2})`} style={{ font: "12.5px var(--body)" }}>{yLabel} →</text>
        {[...points].sort((a, b) => b.size - a.size).map((p) => (
          <g key={p.key} tabIndex={0} onMouseEnter={() => setOn(p.key)} onMouseLeave={() => setOn(null)} onFocus={() => setOn(p.key)} onBlur={() => setOn(null)} style={{ outline: "none", cursor: "default" }}>
            <circle cx={sx(p.x)} cy={sy(p.y)} r={rad(p.size) + 6} fill="transparent" />
            <circle cx={sx(p.x)} cy={sy(p.y)} r={rad(p.size)} fill={p.color} fillOpacity={on && on !== p.key ? 0.3 : 0.85} stroke={p.alert ? "#FF6B7A" : "#1C1642"} strokeWidth={p.alert ? 3 : 2} />
          </g>
        ))}
        {points.filter((p) => labeled.has(p.key)).map((p) => (
          <text key={`l-${p.key}`} x={sx(p.x)} y={sy(p.y) - rad(p.size) - 6} textAnchor="middle" fill="var(--ink)" stroke="#1C1642" strokeWidth={3} paintOrder="stroke" style={{ font: "500 12px var(--body)", pointerEvents: "none" }}>{p.label}</text>
        ))}
      </svg>
      <div className="scatter-tip" aria-live="polite">
        {hot ? <><i style={{ background: hot.color }} /><b>{hot.label}</b><span>{pctS(hot.y, 1)} · {fx(hot.x)} {xLabel.toLowerCase()}</span>{hot.sub && <span className="muted">{hot.sub}</span>}{hot.href && <Link href={hot.href}>open</Link>}</> : <span className="muted">Hover a dot. Size is the size of the pool or market; a red ring means the exit is blocked.</span>}
      </div>
    </div>
  );
}

/** Columns for a distribution: e.g. how long bridge payouts took. */
export function Columns({ cols, label }: { cols: { key: string; label: string; value: number; color: string; display?: string }[]; label: string }) {
  const m = Math.max(...cols.map((c) => c.value), 1);
  return (
    <div className="cols" role="img" aria-label={`${label}: ${cols.map((c) => `${c.label} ${c.value}`).join(", ")}`}>
      {cols.map((c) => (
        <div key={c.key} className="col" title={`${c.label}: ${c.display ?? c.value}`}>
          <b>{c.display ?? c.value}</b>
          <span className="col-t"><i style={{ height: `${Math.max(2, (c.value / m) * 100)}%`, background: c.color }} /></span>
          <small>{c.label}</small>
        </div>
      ))}
    </div>
  );
}
