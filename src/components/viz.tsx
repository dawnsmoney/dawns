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

/** An identifier with a copy button. */
export function CopyId({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="copyid" onClick={() => { navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1400); }).catch(() => {}); }} title="Copy">
      <span className="mono">{text}</span><em>{done ? "Copied" : "Copy"}</em>
    </button>
  );
}

export interface Span { key: string; label: string; sub?: string; start: number; end: number; done: number; claimed?: number; display: string; color: string }
/**
 * Schedules on one time axis (vesting pools): each row spans start → end; the solid part is
 * what has unlocked by today, the hatched part is still locked. A line marks today.
 */
export function Timeline({ rows, now, label }: { rows: Span[]; now: number; label: string }) {
  const [hover, setHover] = useState<string | null>(null);
  const t0 = Math.min(...rows.map((r) => r.start)), t1 = Math.max(...rows.map((r) => r.end), now);
  const pos = (t: number) => ((t - t0) / Math.max(1, t1 - t0)) * 100;
  const years: number[] = [];
  for (let y = new Date(t0).getUTCFullYear() + 1; Date.UTC(y, 0, 1) <= t1; y++) if (Math.abs(((Date.UTC(y, 0, 1) - now) / Math.max(1, t1 - t0)) * 100) > 7) years.push(y);
  const on = rows.find((r) => r.key === hover) ?? null;
  return (
    <div className="tl" role="img" aria-label={`${label}: ${rows.map((r) => `${r.label} ${r.display}, ${Math.round(r.done * 100)}% unlocked`).join("; ")}`}>
      <div className="tl-row tl-axis" aria-hidden>
        <span />
        <div className="tl-t">
          {years.map((y) => <span key={y} style={{ left: `${pos(Date.UTC(y, 0, 1))}%` }}>{y}</span>)}
          <em style={{ left: `${pos(now)}%` }}>Today</em>
        </div>
        <span />
      </div>
      {rows.map((r) => (
        <div key={r.key} className="tl-row" tabIndex={0} onMouseEnter={() => setHover(r.key)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(r.key)} onBlur={() => setHover(null)}>
          <div className="tl-l"><span>{r.label}</span>{r.sub && <small>{r.sub}</small>}</div>
          <div className="tl-t">
            <span className="tl-bar" style={{ left: `${pos(r.start)}%`, width: `${Math.max(0.8, pos(r.end) - pos(r.start))}%`, ["--c" as string]: r.color, opacity: hover && hover !== r.key ? 0.45 : 1 }}>
              <i style={{ width: `${r.done * 100}%` }} />
            </span>
            <i className="tl-now" style={{ left: `${pos(now)}%` }} />
          </div>
          <b>{r.display}</b>
        </div>
      ))}
      <div className="split-tip" aria-live="polite">{on ? <><i style={{ background: on.color }} /><b>{on.label}</b> {Math.round(on.done * 100)}% unlocked{on.claimed != null ? ` · ${Math.round(on.claimed * 100)}% claimed` : ""} · {new Date(on.start).toISOString().slice(0, 10)} → {new Date(on.end).toISOString().slice(0, 10)}</> : <span className="muted">Solid: unlocked by today · hatched: still locked</span>}</div>
    </div>
  );
}

/** 100% stacked columns over time: how one whole splits, period by period (holder flow). */
export function StackedCols({ cols, keys, label }: { cols: { key: string; label: string; parts: Record<string, number> }[]; keys: { key: string; label: string; color: string }[]; label: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const on = hover == null ? null : cols[hover];
  return (
    <div className="scols">
      <div className="scols-plot" role="img" aria-label={label}>
        {cols.map((c, i) => {
          const tot = keys.reduce((s, k) => s + (c.parts[k.key] ?? 0), 0) || 1;
          return (
            <div key={c.key} className="scol" tabIndex={0} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} style={{ opacity: hover != null && hover !== i ? 0.5 : 1 }}>
              <span className="scol-t">{[...keys].reverse().map((k) => { const v = (c.parts[k.key] ?? 0) / tot; return v > 0 ? <i key={k.key} style={{ height: `${v * 100}%`, background: k.color }} /> : null; })}</span>
              <small>{c.label}</small>
            </div>
          );
        })}
      </div>
      <div className="split-tip" aria-live="polite">{on ? <><b>{on.label}</b>{keys.filter((k) => (on.parts[k.key] ?? 0) > 0.0005).map((k) => <span key={k.key} style={{ marginLeft: 10 }}><i style={{ background: k.color }} />{k.label} {pctS(on.parts[k.key], 1)}</span>)}</> : <span className="muted">Hover a column</span>}</div>
      <div className="split-legend">{keys.map((k) => <span key={k.key}><i style={{ background: k.color }} />{k.label}</span>)}</div>
    </div>
  );
}

export interface CapRow { key: string; label: string; sub?: string; share: number; cap: number; display: string; color: string }
/** Share used against a hard cap: the bar is what is used, the tick is the cap (a vault's destinations). */
export function CapBars({ rows }: { rows: CapRow[] }) {
  return (
    <div className="hbars">
      {rows.map((r) => (
        <div key={r.key} className="hbar" title={`${r.label}: ${pctS(r.share, 1)} of a ${pctS(r.cap)} cap`}>
          <div className="hbar-l"><span>{r.label}</span>{r.sub && <small>{r.sub}</small>}</div>
          <div className="hbar-t capbar">
            <i style={{ width: `${Math.min(100, r.share * 100)}%`, background: r.color }} />
            <em style={{ left: `${Math.min(100, r.cap * 100)}%` }} aria-hidden />
            <span className="capbar-room" style={{ left: `${Math.min(100, r.share * 100)}%`, width: `${Math.max(0, (r.cap - r.share) * 100)}%`, ["--c" as string]: r.color }} aria-hidden />
          </div>
          <b>{r.display}</b>
        </div>
      ))}
    </div>
  );
}
