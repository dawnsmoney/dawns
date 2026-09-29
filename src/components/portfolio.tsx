import Link from "next/link";
import { Tags } from "./intel";
import { assetColor, SERIES } from "./bits";
import { usd } from "@/lib/format";
import { POS_COLOR, POS_LABEL, type Portfolio, type Position } from "@/lib/portfolio";
import type { Tag } from "@/lib/intel";

const amt = (v: number) => { const a = Math.abs(v); return `${v < 0 ? "−" : ""}${a >= 1e6 ? (a / 1e6).toFixed(2) + "M" : a >= 1e3 ? (a / 1e3).toFixed(1) + "K" : a >= 1 ? a.toFixed(2) : a.toPrecision(3)}`; };

/** Look-through colours: one per underlying asset, fixed by the asset, never by rank. */
export function exposureParts(p: Portfolio) {
  const used = new Set<string>();
  return p.exposure.map((e, i) => {
    let c = assetColor(e.sym);
    if (c === "#6E6788" || used.has(c)) c = SERIES.find((x) => !used.has(x)) ?? SERIES[i % SERIES.length];
    used.add(c);
    return { key: e.sym, label: e.sym, share: e.share, color: c, note: usd(e.usd) };
  });
}
export const kindParts = (p: Portfolio) => p.byKind.map((k) => ({ key: k.kind, label: POS_LABEL[k.kind], share: k.usd / (p.gross || 1), color: POS_COLOR[k.kind], note: usd(k.usd) }));

/** The address form: a plain GET, so a portfolio link can be shared or bookmarked. */
export function AddressForm({ value, mine }: { value?: string; mine?: string | null }) {
  return (
    <form className="pf-form" action="/portfolio" method="get">
      <label htmlFor="pf-a" className="eyebrow muted">Addresses: Igra or Kasplex (0x…) and Kaspa (kaspa:…)</label>
      <div className="pf-row">
        <input id="pf-a" name="a" defaultValue={value} placeholder="0x… , kaspa:q…" spellCheck={false} autoComplete="off" required />
        <button className="btn iris" type="submit">Look through</button>
      </div>
      {mine && mine.toLowerCase() !== value?.toLowerCase() && <Link className="pf-mine" href={`/portfolio?a=${encodeURIComponent(mine)}`}>Use my signed-in wallet{mine.includes(",") ? "s" : ""}</Link>}
      <small className="muted">Up to five, separated by commas. Read-only: dawns reads public balances and stores nothing.</small>
    </form>
  );
}

/** One row per position: what it is, what is underneath, and what could leave today. */
export function PositionTable({ rows, tags }: { rows: Position[]; tags: Record<string, Tag[]> }) {
  return (
    <div className="card flush"><div className="tbl-wrap"><table className="pf-tbl">
      <thead><tr><th>Position</th><th>Value</th><th>Underneath</th><th>Could leave today</th><th>Dawns view</th></tr></thead>
      <tbody>
        {rows.map((x) => (
          <tr key={x.key}>
            <td><span className="vt-name"><i style={{ background: POS_COLOR[x.kind] }} /><span>{x.href ? <Link href={x.href}><b>{x.name}</b></Link> : <b>{x.name}</b>}<small>{POS_LABEL[x.kind]} · {x.sub} · {x.chain}</small>{x.actions && <PosActions a={x.actions} />}</span></span></td>
            <td className={x.usd != null && x.usd < 0 ? "neg" : ""}><b>{x.usd != null ? `${x.usd < 0 ? "−" : ""}${usd(Math.abs(x.usd))}` : x.valueText ?? "no price"}</b></td>
            <td className="soft">{x.under.map((u) => `${amt(u.amount)} ${u.sym}`).join(" + ")}</td>
            <td className="soft">{x.exitNow != null ? usd(x.exitNow) : x.kind === "vault" ? "at NAV" : "—"}<small className="muted" style={{ display: "block" }}>{x.exitNote}</small></td>
            <td className="dv">{x.opp && tags[x.opp] ? <Tags tags={tags[x.opp]} max={2} /> : <span className="muted">—</span>}</td>
          </tr>
        ))}
      </tbody>
    </table></div></div>
  );
}

/** Add to or take out of a position: in the protocol's own app, or on dawns' vault page. */
export function PosActions({ a }: { a: NonNullable<Position["actions"]> }) {
  return (
    <span className="pf-acts">
      {a.map((x) => x.ext
        ? <a key={x.label} href={x.href} target="_blank" rel="noopener noreferrer">{x.label} ↗</a>
        : <Link key={x.label} href={x.href}>{x.label}</Link>)}
    </span>
  );
}
