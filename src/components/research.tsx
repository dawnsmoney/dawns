import type { ReactNode } from "react";

/**
 * Research-style building blocks: every figure says how it is valued and where
 * it came from. Only what dawns itself read from the chain is stamped
 * "Verified on-chain"; an indexer's or a market's number says whose it is.
 */
export type Stamp = { kind: "onchain" | "indexed" | "reported"; by: string; at: number | null };

const day = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace("T", " ") + " UTC";

export function StampLine({ s }: { s: Stamp }) {
  const label = s.kind === "onchain" ? "Verified on-chain" : s.kind === "indexed" ? `Indexed by ${s.by}` : `Reported by ${s.by}`;
  return (
    <span className={`stamp ${s.kind}`}>
      <i aria-hidden>{s.kind === "onchain" ? "✓" : s.kind === "indexed" ? "≡" : "↗"}</i>
      {label}{s.kind === "onchain" && s.by ? ` · ${s.by}` : ""}{s.at ? ` · ${day(s.at)}` : ""}
    </span>
  );
}

/** How a figure is valued: one line, its sources, and the stamp. Folded until asked. */
export function Basis({ text, sources, stamp, open }: { text: ReactNode; sources?: [string, string][]; stamp: Stamp; open?: boolean }) {
  return (
    <details className="basis" open={open}>
      <summary><span aria-hidden>ⓘ</span> How it&apos;s valued</summary>
      <div>
        <p>{text}</p>
        {sources && sources.length > 0 && (
          <ul>{sources.map(([l, u]) => <li key={u + l}>{u.startsWith("http") ? <a href={u} target="_blank" rel="noopener noreferrer">{l}</a> : <span>{l}</span>}</li>)}</ul>
        )}
        <StampLine s={stamp} />
      </div>
    </details>
  );
}

export function KeyFigure({ label, value, sub, tone, basis }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "up" | "down"; basis?: ReactNode }) {
  return (
    <div className="kf">
      <span className="eyebrow muted">{label}</span>
      <b className={tone}>{value}</b>
      {sub && <small>{sub}</small>}
      {basis}
    </div>
  );
}

/** A research header: coin, name, what it is in one line, tags, then four key figures. */
export function ResearchHead({ coin, title, subtitle, line, tags, figures }: { coin: ReactNode; title: ReactNode; subtitle?: ReactNode; line: ReactNode; tags: ReactNode; figures: ReactNode }) {
  return (
    <div className="card rh">
      <div className="rh-top">
        {coin}
        <div className="rh-id">
          <h2>{title}</h2>
          {subtitle && <span className="muted">{subtitle}</span>}
        </div>
      </div>
      <p className="rh-line">{line}</p>
      <div className="rh-tags">{tags}</div>
      <div className="rh-figs">{figures}</div>
    </div>
  );
}

const shortId = (id: string) => { const b = id.replace(/^kaspa(test)?:/, ""); return `${b.slice(0, 6)}…${b.slice(-6)}`; };

/** A vault's family of tokens and coins: what each is, how much, and its id. */
export interface FamilyRow { letter: string; color: string; name: string; role: string; amount: string; id?: string | null; href?: string | null; main?: boolean }
export function TokenFamily({ rows, caption }: { rows: FamilyRow[]; caption: string }) {
  return (
    <div className="tf">
      <span className="eyebrow muted">{caption}</span>
      {rows.map((r) => (
        <div key={r.name} className={`tf-row${r.main ? " main" : ""}`}>
          <i style={{ background: r.color }} aria-hidden>{r.letter}</i>
          <span className="tf-n"><b>{r.name}{r.main && <em>main</em>}</b><small>{r.role}</small></span>
          <b className="tf-a">{r.amount}</b>
          {r.id ? (r.href ? <a className="mono tf-id" href={r.href} target="_blank" rel="noopener noreferrer" title={r.id}>{shortId(r.id)} ↗</a> : <span className="mono tf-id" title={r.id}>{shortId(r.id)}</span>) : <span className="tf-id" />}
        </div>
      ))}
    </div>
  );
}
