import Link from "next/link";
import { Sparkline } from "./bits";
import { usd, pct } from "@/lib/format";
import type { Mover, ProtoFlow, Tag } from "@/lib/intel";

/* Intelligence building blocks. Server-safe: no hooks; hover shows the numbers behind each mark. */

export const FLOW_IN = "#2FA88F";
export const FLOW_OUT = "#D55A7C";
const sgn = (v: number) => (v > 0 ? "+" : v < 0 ? "−" : "");
export const signedUsd = (v: number) => `${sgn(Math.round(v))}${usd(Math.abs(v))}`;
export const pp = (v: number) => `${sgn(v)}${(Math.abs(v) * 100).toFixed(Math.abs(v) < 0.01 ? 2 : 1)} pp`;
const yld = (v: number | null) => (v == null ? "—" : pct(v, v < 0.1 ? 2 : 1));

/** Tags from measured changes, never a score. Each carries the numbers behind it. */
export function Tags({ tags, max = 3 }: { tags: Tag[]; max?: number }) {
  return (
    <span className="dv-tags">
      {tags.slice(0, max).map((t) => (
        <span key={t.key} className={`dv-tag t-${t.tone}`} title={t.why}>
          <i aria-hidden>{t.tone === "up" ? "▲" : t.tone === "down" ? "▼" : t.tone === "warn" ? "!" : "•"}</i>{t.text}
        </span>
      ))}
    </span>
  );
}

/**
 * Net capital in or out of each protocol, one diverging bar each around a zero line.
 * Lending and liquidity are measured in token quantities; a protocol dawns can only see
 * as a TVL total gets a hatched bar, because its change includes price.
 */
export function FlowBars({ rows, span }: { rows: ProtoFlow[]; span: number }) {
  const val = (r: ProtoFlow) => (r.measured ? r.lending + r.liquidity : r.tvlChange ?? 0);
  const m = Math.max(...rows.map((r) => Math.abs(val(r))), 1);
  return (
    <div className="fbars" role="img" aria-label={`Net capital by protocol, ${Math.round(span)} days: ${rows.map((r) => `${r.name} ${signedUsd(val(r))}`).join(", ")}`}>
      <div className="fbar fbar-axis" aria-hidden><span /><span className="fbar-t"><em>Leaving</em><em>Arriving</em></span><span /></div>
      {rows.map((r) => {
        const v = val(r);
        const w = Math.max(0.8, (Math.abs(v) / m) * 50);
        const parts = [r.lending ? `lending ${signedUsd(r.lending)}` : "", r.liquidity ? `liquidity ${signedUsd(r.liquidity)}` : ""].filter(Boolean).join(" · ");
        const tip = r.measured ? `${r.name}: ${signedUsd(v)} (${parts || "no change"}), valued at today's prices` : `${r.name}: TVL ${signedUsd(v)}, includes price moves`;
        return (
          <div key={r.id} className="fbar" title={tip}>
            <span className="fbar-l"><Link href={`/protocols/${r.id}`}>{r.name}</Link><small>{r.measured ? parts || "no change" : "TVL change, incl. price"}</small></span>
            <span className="fbar-t">
              <i className={r.measured ? "" : "fhatch"} style={{ width: `${w}%`, [v >= 0 ? "left" : "right"]: "50%", background: r.measured ? (v >= 0 ? FLOW_IN : FLOW_OUT) : undefined, color: v >= 0 ? FLOW_IN : FLOW_OUT }} />
            </span>
            <b>{signedUsd(v)}</b>
          </div>
        );
      })}
    </div>
  );
}

/** A ranked list of opportunities that moved, with the daily yield behind the move. */
export function Movers({ rows, kind, empty }: { rows: Mover[]; kind: "flow" | "yield"; empty: string }) {
  if (!rows.length) return <p className="muted" style={{ margin: "6px 0 0" }}>{empty}</p>;
  return (
    <div className="movers">
      {rows.map((r) => (
        <div key={r.id} className="mover">
          <span className="mover-n"><b>{r.name.replace(/ liquidity$/, "")}</b><small>{r.pname} · {r.kind === "supply" ? "lending" : "liquidity"} · {usd(r.size)}</small></span>
          <span className="mover-s" title={r.series.length ? `Daily native yield, ${r.series.length} days: ${r.series.map((v) => yld(v)).join(", ")}` : "No daily history yet"}><Sparkline values={r.series} /></span>
          <span className="mover-v">
            <b style={{ color: r.value >= 0 ? FLOW_IN : FLOW_OUT }}>{kind === "flow" ? signedUsd(r.value) : pp(r.value)}</b>
            <small>{kind === "flow" ? `yield ${yld(r.now)}` : `${yld(r.then)} → ${yld(r.now)}`}</small>
          </span>
        </div>
      ))}
    </div>
  );
}

/** One figure with its comparison, for the strip at the top. */
export function Stat({ label, value, sub, delta }: { label: string; value: string; sub: React.ReactNode; delta?: { v: number; text: string } | null }) {
  return (
    <div className="card istat">
      <span className="eyebrow muted">{label}</span>
      <b>{value}</b>
      {delta && <em className={delta.v > 0 ? "up" : delta.v < 0 ? "down" : ""}>{delta.v > 0 ? "▲" : delta.v < 0 ? "▼" : "•"} {delta.text}</em>}
      <small className="muted">{sub}</small>
    </div>
  );
}
