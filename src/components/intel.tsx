import Link from "next/link";
import { AssetCoin, ProtocolCoin } from "./bits";
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

/** The week in one line: everything that arrived against everything that left, measured in tokens. */
export function FlowBalance({ rows }: { rows: ProtoFlow[] }) {
  const m = rows.filter((r) => r.measured);
  const parts = m.flatMap((r) => [r.lending, r.liquidity]);
  const inn = parts.filter((v) => v > 0).reduce((a, v) => a + v, 0);
  const out = -parts.filter((v) => v < 0).reduce((a, v) => a + v, 0);
  const max = Math.max(inn, out, 1);
  return (
    <div className="fbal">
      <div className="fbal-side out"><span>Left</span><b>{usd(out)}</b></div>
      <div className="fbal-track" role="img" aria-label={`Left ${usd(out)}, arrived ${usd(inn)}, net ${signedUsd(inn - out)}`}>
        <i className="o" style={{ width: `${(out / max) * 50}%` }} />
        <i className="i" style={{ width: `${(inn / max) * 50}%` }} />
        <em className={inn - out >= 0 ? "pos" : "neg"}>net {signedUsd(inn - out)}</em>
      </div>
      <div className="fbal-side in"><span>Arrived</span><b>{usd(inn)}</b></div>
    </div>
  );
}

/**
 * Net capital in or out of each protocol, one diverging bar each around a zero line.
 * Lending and liquidity are measured in token quantities. Protocols dawns can only see as
 * a TVL total are listed apart, on their own scale, because their change includes price.
 */
export function FlowBars({ rows, span }: { rows: ProtoFlow[]; span: number }) {
  const measured = rows.filter((r) => r.measured);
  const tvlOnly = rows.filter((r) => !r.measured);
  const row = (r: ProtoFlow, m: number) => {
    const v = r.measured ? r.lending + r.liquidity : r.tvlChange ?? 0;
    const w = Math.max(1.2, (Math.abs(v) / m) * 50);
    const parts = [r.lending ? `lending ${signedUsd(r.lending)}` : "", r.liquidity ? `pools ${signedUsd(r.liquidity)}` : ""].filter(Boolean).join(" · ");
    const tip = r.measured ? `${parts || "no change"} · valued at today's prices` : "TVL change, includes price moves";
    return (
      <Link key={r.id} href={`/protocols/${r.id}`} className={`fbar ${r.measured ? "" : "soft"}`} data-tip={tip}>
        <span className="fbar-l"><ProtocolCoin p={{ id: r.id, letter: r.letter }} size={28} /><span><b>{r.name}</b><small>{r.measured ? parts || "no change" : "TVL only, incl. price"}</small></span></span>
        <span className="fbar-t"><i className={`${v >= 0 ? "pos" : "neg"} ${r.measured ? "" : "fhatch"}`} style={{ width: `${w}%`, [v >= 0 ? "left" : "right"]: "50%" }} /></span>
        <b className={`fbar-v ${v >= 0 ? "pos" : "neg"}`}>{signedUsd(v)}</b>
      </Link>
    );
  };
  const mM = Math.max(...measured.map((r) => Math.abs(r.lending + r.liquidity)), 1);
  const mT = Math.max(...tvlOnly.map((r) => Math.abs(r.tvlChange ?? 0)), 1);
  return (
    <div className="fbars" role="img" aria-label={`Net capital by protocol, ${Math.round(span)} days: ${rows.map((r) => `${r.name} ${signedUsd(r.measured ? r.lending + r.liquidity : r.tvlChange ?? 0)}`).join(", ")}`}>
      <div className="fbar-axis" aria-hidden><span /><span className="fbar-t"><em>← Leaving</em><em>Arriving →</em></span><span /></div>
      {measured.map((r) => row(r, mM))}
      {tvlOnly.length > 0 && (
        <details className="fbar-more">
          <summary>{tvlOnly.length} more seen only as a TVL total <span className="muted">· includes price, on their own scale</span></summary>
          {tvlOnly.map((r) => row(r, mT))}
        </details>
      )}
    </div>
  );
}

/** Opportunities that moved, as cards: the pair, the move, its size against the whole. */
export function Movers({ rows, kind, empty }: { rows: Mover[]; kind: "flow" | "yield"; empty: string }) {
  if (!rows.length) return <p className="muted" style={{ margin: "6px 0 0" }}>{empty}</p>;
  return (
    <div className="movers">
      {rows.map((r) => {
        const up = r.value >= 0;
        const rel = kind === "flow" ? (r.size ? r.value / r.size : 0) : r.then ? r.value / r.then : 0;
        return (
          <div key={r.id} className={`mover ${up ? "pos" : "neg"}`} data-tip={kind === "flow" ? `${signedUsd(r.value)} in tokens, at today's prices · now ${usd(r.size)}` : `${yld(r.then)} → ${yld(r.now)} native yield`}>
            <span className="mover-i">{r.assets.slice(0, 2).map((a, i) => <span key={a + i} style={{ marginLeft: i ? -10 : 0 }}><AssetCoin a={a} size={26} /></span>)}</span>
            <span className="mover-n"><b>{r.name.replace(/ liquidity$/, "")}</b><small>{r.pname} · {r.kind === "supply" ? "lending" : "liquidity"}</small></span>
            <span className="mover-v">
              <b>{kind === "flow" ? signedUsd(r.value) : pp(r.value)}</b>
              <small>{kind === "flow" ? `${up ? "+" : "−"}${pct(Math.abs(rel), Math.abs(rel) < 0.1 ? 1 : 0)} of its size` : `${yld(r.then)} → ${yld(r.now)}`}</small>
            </span>
            <span className="mover-bar"><i style={{ width: `${Math.min(100, Math.max(3, Math.abs(rel) * 100))}%` }} /></span>
          </div>
        );
      })}
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
