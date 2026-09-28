"use client";

import Link from "next/link";
import { useState } from "react";
import { Pill } from "./bits";
import { SplitBar, type Part } from "./viz";
import type { Evaluation, StrategyDoc, Term, Enforcer } from "@/lib/strategies/model";
import { usd } from "@/lib/format";

/* Strategy graphics. Leg colours follow the leg's slot (fixed order), reserve is neutral;
   status colours only carry status, always with a word. */
import { LEG_COLORS, RESERVE_COLOR } from "@/lib/strategies/parts";
import { splitParts } from "@/lib/strategies/parts";
const p1 = (x: number, d = 1) => `${(x * 100).toFixed(d)}%`;
const bp = (b: number) => `${(b / 100).toFixed(b % 100 ? 1 : 0)}%`;

/** Expected Net APY as a waterfall: native yield, rewards (never counted), fees, net. */
export function ApyWaterfall({ ev }: { ev: Evaluation }) {
  const [on, setOn] = useState<number | null>(null);
  const paused = ev.legs.filter((l) => l.paused.length).map((l) => l.o?.name);
  if (ev.gross == null) return <p className="muted" style={{ margin: 0 }}>No leg has a measured yield yet: {ev.measuring.join(", ")}.</p>;
  const g = ev.gross, max = Math.max(g, 0.0001);
  const rows = [
    { label: "Native yield", sub: "Paid by borrowers and traders, on the whole vault (reserve earns nothing)", from: 0, to: g, v: `${p1(g, 2)}`, kind: "base" },
    { label: "Ecosystem rewards", sub: "Token incentives: shown on protocols, never added", from: g, to: g, v: "+0.00%", kind: "zero" },
    { label: "Performance fee", sub: "The strategist's share of yield only, never of principal", from: g - ev.perfFee, to: g, v: `−${p1(ev.perfFee, 2)}`, kind: "fee" },
    ...(ev.mgmtFee ? [{ label: "Management fee", sub: "Charged on time", from: g - ev.perfFee - ev.mgmtFee, to: g - ev.perfFee, v: `−${p1(ev.mgmtFee, 2)}`, kind: "fee" }] : []),
    { label: "Expected net APY", sub: ev.range ? `At the legs' observed lows and highs: ${p1(ev.range[0] * (1 - (ev.perfFee / (g || 1))) - ev.mgmtFee, 1)} to ${p1(ev.range[1] * (1 - (ev.perfFee / (g || 1))) - ev.mgmtFee, 1)}` : "", from: 0, to: ev.net ?? 0, v: p1(ev.net ?? 0, 2), kind: "net" },
  ];
  return (
    <div className="st-wf" role="img" aria-label={rows.map((r) => `${r.label} ${r.v}`).join(", ")}>
      {rows.map((r, i) => (
        <div key={r.label} className={`st-wf-row ${r.kind}`} onMouseEnter={() => setOn(i)} onMouseLeave={() => setOn(null)} tabIndex={0} onFocus={() => setOn(i)} onBlur={() => setOn(null)}>
          <span className="st-wf-l"><b>{r.label}</b></span>
          <span className="st-wf-t">
            <i style={{ left: `${(Math.max(0, r.from) / max) * 100}%`, width: `${Math.max(r.kind === "zero" ? 0 : 0.6, ((Math.max(0, r.to) - Math.max(0, r.from)) / max) * 100)}%` }} />
            {r.kind === "zero" && <em style={{ left: `${(g / max) * 100}%` }} />}
          </span>
          <b className="st-wf-v">{r.v}</b>
        </div>
      ))}
      {paused.length > 0 && <p className="muted" style={{ fontSize: 13, margin: "4px 0 0" }}>{paused.join(", ")} {paused.length > 1 ? "are" : "is"} paused by the strategy&apos;s rules: {paused.length > 1 ? "their" : "its"} share would wait in reserve and earn nothing until the market reopens.</p>}
      <div className="split-tip">{on != null ? <span>{rows[on].sub}</span> : <span className="muted">Hover a step for how it is counted</span>}</div>
    </div>
  );
}

/** How much of the vault could leave right now, at full capacity. */
export function ExitStack({ doc, ev }: { doc: StrategyDoc; ev: Evaluation }) {
  const cap = ev.capacityUsd ?? 0;
  const lp = ev.legs.filter((l) => l.o?.kind === "lp").reduce((s, l) => s + l.share, 0);
  const lendNow = cap ? ev.legs.filter((l) => l.o?.kind === "supply").reduce((s, l) => s + l.exitUsd, 0) / cap : 0;
  const all = ev.legs.filter((l) => l.o?.kind === "supply").reduce((s, l) => s + l.share, 0) + ev.legs.filter((l) => !l.o).reduce((s, l) => s + l.share, 0);
  const parts: Part[] = [
    { key: "r", label: "Reserve: paid at once", color: RESERVE_COLOR, share: doc.reserveBps / 10_000 },
    { key: "lend", label: "Lending: withdrawable now", color: "#2FA88F", share: lendNow },
    { key: "lp", label: "Liquidity: out at the pool price", color: "#D17A30", share: lp },
    { key: "wait", label: "Waits for borrowers to repay", color: "#3A3366", share: Math.max(0, all - lendNow) },
  ].filter((p) => p.share > 0.0005);
  return <SplitBar parts={parts} label="Exit at full capacity" height={26} />;
}

/** One row per leg: weight against cap, yield with its range, exit cover, what the rules say now. */
export function LegList({ doc, ev }: { doc: StrategyDoc; ev: Evaluation }) {
  const maxApy = Math.max(0.0001, ...ev.legs.map((l) => Math.max(l.apy ?? 0, l.range?.[1] ?? 0)));
  return (
    <div className="st-legs">
      <div className="st-leg head" aria-hidden><span>Leg</span><span>Target · cap</span><span>Native yield · observed range</span><span>Exit cover</span></div>
      {ev.legs.map((l, i) => (
        <div key={l.leg.opp} className="st-leg">
          <span className="st-leg-n">
            <i style={{ background: LEG_COLORS[i] }} />
            <span><b>{l.o?.name ?? l.leg.opp}</b><small>{l.o ? `${l.o.pname} · ${l.o.kind === "supply" ? "lending" : "liquidity"} · ${l.o.chain}` : "not listed now"}</small></span>
          </span>
          <span className="st-leg-cap" title={`Target ${bp(l.leg.target)}, hard cap ${bp(l.leg.cap)}`}>
            <span className="capbar hbar-t"><i style={{ width: `${l.share * 100}%`, background: LEG_COLORS[i] }} /><em style={{ left: `${l.cap * 100}%` }} /></span>
            <small><b>{bp(l.leg.target)}</b> · cap {bp(l.leg.cap)}{ev.capacityUsd ? ` · ${usd(l.usd)}` : ""}</small>
          </span>
          <span className="st-leg-apy" title={l.range ? `Observed ${p1(l.range[0], 2)} to ${p1(l.range[1], 2)} over ${Math.round(l.o?.rangeHours ?? 0)} h` : l.o?.apyBasis}>
            <span className="st-range">
              {l.range && <i style={{ left: `${(l.range[0] / maxApy) * 100}%`, width: `${Math.max(1, ((l.range[1] - l.range[0]) / maxApy) * 100)}%` }} />}
              {l.apy != null && <em style={{ left: `${(l.apy / maxApy) * 100}%`, background: LEG_COLORS[i] }} />}
            </span>
            <small><b>{l.apy != null ? p1(l.apy, 2) : "measuring"}</b>{l.range ? ` · ${p1(l.range[0], 1)}–${p1(l.range[1], 1)}` : ""}</small>
          </span>
          <span className="st-leg-exit">
            {l.paused.length ? <Pill t="warn">Paused</Pill> : l.o?.kind === "lp" ? <Pill t="info">Pool price</Pill> : l.cover == null ? <Pill t="info">—</Pill> : <Pill t={l.cover >= doc.exitCover ? "good" : l.cover >= 1 ? "warn" : "crit"}>{l.cover >= 100 ? ">100" : l.cover.toFixed(1)}× cash</Pill>}
          </span>
          {l.flags.length > 0 && <ul className="st-flags">{l.flags.map((f) => <li key={f.text} className={f.t}>{f.text}</li>)}</ul>}
        </div>
      ))}
    </div>
  );
}

const BY: Record<Enforcer, { label: string; color: string; one: string }> = {
  covenant: { label: "Covenant", color: "#4ADE9B", one: "Every Kaspa node refuses a breach" },
  keeper: { label: "Keeper", color: "#9085e9", one: "The operator's process, bounded by the covenant" },
  monitor: { label: "dawns monitor", color: "#4F8EE0", one: "Checked every snapshot and flagged, not blocked" },
  "not yet": { label: "Not enforced yet", color: "#FFC061", one: "Stated, but nothing stops a breach today" },
};
/** Every term of the strategy, and who or what enforces it. */
export function EnforcementMap({ terms }: { terms: Term[] }) {
  const order: Enforcer[] = ["covenant", "keeper", "monitor", "not yet"];
  const parts: Part[] = order.map((k) => ({ key: k, label: BY[k].label, color: BY[k].color, share: terms.filter((t) => t.by === k).length })).filter((p) => p.share);
  return (
    <div style={{ display: "grid", gap: 18 }}>
      <SplitBar parts={parts} label="Terms by enforcer" height={16} />
      <div className="st-enf">
        {order.map((k) => {
          const ts = terms.filter((t) => t.by === k);
          if (!ts.length) return null;
          return (
            <div key={k} className="st-enf-col">
              <span className="st-enf-h"><i style={{ background: BY[k].color }} /><b>{BY[k].label}</b><small>{BY[k].one}</small></span>
              {ts.map((t) => <div key={t.term} className="st-term" title={t.how}><span>{t.term}</span><b>{t.value}</b><small>{t.how}</small></div>)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Four roles, never the same key. */
export function Roles({ strategist }: { strategist: string }) {
  const R = [
    ["Strategist", strategist, "Writes the strategy and earns the performance fee. Cannot touch capital or change a live vault's terms."],
    ["Curator · guardian", "Launches the vault from the strategy", "Holds the guardian key: can halt new allocations. Cannot move capital or stop redemptions."],
    ["Allocator", "Executes inside the mandate", "Moves capital only to the strategy's slots, within caps, reserve and per-move limits the covenant checks."],
    ["Depositors", "Anyone, from any wallet", "Get shares at NAV and can always redeem at NAV, paid only to their own address. No key needed."],
  ];
  return (
    <div className="flow">
      {R.map(([h, who, p], i) => <div key={h} className="flow-step"><span>{i + 1}</span><b>{h}</b><small className="mono" style={{ color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis" }}>{who}</small><small>{p}</small></div>)}
    </div>
  );
}

/** A strategy on the marketplace. */
export function StrategyCard({ id, doc, ev, strategist, by }: { id: string; doc: StrategyDoc; ev: Evaluation; strategist: string; by: "dawns" | "strategist" }) {
  const tags = [doc.vault.type === "fixed" ? `${doc.vault.termDays}-day term` : doc.vault.redemptionDays ? `Redeem ≤ ${doc.vault.redemptionDays}d` : "Redeem from reserve", doc.vault.access === "permissionless" ? "Permissionless" : doc.vault.access === "whitelist" ? "Whitelist" : "Private", ...(doc.vault.exitFeeBps ? [`Exit fee ${bp(doc.vault.exitFeeBps)}`] : [])];
  return (
    <Link href={`/strategies/${id}`} className="card vcard st-card">
      <span className="vc-top"><span className="vc-kind" style={{ ["--c" as string]: doc.vault.type === "fixed" ? "#c98500" : "#3987e5" }}><i />{doc.vault.type === "fixed" ? "Fixed term" : "Open term"}</span><Pill t={ev.status}>{ev.statusText}</Pill></span>
      <b className="vc-name">{doc.name}</b>
      <span className="st-tags">{tags.map((t) => <span key={t}>{t}</span>)}</span>
      <small className="muted st-thesis">{doc.thesis}</small>
      <SplitBar parts={splitParts(doc, ev)} label="Split" height={14} legend={false} tip={false} />
      <span className="vc-figs">
        <span><small>Net APY</small><b>{ev.net != null ? p1(ev.net, 1) : "—"}</b></span>
        <span><small>Out now</small><b>{p1(ev.exitNow, 0)}</b></span>
        <span><small>Legs</small><b>{doc.legs.length}</b></span>
        <span><small>Perf. fee</small><b>{bp(doc.fees.performanceBps)}</b></span>
      </span>
      <span className="vc-foot"><span>By <b>{by === "dawns" ? "Dawns · reference" : `${strategist.slice(0, 14)}…${strategist.slice(-5)}`}</b></span><span className="muted mono">{id}</span></span>
    </Link>
  );
}

/** Every strategy on one plane: what it pays against how much of it can leave now. */
export function StrategyMap({ rows }: { rows: { id: string; name: string; net: number | null; exit: number; status: Evaluation["status"] }[] }) {
  const [on, setOn] = useState<string | null>(null);
  const pts = rows.filter((r) => r.net != null);
  const maxY = Math.max(0.05, ...pts.map((r) => r.net!)) * 1.15;
  const W = 640, H = 260, L = 44, B = 30, T = 12, R = 12;
  const x = (v: number) => L + v * (W - L - R), y = (v: number) => T + (1 - Math.max(0, v) / maxY) * (H - T - B);
  const hit = pts.find((r) => r.id === on);
  const ticks = [0, maxY / 2, maxY];
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`Net APY against share that can leave now: ${pts.map((r) => `${r.name} ${p1(r.net!, 1)}, ${p1(r.exit, 0)}`).join("; ")}`}>
        {ticks.map((t) => <g key={t}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="rgba(255,255,255,.08)" /><text x={L - 8} y={y(t)} textAnchor="end" dominantBaseline="central" fill="var(--ink-3)" fontSize="11">{p1(t, 0)}</text></g>)}
        {[0, 0.5, 1].map((t) => <text key={t} x={x(t)} y={H - 10} textAnchor="middle" fill="var(--ink-3)" fontSize="11">{p1(t, 0)}</text>)}
        <text x={W - R} y={H - 22} textAnchor="end" fill="var(--ink-3)" fontSize="11">can leave now →</text>
        <text x={L + 6} y={T + 8} fill="var(--ink-3)" fontSize="11">↑ net APY</text>
        {pts.map((r) => (
          <a key={r.id} href={`/strategies/${r.id}`} onMouseEnter={() => setOn(r.id)} onMouseLeave={() => setOn(null)} onFocus={() => setOn(r.id)} onBlur={() => setOn(null)}>
            <circle cx={x(r.exit)} cy={y(r.net!)} r={16} fill="transparent" />
            <circle cx={x(r.exit)} cy={y(r.net!)} r={on === r.id ? 8 : 6} fill={r.status === "crit" ? "#FF7A7A" : r.status === "warn" ? "#FFC061" : "#4ADE9B"} stroke="var(--card)" strokeWidth={2} />
            {pts.length <= 8 && <text x={x(r.exit) + (r.exit > 0.7 ? -12 : 12)} y={y(r.net!)} textAnchor={r.exit > 0.7 ? "end" : "start"} dominantBaseline="central" fill="var(--ink-2)" fontSize="12">{r.name}</text>}
          </a>
        ))}
      </svg>
      <div className="split-tip">{hit ? <span><b>{hit.name}</b> · net {p1(hit.net!, 1)} · {p1(hit.exit, 0)} can leave now</span> : <span className="muted">Up is more yield, right is easier to leave. Colour is whether the strategy holds its own rules today.</span>}</div>
    </div>
  );
}
