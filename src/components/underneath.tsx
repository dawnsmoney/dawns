import Link from "next/link";
import { Pill } from "./bits";
import { SplitBar, CopyId } from "./viz";
import { usd } from "@/lib/format";
import { KIND_LABEL, type Receipt } from "@/lib/underneath";

/** Look-through: what one token is a claim on, what backs it, and the way back to the assets. */
export function Underneath({ r, head = true }: { r: Receipt; head?: boolean }) {
  return (
    <div className="card under">
      {head && <div className="c-head"><h3>Underneath</h3><span className="tag">{KIND_LABEL[r.kind]}</span></div>}
      <p className="under-claim">{r.claim}</p>
      <div className="under-per"><b>{r.per}</b>{(r.size != null || r.sizeNote) && <span className="muted">{r.size != null ? `${usd(r.size)} behind all of it` : r.sizeNote}</span>}</div>
      <div className="eyebrow muted" style={{ margin: "18px 0 10px" }}>{r.partsLabel}</div>
      <SplitBar label={r.partsLabel} parts={r.parts} height={28} />
      <dl className="under-facts">{r.facts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      {r.flags.length > 0 && <ul className="findings" style={{ marginTop: 14 }}>{r.flags.map(([t, f]) => <li key={f}><Pill t={t}>{t === "crit" ? "High" : t === "warn" ? "Watch" : t === "good" ? "OK" : "Note"}</Pill> {f}</li>)}</ul>}
      <div className="under-exit"><span className="eyebrow muted">Getting the assets back</span><p>{r.exit}</p></div>
      {r.issuer && <small className="muted">Issued by <Link href={r.issuer.href}>{r.issuer.name}</Link> · {r.chain}</small>}
    </div>
  );
}

/** Contract line for a receipt's own page. */
export function ReceiptId({ r }: { r: Receipt }) {
  return <div className="under-id"><span className="muted">{r.kind === "vault" ? "Share token id" : "Contract"}</span><CopyId text={r.address} /></div>;
}

/** A compact row for lists: symbol, kind, the split in one bar, size. */
export function ReceiptRow({ r }: { r: Receipt }) {
  return (
    <Link href={r.href} className="rc-row">
      <span className="rc-n"><b>{r.symbol}</b><small>{KIND_LABEL[r.kind]} · {r.issuer?.name ?? r.chain}</small></span>
      <span className="rc-bar" title={r.parts.map((p) => `${p.label} ${Math.round(p.share * 100)}%`).join(" · ")}>{r.parts.map((p) => <i key={p.key} style={{ flexGrow: Math.max(p.share, 0.001), background: p.color }} />)}</span>
      <span className="rc-v"><b>{r.size != null ? usd(r.size) : r.sizeNote?.split(" · ")[0] ?? "—"}</b><small>{Math.round(r.parts[0].share * 100)}% {r.parts[0].label.toLowerCase()}</small></span>
    </Link>
  );
}
