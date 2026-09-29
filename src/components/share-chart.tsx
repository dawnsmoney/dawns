"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export type SharePoint = { t: number; price: number; kind: "open" | "flow" | "loan" | "mark" | "now"; title: string; amt?: string };
export type LiquidPoint = { t: number; v: number; title: string };

/** Event kinds on the price line; dark-surface steps of the validated categorical palette. */
const KINDS: Record<Exclude<SharePoint["kind"], "open" | "now">, { label: string; color: string }> = {
  flow: { label: "Deposit or withdrawal", color: "#9085e9" },
  loan: { label: "Capital out or back", color: "#199e70" },
  mark: { label: "Marked or written down", color: "#d95926" },
};
const PRICE = "#9085e9";
const LIQ = "#3987e5";
/** Diverging pair for returns: blue gains, red losses, a gray at zero. */
const GAIN = [57, 135, 229], LOSS = [230, 103, 103], MID = [58, 55, 78];

const HOUR = 3600, DAY = 86_400;
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const RANGES: [string, number][] = [["24H", DAY], ["7D", 7 * DAY], ["30D", 30 * DAY], ["90D", 90 * DAY]];

const dateOf = (t: number, span: number) => {
  const d = new Date(t * 1000);
  const hm = d.toISOString().slice(11, 16);
  if (span < 2 * DAY) return hm;
  const day = `${d.getUTCDate()} ${MON[d.getUTCMonth()]}`;
  return span < 10 * DAY ? `${day} ${hm}` : day;
};
const stamp = (t: number) => `${new Date(t * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC`;
const signed = (x: number, d = 2) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x * 100).toFixed(d)}%`;

function useWidth(min = 280) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(720);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((e) => setW(Math.max(min, Math.round(e[0].contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [min]);
  return [ref, w] as const;
}

/** The value of a step series at time t (the last point at or before t). */
function stepAt<T extends { t: number }>(pts: T[], t: number): T {
  let lo = 0, hi = pts.length - 1;
  if (t <= pts[0].t) return pts[0];
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (pts[mid].t <= t) lo = mid; else hi = mid - 1; }
  return pts[lo];
}

/** Range buttons: only ranges shorter than the history, plus All. */
function Ranges({ span, value, set }: { span: number; value: string; set: (r: string) => void }) {
  const opts = RANGES.filter(([, s]) => span > s * 1.3).map(([k]) => k);
  if (!opts.length) return null;
  return (
    <div className="vc-ranges" role="group" aria-label="Time range">
      {[...opts, "All"].map((k) => <button key={k} type="button" className={value === k ? "on" : ""} aria-pressed={value === k} onClick={() => set(k)}>{k}</button>)}
    </div>
  );
}

type Line = { t: number; v: number; dot?: string };

/** Round tick values (1, 2, 2.5, 5 × 10^k) covering [lo, hi]; the domain widens to the outer ticks. */
function niceTicks(lo: number, hi: number, count = 4) {
  const raw = (hi - lo) / count || Math.abs(hi) || 1;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((k) => k >= raw) ?? 10 * mag;
  const a = Math.floor(lo / step) * step, b = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let v = a; v <= b + step / 2; v += step) ticks.push(+v.toPrecision(12));
  return { ticks, lo: a, hi: b, step };
}

/**
 * A step line over a soft wash: the value only changes when something happens.
 * Recessive hairline grid, mono ticks, a crosshair and a tooltip on hover.
 */
function StepArea({ pts, color, id, height = 240, lo: lo0, hi: hi0, fmtY, refLine, tip, label }: {
  pts: Line[]; color: string; id: string; height?: number; lo: number; hi: number; fmtY: (v: number) => string;
  refLine?: { v: number; label: string } | null; tip: (i: number) => React.ReactNode; label: string;
}) {
  const [box, w] = useWidth();
  const [cur, setCur] = useState<number | null>(null);
  const H = height, L = w < 480 ? 52 : 64, R = 12, T = 12, B = 28;
  const nt = niceTicks(lo0, hi0);
  const lo = nt.lo, hi = nt.hi, ticksY = nt.ticks;
  const t0 = pts[0]?.t ?? 0, t1 = pts[pts.length - 1]?.t ?? 1, span = Math.max(1, t1 - t0);
  const x = (t: number) => L + ((t - t0) / span) * (w - L - R);
  const y = (v: number) => T + (1 - (v - lo) / (hi - lo || 1)) * (H - T - B);
  let d = "";
  pts.forEach((p, i) => { d += i === 0 ? `M${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}` : `H${x(p.t).toFixed(1)}V${y(p.v).toFixed(1)}`; });
  const area = pts.length ? `${d}V${H - B}H${x(t0).toFixed(1)}Z` : "";
  const nx = w < 480 ? 3 : 6, ticksX = Array.from({ length: nx }, (_, i) => t0 + (span * i) / (nx - 1));
  const move = (e: React.PointerEvent<SVGRectElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const t = t0 + ((e.clientX - r.left) / r.width) * span;
    let best = 0;
    for (let i = 0; i < pts.length; i++) if (pts[i].t <= t) best = i;
    setCur(best);
  };
  const c = cur != null ? pts[cur] : null;
  const cx = c ? x(Math.max(c.t, t0)) : 0;
  return (
    <div className="vc-plot" ref={box}>
      <svg viewBox={`0 0 ${w} ${H}`} width="100%" height={H} role="img" aria-label={label} style={{ display: "block" }}>
        <defs>
          <linearGradient id={`g-${id}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity=".5" />
            <stop offset=".7" stopColor={color} stopOpacity=".14" />
            <stop offset="1" stopColor={color} stopOpacity=".03" />
          </linearGradient>
        </defs>
        {ticksY.map((v, i) => (
          <g key={i}>
            <line x1={L} x2={w - R} y1={y(v)} y2={y(v)} className="vc-grid" />
            <text x={L - 10} y={y(v) + 3.5} textAnchor="end" className="vc-ax">{fmtY(v)}</text>
          </g>
        ))}
        {ticksX.map((t, i) => <text key={i} x={x(t)} y={H - 8} textAnchor={i === 0 ? "start" : i === nx - 1 ? "end" : "middle"} className="vc-ax">{dateOf(t, span)}</text>)}
        {refLine && refLine.v > lo && refLine.v < hi && (
          <g><line x1={L} x2={w - R} y1={y(refLine.v)} y2={y(refLine.v)} className="vc-ref" /><text x={w - R} y={y(refLine.v) - 6} textAnchor="end" className="vc-ax">{refLine.label}</text></g>
        )}
        <path d={area} fill={`url(#g-${id})`} />
        <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {pts.map((p, i) => p.dot && <circle key={i} cx={x(p.t)} cy={y(p.v)} r={cur === i ? 5.5 : 4} fill={p.dot} className="vc-dot" />)}
        {pts.length > 0 && <circle cx={x(t1)} cy={y(pts[pts.length - 1].v)} r={4} fill={color} className="vc-dot" />}
        {c && <><line x1={cx} x2={cx} y1={T} y2={H - B} className="vc-cross" /><circle cx={cx} cy={y(c.v)} r={5} fill={color} className="vc-dot" /></>}
        <rect x={L} y={T} width={Math.max(0, w - L - R)} height={H - T - B} fill="transparent" onPointerMove={move} onPointerDown={move} onPointerLeave={() => setCur(null)} />
      </svg>
      {c && cur != null && <div className="vc-tip" style={{ left: Math.min(Math.max(cx, 120), w - 120), top: Math.max(0, y(c.v) - 14) }}>{tip(cur)}</div>}
    </div>
  );
}

/** Clip a step series to its last `range` seconds (the value at the start carries in). */
function clip<T extends { t: number }>(pts: T[], range: number | null): T[] {
  if (!range || !pts.length) return pts;
  const start = pts[pts.length - 1].t - range;
  if (start <= pts[0].t) return pts;
  const first = { ...stepAt(pts, start), t: start };
  return [first, ...pts.filter((p) => p.t > start)];
}

/**
 * Share price since inception, a step line: the price moves only when value changes
 * for everyone already in (interest, marks, markdowns, exit fees). Every move is a dot.
 */
export function SharePriceChart({ points, launch, label }: { points: SharePoint[]; launch: number; label: string }) {
  const [range, setRange] = useState("All");
  const span = points.length ? points[points.length - 1].t - points[0].t : 0;
  const shown = clip(points, RANGES.find(([k]) => k === range)?.[1] ?? null);
  const last = points[points.length - 1];
  const change = last ? last.price / launch - 1 : 0;
  const base = shown[0]?.price ?? launch;
  const inRange = last && range !== "All" ? last.price / base - 1 : null;
  const ps = shown.map((p) => p.price);
  let lo = Math.min(...ps), hi = Math.max(...ps);
  const pad = (hi - lo) * 0.08 || launch * 0.02;
  lo = Math.max(0, lo - pad); hi += pad;
  const step = niceTicks(lo, hi).step;
  const digits = Math.min(8, Math.max(2, -Math.floor(Math.log10(step)) + (step / 10 ** Math.floor(Math.log10(step)) === 2.5 ? 1 : 0)));
  // a dot per move while they are few; past that, only the moves that cut value
  const few = shown.filter((p) => p.kind in KINDS).length <= 30;
  const used = [...new Set(shown.map((p) => p.kind))].filter((k): k is keyof typeof KINDS => k in KINDS && (few || k === "mark"));
  return (
    <div className="vc">
      <div className="vc-head">
        <div className="vc-hero"><b>{last ? last.price.toFixed(6) : "—"}</b><small>KAS a share now</small></div>
        <div className="vc-stat"><b className={change > 0 ? "up" : change < 0 ? "down" : undefined}>{signed(change)}</b><small>since launch at {launch.toFixed(2)}</small></div>
        {inRange != null && <div className="vc-stat"><b className={inRange > 0 ? "up" : inRange < 0 ? "down" : undefined}>{signed(inRange)}</b><small>over {range}</small></div>}
        <Ranges span={span} value={range} set={setRange} />
      </div>
      <StepArea id="price" color={PRICE} lo={lo} hi={hi} fmtY={(v) => v.toFixed(digits)} label={`${label}: from ${launch.toFixed(4)} KAS at launch to ${last?.price.toFixed(4)} KAS now`}
        refLine={{ v: launch, label: `launch ${launch.toFixed(2)}` }}
        pts={shown.map((p) => ({ t: p.t, v: p.price, dot: p.kind in KINDS && (few || p.kind === "mark") ? KINDS[p.kind as keyof typeof KINDS].color : undefined }))}
        tip={(i) => { const p = shown[i]; return <><b>{p.title}</b><span>{stamp(p.t)}{p.amt ? ` · ${p.amt}` : ""}</span><span>{p.price.toFixed(6)} KAS a share · {signed(p.price / launch - 1)} since launch</span></>; }} />
      {used.length > 0 && <div className="vc-leg">{used.map((k) => <span key={k}><i style={{ background: KINDS[k].color }} />{KINDS[k].label}</span>)}</div>}
    </div>
  );
}

/**
 * Could holders leave? Cash in the vault (less its seed) as a share of NAV after
 * every move. A withdrawal is one transaction, paid at once or refused, so the
 * cash that was there is the whole story; the reserve floor is the line no loan may cross.
 */
export function LiquidityChart({ points, floor, redeems, paid }: { points: LiquidPoint[]; floor: number | null; redeems: number; paid: string }) {
  const [range, setRange] = useState("All");
  const span = points.length ? points[points.length - 1].t - points[0].t : 0;
  const shown = clip(points, RANGES.find(([k]) => k === range)?.[1] ?? null);
  if (!points.length) return <p className="muted" style={{ margin: 0 }}>No deposits yet: nothing to pay out.</p>;
  const now = points[points.length - 1].v;
  const low = points.reduce((a, p) => (p.v < a.v ? p : a), points[0]);
  return (
    <div className="vc">
      <div className="vc-head">
        <div className="vc-hero"><b>{Math.round(now * 100)}%</b><small>of NAV payable now</small></div>
        <div className="vc-stat"><b>{Math.round(low.v * 100)}%</b><small>lowest, {dateOf(low.t, 3 * DAY)}</small></div>
        <div className="vc-stat"><b>{redeems}</b><small>withdrawal{redeems === 1 ? "" : "s"}, {paid} paid</small></div>
        <Ranges span={span} value={range} set={setRange} />
      </div>
      <StepArea id="liq" color={LIQ} lo={0} hi={1} height={200} fmtY={(v) => `${Math.round(v * 100)}%`} label={`Cash payable as a share of NAV, now ${Math.round(now * 100)}%, lowest ${Math.round(low.v * 100)}%`}
        refLine={floor ? { v: floor, label: `reserve floor ${Math.round(floor * 100)}%` } : null}
        pts={shown.map((p) => ({ t: p.t, v: p.v }))}
        tip={(i) => { const p = shown[i]; return <><b>{p.title}</b><span>{stamp(p.t)}</span><span>{(p.v * 100).toFixed(1)}% of NAV payable in one transaction</span></>; }} />
    </div>
  );
}

/** Pick a bucket so the grid has at most 60 steps: minutes for a new vault, then hours, days, weeks. */
const STEPS = [5 * 60, 15 * 60, 30 * 60, HOUR, 3 * HOUR, 6 * HOUR, 12 * HOUR, DAY, 2 * DAY, 3 * DAY, 7 * DAY, 14 * DAY, 30 * DAY];

/**
 * Holding-period returns: every entry and exit pair on the vault's history, what
 * a holder would have made, including the exit fee (switchable). A diverging
 * scale: blue gained, red lost, gray broke even.
 */
export function HoldingGrid({ points, exitFeeBps }: { points: SharePoint[]; exitFeeBps: number }) {
  const [box, w] = useWidth(260);
  const [fee, setFee] = useState(true);
  const [cur, setCur] = useState<[number, number] | null>(null);
  const g = useMemo(() => {
    if (points.length < 2) return null;
    const t0 = points[0].t, t1 = points[points.length - 1].t, span = t1 - t0;
    const step = STEPS.find((s) => span / s <= 60) ?? STEPS[STEPS.length - 1];
    const n = Math.ceil(span / step);
    if (n < 3) return { n, step, t0, t1, span, times: [], price: [] };
    const times = Array.from({ length: n + 1 }, (_, k) => Math.min(t1, t0 + k * step));
    const price = times.map((t) => stepAt(points, t).price);
    return { n, step, t0, t1, span, times, price };
  }, [points]);
  if (!g || g.n < 3) return <p className="muted" style={{ margin: 0 }}>Needs a little more history: the grid fills in as the vault ages, one cell for every entry and exit pair.</p>;
  const keep = fee ? 1 - exitFeeBps / 1e4 : 1;
  const ret = (i: number, j: number) => (g.price[j] * keep) / g.price[i] - 1;
  let n = 0, ahead = 0, best = { r: -Infinity, i: 0, j: 1 }, worst = { r: Infinity, i: 0, j: 1 }, maxAbs = 0;
  let toNow = 0, toNowAhead = 0;
  for (let i = 0; i < g.n; i++) for (let j = i + 1; j <= g.n; j++) {
    const r = ret(i, j);
    n++; if (r >= 0) ahead++;
    if (j === g.n) { toNow++; if (r > 0) toNowAhead++; }
    if (r > best.r) best = { r, i, j };
    if (r < worst.r) worst = { r, i, j };
    maxAbs = Math.max(maxAbs, Math.abs(r));
  }
  // full colour at the 90th percentile of the moves, never below 2%: one outlier must not wash every cell to gray, and an exit fee must not look like a loss of capital
  const mags: number[] = [];
  for (let i = 0; i < g.n; i++) for (let j = i + 1; j <= g.n; j++) mags.push(Math.abs(ret(i, j)));
  mags.sort((a, b) => a - b);
  const sat = Math.max(0.02, mags[Math.floor(mags.length * 0.9)] || maxAbs);
  const color = (r: number) => {
    if (Math.abs(r) < 1e-9 || sat === 0) return `rgb(${MID.join(",")})`;
    const k = 0.25 + 0.75 * Math.min(1, Math.abs(r) / sat);
    const to = r > 0 ? GAIN : LOSS;
    return `rgb(${MID.map((m, i) => Math.round(m + (to[i] - m) * k)).join(",")})`;
  };
  const L = w < 480 ? 56 : 70, T = 6, B = 26, R = 6;
  const cw = (w - L - R) / g.n, ch = Math.max(3, Math.min(cw, 22, 400 / g.n));
  const gap = Math.min(cw, ch) >= 9 ? 2 : Math.min(cw, ch) >= 5 ? 1 : 0;
  const H = T + ch * g.n + B;
  const lab = (k: number) => dateOf(g.times[k], g.span);
  const ticks = Array.from(new Set([0, Math.round(g.n / 3), Math.round((2 * g.n) / 3), g.n - 1]));
  const move = (e: React.PointerEvent<SVGRectElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const col = Math.floor(((e.clientX - r.left) / r.width) * g.n) + 1;
    const row = Math.floor(((e.clientY - r.top) / r.height) * g.n);
    setCur(col > row && row >= 0 && col <= g.n ? [row, col] : null);
  };
  const unit = g.step >= DAY ? (g.step === DAY ? "day" : `${g.step / DAY} days`) : g.step >= HOUR ? `${g.step / HOUR} hour${g.step === HOUR ? "" : "s"}` : `${g.step / 60} minutes`;
  return (
    <div className="vc">
      <div className="vc-head">
        <div className="vc-hero"><b>{toNowAhead} of {toNow}</b><small>entries ahead if held to now</small></div>
        <div className="vc-stat"><b>{Math.round((ahead / n) * 100)}%</b><small>of all {n.toLocaleString("en-US")} windows didn&apos;t lose</small></div>
        <div className="vc-stat"><b className={best.r > 0 ? "up" : undefined}>{signed(best.r)}</b><small>best · {lab(best.i)} → {lab(best.j)}</small></div>
        <div className="vc-stat"><b className={worst.r < 0 ? "down" : undefined}>{signed(worst.r)}</b><small>worst · {lab(worst.i)} → {lab(worst.j)}</small></div>
        {exitFeeBps > 0 && (
          <div className="vc-ranges" role="group" aria-label="Exit fee">
            <button type="button" className={fee ? "on" : ""} aria-pressed={fee} onClick={() => setFee(true)}>After {exitFeeBps / 100}% exit fee</button>
            <button type="button" className={!fee ? "on" : ""} aria-pressed={!fee} onClick={() => setFee(false)}>Before</button>
          </div>
        )}
      </div>
      <div className="vc-plot" ref={box}>
        <svg viewBox={`0 0 ${w} ${H}`} width="100%" height={H} role="img" aria-label={`Holding-period returns: ${toNowAhead} of ${toNow} entries ahead if held to now; best ${signed(best.r)}, worst ${signed(worst.r)}`} style={{ display: "block" }}>
          {Array.from({ length: g.n }, (_, i) => Array.from({ length: g.n - i }, (_, k) => {
            const j = i + 1 + k;
            return <rect key={`${i}-${j}`} x={L + (j - 1) * cw} y={T + i * ch} width={Math.max(1, cw - gap)} height={Math.max(1, ch - gap)} rx={Math.min(cw, ch) >= 9 ? 2 : 0} fill={color(ret(i, j))}
              className={cur && cur[0] === i && cur[1] === j ? "vc-cell on" : "vc-cell"} />;
          }))}
          {ticks.map((k) => <text key={`y${k}`} x={L - 10} y={T + k * ch + ch / 2 + 3.5} textAnchor="end" className="vc-ax">{lab(k)}</text>)}
          {ticks.map((k, n) => <text key={`x${k}`} x={n === ticks.length - 1 ? L + (k + 1) * cw : L + k * cw + cw / 2} y={H - 8} textAnchor={n === ticks.length - 1 ? "end" : "middle"} className="vc-ax">{lab(k + 1)}</text>)}
          <rect x={L} y={T} width={cw * g.n} height={ch * g.n} fill="transparent" onPointerMove={move} onPointerDown={move} onPointerLeave={() => setCur(null)} />
        </svg>
        {cur && (() => {
          const [i, j] = cur, r = ret(i, j);
          return (
            <div className="vc-tip" style={{ left: Math.min(Math.max(L + (j - 0.5) * cw, 120), w - 120), top: T + i * ch - 6 }}>
              <b>{signed(r)}</b>
              <span>In {stamp(g.times[i])}</span>
              <span>Out {stamp(g.times[j])}</span>
              <span>{g.price[i].toFixed(6)} → {g.price[j].toFixed(6)} KAS a share{fee && exitFeeBps ? `, less ${exitFeeBps / 100}%` : ""}</span>
            </div>
          );
        })()}
      </div>
      <div className="vc-leg vc-scale">
        <span>Entry down the side, exit along the bottom · one step = {unit}</span>
        <span className="vc-ramp"><i style={{ background: `linear-gradient(90deg, rgb(${LOSS.join(",")}), rgb(${MID.join(",")}), rgb(${GAIN.join(",")}))` }} /><em>lost</em><em>even</em><em>gained</em></span>
      </div>
    </div>
  );
}
