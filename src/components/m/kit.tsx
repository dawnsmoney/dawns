import Link from "next/link";
import { Pill } from "../bits";
import type { Status } from "@/lib/types";

/* Building blocks of the phone screens. Server-safe: no hooks. */

export function MHead({ eyebrow, title, sub, right, back, clamp }: { eyebrow?: React.ReactNode; title: React.ReactNode; sub?: React.ReactNode; right?: React.ReactNode; back?: { href: string; label: string }; clamp?: boolean }) {
  return (
    <div className="m-head">
      {back && <Link href={back.href} className="m-back">‹ {back.label}</Link>}
      <div className="m-head-row">
        <div style={{ minWidth: 0 }}>
          {eyebrow && <span className="m-eyebrow">{eyebrow}</span>}
          <h1>{title}</h1>
        </div>
        {right}
      </div>
      {sub && (clamp ? <details className="m-clamp"><summary><p className="m-sub">{sub}</p></summary></details> : <p className="m-sub">{sub}</p>)}
    </div>
  );
}

/** One number that answers the screen's question. */
export function MHero({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: Status }) {
  return (
    <div className={`m-hero ${tone ? `t-${tone}` : ""}`}>
      <span>{label}</span>
      <b>{value}</b>
      {sub && <small>{sub}</small>}
    </div>
  );
}

export function MStats({ items }: { items: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: Status }[] }) {
  return (
    <div className="m-stats">
      {items.map((x) => (
        <div key={x.label} className={x.tone ? `t-${x.tone}` : undefined}><span>{x.label}</span><b>{x.value}</b>{x.sub && <small>{x.sub}</small>}</div>
      ))}
    </div>
  );
}

export function MCard({ title, tag, children, flush }: { title?: React.ReactNode; tag?: React.ReactNode; children: React.ReactNode; flush?: boolean }) {
  return (
    <section className={`m-card ${flush ? "flush" : ""}`}>
      {(title || tag) && <div className="m-card-h">{title && <h2>{title}</h2>}{tag && <span className="m-tag">{tag}</span>}</div>}
      {children}
    </section>
  );
}

/** A tappable list row: what it is on the left, the figure that matters on the right. */
export function MRow({ href, icon, title, sub, value, valueSub, pill, ext }: {
  href?: string; icon?: React.ReactNode; title: React.ReactNode; sub?: React.ReactNode; value?: React.ReactNode; valueSub?: React.ReactNode; pill?: { t: Status; text: string }; ext?: boolean;
}) {
  const body = (
    <>
      {icon && <span className="m-row-i">{icon}</span>}
      <span className="m-row-t"><b>{title}</b>{sub && <small>{sub}</small>}{pill && <span className="m-row-p"><Pill t={pill.t}>{pill.text}</Pill></span>}</span>
      {(value != null || valueSub) && <span className="m-row-v"><b>{value}</b>{valueSub && <small>{valueSub}</small>}</span>}
      {href && <i className="m-chev" aria-hidden>›</i>}
    </>
  );
  if (!href) return <div className="m-row">{body}</div>;
  if (ext) return <a className="m-row" href={href} target="_blank" rel="noopener noreferrer">{body}</a>;
  return <Link className="m-row" href={href}>{body}</Link>;
}

export function MList({ children }: { children: React.ReactNode }) {
  return <div className="m-list">{children}</div>;
}

/** Label and value on one line, for facts. */
export function MKv({ rows }: { rows: [React.ReactNode, React.ReactNode][] }) {
  return <dl className="m-kv">{rows.map(([k, v], i) => <div key={i}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>;
}

export function MNote({ children }: { children: React.ReactNode }) {
  return <p className="m-note">{children}</p>;
}

/** A flag line: status by colour and by word. */
export function MFlags({ flags }: { flags: [Status, string][] }) {
  if (!flags.length) return null;
  return (
    <ul className="m-flags">
      {flags.map(([t, text]) => <li key={text} className={t}><i aria-hidden>{t === "good" ? "✓" : t === "crit" ? "✕" : t === "warn" ? "!" : "i"}</i><span>{text}</span></li>)}
    </ul>
  );
}

export function MLinkButton({ href, children, kind = "primary" }: { href: string; children: React.ReactNode; kind?: "primary" | "ghost" }) {
  return <Link href={href} className={`m-btn ${kind}`}>{children}</Link>;
}
