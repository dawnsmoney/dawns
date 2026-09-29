"use client";

import { useEffect, useRef, useState } from "react";

export type SharePoint = { t: number; price: number; kind: "open" | "flow" | "loan" | "mark" | "now"; title: string; amt?: string };

/** Event kinds on the line; colours validated for the dark surface (dataviz check: all pass). */
const KINDS: Record<Exclude<SharePoint["kind"], "open" | "now">, { label: string; color: string }> = {
  flow: { label: "Deposit or withdrawal", color: "#9085e9" },
  loan: { label: "Capital out or back", color: "#199e70" },
  mark: { label: "Marked or written down", color: "#d95926" },
};

const fmtT = (t: number, span: number) => {
  const d = new Date(t * 1000);
  const hm = d.toISOString().slice(11, 16);
  if (span < 2 * 86_400) return hm;
  const day = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  return span < 20 * 86_400 ? `${day} ${hm}` : day;
};

/**
 * Share price since inception, a step line: the price moves only when the
 * vault moves (a deposit at NAV leaves it where it is; a repayment with interest,
 * a markdown or an exit fee moves it). Every move is a dot; hover reads it.
 */
export function SharePriceChart({ points, launch, label }: { points: SharePoint[]; launch: number; label: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(720);
  const [hi, setHi] = useState<number | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver((e) => setW(Math.max(280, Math.round(e[0].contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const H = 220, L = 58, R = 14, T = 14, B = 26;
  const t0 = points[0]?.t ?? 0, t1 = points[points.length - 1]?.t ?? 1;
  const span = Math.max(1, t1 - t0);
  const ps = points.map((p) => p.price);
  let lo = Math.min(launch, ...ps), hi_ = Math.max(launch, ...ps);
  const pad = (hi_ - lo) * 0.12 || launch * 0.05;
  lo = Math.max(0, lo - pad); hi_ = hi_ + pad;
  const x = (t: number) => L + ((t - t0) / span) * (w - L - R);
  const y = (v: number) => T + (1 - (v - lo) / (hi_ - lo)) * (H - T - B);
  // step-after path
  let d = "";
  points.forEach((p, i) => { d += i === 0 ? `M${x(p.t)},${y(p.price)}` : `H${x(p.t)}V${y(p.price)}`; });
  const ticksY = Array.from({ length: 4 }, (_, i) => lo + ((hi_ - lo) * i) / 3);
  const nx = w < 480 ? 3 : 5;
  const ticksX = Array.from({ length: nx }, (_, i) => t0 + (span * i) / (nx - 1));
  const last = points[points.length - 1];
  const change = last ? last.price / launch - 1 : 0;
  const cur = hi != null ? points[hi] : null;

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const r = (e.currentTarget as SVGRectElement).getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * (w - L - R) + L;
    let best = 0, bd = Infinity;
    points.forEach((p, i) => { const dd = Math.abs(x(p.t) - px); if (dd < bd) { bd = dd; best = i; } });
    setHi(best);
  };
  const used = [...new Set(points.map((p) => p.kind))].filter((k): k is keyof typeof KINDS => k in KINDS);

  return (
    <div className="spc" ref={box}>
      <div className="spc-head">
        <div><b>{last ? last.price.toFixed(6) : "—"}</b><small>KAS per share now</small></div>
        <div><b className={change > 0 ? "up" : change < 0 ? "down" : undefined}>{change >= 0 ? "+" : "−"}{(Math.abs(change) * 100).toFixed(2)}%</b><small>since launch at {launch.toFixed(2)}</small></div>
      </div>
      <div className="spc-plot">
      <svg viewBox={`0 0 ${w} ${H}`} style={{ display: "block", width: "100%", height: "auto" }} role="img" aria-label={`${label}: from ${launch.toFixed(4)} KAS at launch to ${last?.price.toFixed(4)} KAS now, ${points.length - 2} moves`}>
        {ticksY.map((v) => (
          <g key={v}>
            <line x1={L} x2={w - R} y1={y(v)} y2={y(v)} className="spc-grid" />
            <text x={L - 8} y={y(v) + 4} textAnchor="end" className="spc-ax">{v.toFixed(v < 0.1 ? 4 : 3)}</text>
          </g>
        ))}
        {ticksX.map((t, i) => <text key={t} x={x(t)} y={H - 6} textAnchor={i === 0 ? "start" : i === nx - 1 ? "end" : "middle"} className="spc-ax">{fmtT(t, span)}</text>)}
        <line x1={L} x2={w - R} y1={y(launch)} y2={y(launch)} className="spc-launch" />
        <text x={w - R} y={y(launch) - 5} textAnchor="end" className="spc-ax">launch {launch.toFixed(2)}</text>
        <path d={d} className="spc-line" />
        {points.map((p, i) => p.kind in KINDS && (
          <circle key={i} cx={x(p.t)} cy={y(p.price)} r={hi === i ? 6 : 4.5} fill={KINDS[p.kind as keyof typeof KINDS].color} className="spc-dot" />
        ))}
        {last && <circle cx={x(last.t)} cy={y(last.price)} r={4} className="spc-now" />}
        {cur && <line x1={x(cur.t)} x2={x(cur.t)} y1={T} y2={H - B} className="spc-cross" />}
        <rect x={L} y={T} width={Math.max(0, w - L - R)} height={H - T - B} fill="transparent" onPointerMove={onMove} onPointerLeave={() => setHi(null)} />
      </svg>
      {cur && (
        <div className="spc-tip" style={{ left: Math.min(Math.max(x(cur.t), 110), w - 110), top: Math.max(0, y(cur.price) - 12) }}>
          <b>{cur.title}</b>
          <span>{new Date(cur.t * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC{cur.amt ? ` · ${cur.amt}` : ""}</span>
          <span>{cur.price.toFixed(6)} KAS a share · {cur.price >= launch ? "+" : "−"}{(Math.abs(cur.price / launch - 1) * 100).toFixed(2)}%</span>
        </div>
      )}
      </div>
      {used.length > 0 && (
        <div className="spc-leg">{used.map((k) => <span key={k}><i style={{ background: KINDS[k].color }} />{KINDS[k].label}</span>)}</div>
      )}
    </div>
  );
}
