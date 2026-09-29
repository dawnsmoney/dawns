"use client";

import { useEffect, useRef, useState } from "react";
import { formatAxis, formatValue, niceTicks, shortDate, usd, pct, type ValueFormat } from "@/lib/format";

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

export type Series = { name: string; color: string; values: number[] };
const CARD = "#241B58";

/* ---------- range toggle + area chart ---------- */
export function RangeChart(props: Omit<AreaProps, "range"> & { title: string; legend?: boolean }) {
  const [range, setRange] = useState<"1M" | "3M">("3M");
  return (
    <>
      <div className="c-head">
        <h3>{props.title}</h3>
        <div className="seg" role="group" aria-label="Range">
          {(["1M", "3M"] as const).map((r) => (
            <button key={r} type="button" className={r === range ? "on" : ""} onClick={() => setRange(r)}>{r}</button>
          ))}
        </div>
      </div>
      {props.legend && (
        <div className="legend" style={{ marginBottom: 12 }}>
          {props.series.map((s) => (<span key={s.name}><i style={{ background: s.color }} />{s.name}</span>))}
        </div>
      )}
      <AreaChart {...props} range={range} />
    </>
  );
}

type AreaProps = {
  series: Series[];
  dates: number[];
  stacked?: boolean;
  zero?: boolean;
  fmt?: ValueFormat;
  refLine?: number;
  refLabel?: string;
  area?: "first" | "all" | "none";
  height?: number;
  label: string;
  range?: "1M" | "3M";
  hourly?: boolean;
};

export function AreaChart({ series: all, dates: allDates, stacked, zero, fmt = "usdFull", refLine, refLabel, area = "first", height, label, range = "3M", hourly }: AreaProps) {
  const hh = (t: number) => `${String(new Date(t).getUTCHours()).padStart(2, "0")}:00`;
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const cut = range === "1M" ? -30 : 0;
  const series = all.map((s) => ({ ...s, values: cut ? s.values.slice(cut) : s.values }));
  const dates = cut ? allDates.slice(cut) : allDates;

  const W = Math.max(280, width || 600);
  const H = height ?? (W < 520 ? 220 : 280);
  const padL = fmt === "pct" ? 44 : fmt === "price" ? 72 : 54, padR = 14, padT = 14, padB = 26;
  const n = dates.length, iw = W - padL - padR, ih = H - padT - padB;

  const tops: number[][] = [];
  if (stacked) {
    let acc = new Array(n).fill(0);
    series.forEach((s) => { acc = acc.map((a, i) => a + s.values[i]); tops.push(acc.slice()); });
  }
  const vals = stacked ? tops[tops.length - 1] : series.flatMap((s) => s.values);
  let lo = zero ? 0 : Math.min(...vals);
  let hi = Math.max(...vals, refLine ?? -Infinity);
  if (!zero) { const pad = (hi - lo) * 0.12; lo -= pad; hi += pad * 0.5; }
  const ticks = niceTicks(lo, hi, 4);
  lo = ticks[0]; hi = ticks[ticks.length - 1];
  const x = (i: number) => padL + (i * iw) / (n - 1);
  const y = (v: number) => padT + ih - ((v - lo) / (hi - lo)) * ih;
  const line = (arr: number[]) => arr.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("L");
  // at most four date labels, never the same day twice (a short history has fewer points than labels)
  const xt = [0, Math.round((n - 1) / 3), Math.round((2 * (n - 1)) / 3), n - 1]
    .filter((i, j, a) => a.indexOf(i) === j)
    .filter((i, j, a) => j === 0 || shortDate(dates[i]) !== shortDate(dates[a[j - 1]]));
  const step = ticks.length > 1 ? ticks[1] - ticks[0] : 0;
  const gid = label.replace(/\W+/g, "");

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const r = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
    const sx = ((e.clientX - r.left) * W) / r.width;
    setHover(Math.max(0, Math.min(n - 1, Math.round(((sx - padL) / iw) * (n - 1)))));
  };
  const hv = hover;
  const topAt = (i: number) => (stacked ? tops[tops.length - 1][i] : Math.max(...series.map((s) => s.values[i])));

  return (
    <div className="chart" ref={ref}>
      {width > 0 && (
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={label}>
          <defs>
            {series.map((s, k) => (
              <linearGradient key={k} id={`${gid}g${k}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={s.color} stopOpacity={stacked ? 0.9 : 0.28} />
                <stop offset="1" stopColor={s.color} stopOpacity={stacked ? 0.55 : 0} />
              </linearGradient>
            ))}
          </defs>
          <g className="axis">
            {ticks.map((t) => (
              <g key={t}>
                <line className="grid-l" x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} />
                <text x={padL - 10} y={y(t) + 4} textAnchor="end">{formatAxis(t, fmt, step)}</text>
              </g>
            ))}
            {xt.map((i, j) => (
              <text key={j} x={x(i)} y={H - 6} textAnchor={j === 0 ? "start" : j === xt.length - 1 ? "end" : "middle"}>{shortDate(dates[i])}{hourly && n < 60 ? ` ${hh(dates[i])}` : ""}</text>
            ))}
          </g>
          {refLine != null && (
            <>
              <line x1={padL} x2={W - padR} y1={y(refLine)} y2={y(refLine)} stroke="#FFC061" strokeDasharray="4 4" opacity=".7" />
              <text x={W - padR} y={y(refLine) - 6} textAnchor="end" fill="#FFC061" style={{ font: "500 11.5px var(--display)" }}>{refLabel}</text>
            </>
          )}
          {stacked ? (
            <>
              {series.map((_, k) => {
                const kk = series.length - 1 - k;
                const top = tops[kk];
                const bot = kk ? tops[kk - 1] : new Array(n).fill(0);
                const d = "M" + line(top) + "L" + bot.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).reverse().join("L") + "Z";
                return (
                  <g key={kk}>
                    <path d={d} fill={`url(#${gid}g${kk})`} />
                    <path d={"M" + line(top)} fill="none" stroke={CARD} strokeWidth="2" />
                  </g>
                );
              })}
              <path d={"M" + line(tops[tops.length - 1])} fill="none" stroke="#fff" strokeOpacity=".55" strokeWidth="1.5" />
            </>
          ) : (
            series.map((s, k) => (
              <g key={s.name}>
                {(area === "all" || (area === "first" && k === 0)) && (
                  <path d={`M${line(s.values)}L${x(n - 1)},${y(lo)}L${x(0)},${y(lo)}Z`} fill={`url(#${gid}g${k})`} />
                )}
                <path d={"M" + line(s.values)} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
                <circle cx={x(n - 1)} cy={y(s.values[n - 1])} r="4.5" fill={s.color} stroke={CARD} strokeWidth="2" />
              </g>
            ))
          )}
          {hv != null && (
            <g>
              <line x1={x(hv)} x2={x(hv)} y1={padT} y2={padT + ih} stroke="rgba(255,255,255,.35)" />
              {series.map((s, k) => (
                <circle key={k} cx={x(hv)} cy={y(stacked ? tops[k][hv] : s.values[hv])} r="4.5" fill={s.color} stroke={CARD} strokeWidth="2" />
              ))}
            </g>
          )}
          <rect x={padL} y={padT} width={iw} height={ih} fill="transparent" onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setHover(null)} />
        </svg>
      )}
      {hv != null && width > 0 && (
        <div className="tip" style={{ left: Math.max(80, Math.min(width - 80, (x(hv) * width) / W)), top: (y(topAt(hv)) * width) / W - 12 }}>
          <div className="d">{shortDate(dates[hv])}{hourly ? `, ${hh(dates[hv])} UTC` : ", 2026"}</div>
          {stacked && <div className="r"><span>Total</span><b>{formatValue(tops[tops.length - 1][hv], fmt)}</b></div>}
          {[...series].reverse().map((s) => (
            <div className="r" key={s.name}><span><i style={{ background: s.color }} />{s.name}</span><b>{formatValue(s.values[hv], fmt)}</b></div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- bars ---------- */
export function Bars({ values, dates, pos, neg, posLabel, negLabel, diverging, height = 210, label }: { values: number[]; dates: number[]; pos: string; neg: string; posLabel: string; negLabel: string; diverging?: boolean; height?: number; label: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hv, setHv] = useState<number | null>(null);
  const W = Math.max(280, width || 600), H = height, padL = 54, padR = 14, padT = 12, padB = 26;
  const n = values.length, iw = W - padL - padR, ih = H - padT - padB;
  const mx = Math.max(...values.map(Math.abs));
  const ticks = niceTicks(diverging ? -mx : 0, mx, 4);
  const lo = ticks[0], hi = ticks[ticks.length - 1];
  const y = (v: number) => padT + ih - ((v - lo) / (hi - lo)) * ih;
  const bw = iw / n, gap = Math.max(2, bw * 0.25);
  return (
    <div className="chart" ref={ref}>
      {width > 0 && (
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={label} onPointerLeave={() => setHv(null)}>
          <g className="axis">
            {ticks.map((t) => (
              <g key={t}>
                <line className="grid-l" x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} />
                <text x={padL - 10} y={y(t) + 4} textAnchor="end">{usd(t, 0)}</text>
              </g>
            ))}
            {[0, Math.round((n - 1) / 2), n - 1].map((i, j) => (
              <text key={j} x={padL + i * bw + bw / 2} y={H - 6} textAnchor={j === 0 ? "start" : j === 2 ? "end" : "middle"}>{shortDate(dates[i])}</text>
            ))}
          </g>
          {values.map((v, i) => {
            const y0 = y(0), y1 = y(v), w = bw - gap;
            return (
              <rect key={i} x={padL + i * bw + gap / 2} y={Math.min(y0, y1)} width={w} height={Math.max(1, Math.abs(y1 - y0))} rx={Math.min(3, w / 2)}
                fill={v >= 0 ? pos : neg} opacity={hv == null || hv === i ? 1 : 0.45} />
            );
          })}
          <line x1={padL} x2={W - padR} y1={y(0)} y2={y(0)} stroke="rgba(255,255,255,.3)" />
          {values.map((_, i) => (
            <rect key={i} x={padL + i * bw} y={padT} width={bw} height={ih} fill="transparent" onPointerEnter={() => setHv(i)} onPointerDown={() => setHv(i)} />
          ))}
        </svg>
      )}
      {hv != null && width > 0 && (
        <div className="tip" style={{ left: Math.max(80, Math.min(width - 80, ((padL + hv * bw + bw / 2) * width) / W)), top: (Math.min(y(values[hv]), y(0)) * width) / W - 10 }}>
          <div className="d">{shortDate(dates[hv])}, 2026</div>
          <div className="r"><span><i style={{ background: values[hv] >= 0 ? pos : neg }} />{values[hv] >= 0 ? posLabel : negLabel}</span><b>{usd(values[hv])}</b></div>
        </div>
      )}
    </div>
  );
}

/* ---------- donut ---------- */
export function Donut({ items }: { items: { n: string; v: number; c: string }[] }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hv, setHv] = useState<{ k: number; x: number; y: number } | null>(null);
  const S = Math.min(210, Math.max(170, (width || 400) * 0.42));
  const r = S / 2 - 4, rin = r * 0.62;
  const tot = items.reduce((s, i) => s + i.v, 0);
  const pt = (ang: number, rr: number) => `${(Math.cos(ang) * rr).toFixed(2)},${(Math.sin(ang) * rr).toFixed(2)}`;
  const starts = items.map((_, i) => -Math.PI / 2 + (items.slice(0, i).reduce((s, x) => s + x.v, 0) / tot) * Math.PI * 2);
  const arcs = items.map((it, i) => {
    const a = starts[i], da = (it.v / tot) * Math.PI * 2, a2 = a + da, big = da > Math.PI ? 1 : 0;
    return `M${pt(a, r)} A${r},${r} 0 ${big} 1 ${pt(a2, r)} L${pt(a2, rin)} A${rin},${rin} 0 ${big} 0 ${pt(a, rin)} Z`;
  });
  return (
    <div className="donut" ref={ref}>
      <div className="chart" style={{ width: S }}>
        <svg width={S} height={S} viewBox={`${-S / 2} ${-S / 2} ${S} ${S}`} role="img" aria-label="Value by asset" onPointerLeave={() => setHv(null)}>
          {arcs.map((d, k) => (
            <path key={k} d={d} fill={items[k].c} stroke={CARD} strokeWidth="3" strokeLinejoin="round" opacity={hv == null || hv.k === k ? 1 : 0.45}
              onPointerMove={(e) => { const R = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect(); setHv({ k, x: e.clientX - R.left, y: e.clientY - R.top }); }} />
          ))}
          <text y="-4" textAnchor="middle" fill="#fff" style={{ font: "600 22px var(--display)" }}>{usd(tot)}</text>
          <text y="18" textAnchor="middle" fill="#9C93C8" style={{ font: "500 12px var(--display)" }}>all assets</text>
        </svg>
        {hv && (
          <div className="tip" style={{ left: hv.x, top: hv.y - 8 }}>
            <div className="r"><span><i style={{ background: items[hv.k].c }} />{items[hv.k].n}</span><b>{usd(items[hv.k].v)}</b></div>
            <div className="r"><span>Share</span><b>{pct(items[hv.k].v / tot)}</b></div>
          </div>
        )}
      </div>
      <div className="legend">
        {items.map((it) => (
          <span key={it.n}><span style={{ display: "flex", gap: 8, alignItems: "center" }}><i style={{ background: it.c }} />{it.n}</span><b>{pct(it.v / tot)}</b></span>
        ))}
      </div>
    </div>
  );
}
