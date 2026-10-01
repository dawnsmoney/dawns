import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { Banner } from "@/components/Banner";
import { JournalRun } from "@/components/journal-run";
import { isAdmin } from "@/lib/admin";
import { entries, book, BOOK, type Entry, type Position } from "@/lib/journal";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Journal", robots: { index: false, follow: false } };

const pct = (x: number | null | undefined, d = 2) => (x == null ? "—" : `${(x * 100).toFixed(d)}%`);
const units = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(2)}`;

/** Inline **bold** and `code`, nothing else. */
function inline(t: string): ReactNode[] {
  return t.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean).map((p, i) =>
    p.startsWith("**") ? <b key={i}>{p.slice(2, -2)}</b> : p.startsWith("`") ? <code key={i}>{p.slice(1, -1)}</code> : p);
}
/** The brief's small markdown: paragraphs, "- " bullets and "#" headings. */
function Brief({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => { if (list.length) { blocks.push(<ul key={blocks.length} style={{ margin: "0 0 8px", paddingLeft: 20 }}>{list.map((l, i) => <li key={i}>{inline(l)}</li>)}</ul>); list = []; } };
  for (const raw of text.split("\n")) {
    const l = raw.trim();
    if (/^[-*] /.test(l)) { list.push(l.slice(2)); continue; }
    flush();
    if (!l) continue;
    if (l.startsWith("#")) blocks.push(<b key={blocks.length} style={{ display: "block", margin: "8px 0 4px" }}>{inline(l.replace(/^#+\s*/, ""))}</b>);
    else blocks.push(<p key={blocks.length} style={{ margin: "0 0 8px" }}>{inline(l)}</p>);
  }
  flush();
  return <div style={{ fontSize: 15, lineHeight: 1.5 }}>{blocks}</div>;
}

function Book({ ps }: { ps: Position[] }) {
  if (!ps.length) return <p className="muted" style={{ margin: 0 }}>No paper positions yet.</p>;
  return (
    <div className="tbl-wrap">
      <table className="prf-tbl" style={{ width: "100%", fontSize: 14 }}>
        <thead><tr><th>Opened</th><th>Idea</th><th>Market</th><th>Size</th><th>Days</th><th>Expected</th><th>Last yield</th><th>Return</th><th>Units</th><th>Status</th></tr></thead>
        <tbody>
          {ps.map((p) => (
            <tr key={p.idea.id}>
              <td className="mono">{p.idea.day}</td>
              <td>{p.idea.title}</td>
              <td className="mono" style={{ fontSize: 12.5 }}>{p.idea.oppId}</td>
              <td>{p.idea.sizePct}%</td>
              <td>{p.days} / {p.idea.horizonDays}{p.missingDays ? <small className="muted"> · {p.missingDays} unread</small> : null}</td>
              <td>{pct(p.idea.expectedApy, 1)}</td>
              <td>{pct(p.lastApy, 1)}</td>
              <td>{pct(p.ret, 3)}</td>
              <td style={{ color: p.pnl >= 0 ? "var(--good, #2bb673)" : "var(--bad, #e5484d)" }}>{units(p.pnl)}</td>
              <td>{p.status === "open" ? "Open" : <span title={p.closeReason ?? ""}>Closed {p.closedOn}</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Day({ e, ps }: { e: Entry; ps: Position[] }) {
  const title = (id: string) => ps.find((p) => p.idea.id === id)?.idea.title ?? id;
  return (
    <div className="card" style={{ display: "grid", gap: 14 }}>
      <div className="c-head"><h3>{new Date(`${e.day}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" })}</h3>
        <span className="tag">{e.error ? "error" : e.brief == null ? "writing" : `${e.ideas.length} idea${e.ideas.length === 1 ? "" : "s"}`}</span></div>
      {e.error && <p style={{ margin: 0, color: "var(--bad, #e5484d)" }}>{e.error}</p>}
      {e.brief && <Brief text={e.brief} />}
      {e.ideas.map((i) => (
        <div key={i.id} style={{ borderLeft: "3px solid var(--line, #3a3066)", paddingLeft: 14, display: "grid", gap: 6 }}>
          <b>{i.action === "paper_enter" ? "Paper position" : "Watch"} · {i.title}</b>
          <small className="muted mono">{i.oppId ?? "no market"} · {i.action === "paper_enter" ? `${i.sizePct}% of the book · ${i.horizonDays} days · expected ${pct(i.expectedApy, 1)} · cost ${i.costBps} bps · ` : ""}{i.confidence} confidence</small>
          <p style={{ margin: 0 }}>{i.thesis}</p>
          <small><b>Exit if:</b> {i.exitIf}</small>
          {i.risks.length > 0 && <small><b>Risks:</b> {i.risks.join(" · ")}</small>}
        </div>
      ))}
      {(e.reviews.length > 0 || e.closes.length > 0) && (
        <div style={{ display: "grid", gap: 4, fontSize: 14 }}>
          {e.closes.map((c) => <span key={`c${c.ideaId}`}><b>Closed</b> {title(c.ideaId)}: {c.reason}</span>)}
          {e.reviews.map((r) => <span key={`r${r.ideaId}`} className="muted"><b>Review</b> {title(r.ideaId)}: {r.note}</span>)}
        </div>
      )}
      {e.usage && <small className="muted mono">{e.model} · {e.usage.input_tokens ?? 0} in / {e.usage.output_tokens ?? 0} out tokens</small>}
    </div>
  );
}

/** Claude's daily paper journal: a brief, up to three ideas, and a paper book that earns recorded native yield. */
export default async function JournalPage() {
  if (!(await isAdmin())) notFound();
  const es = await entries(60);
  const ps = book(es);
  const closed = ps.filter((p) => p.status === "closed");
  const total = ps.reduce((a, p) => a + p.pnl, 0);
  const wins = closed.filter((p) => p.pnl > 0).length;
  const hasToday = es.some((e) => e.day === new Date().toISOString().slice(0, 10));
  return (
    <>
      <Banner short crumb={[{ href: "/admin", label: "Admin" }, { label: "Journal" }]} title="Paper journal"
        lede={`Every morning Claude reads dawns' own data and writes a brief and up to three ideas. Paper positions sit in a ${BOOK.toLocaleString("en-US")}-unit book and earn each day's recorded native yield, less estimated costs. Price moves are not counted, and no money moves.`} />
      <div className="wrap" style={{ paddingTop: 32, display: "grid", gap: 20 }}>
        <JournalRun hasToday={hasToday} />
        <div className="grid g2" style={{ margin: 0 }}>
          <div className="card"><span className="eyebrow muted">Paper result</span><b style={{ display: "block", font: "600 28px var(--display)", margin: "6px 0 2px" }}>{units(total)} units</b><span className="muted" style={{ fontSize: 13.5 }}>{pct(total / BOOK, 3)} of the book · {ps.length - closed.length} open · {closed.length} closed</span></div>
          <div className="card"><span className="eyebrow muted">Closed positions</span><b style={{ display: "block", font: "600 28px var(--display)", margin: "6px 0 2px" }}>{closed.length ? `${wins} of ${closed.length} positive` : "—"}</b><span className="muted" style={{ fontSize: 13.5 }}>{es.length} entries · {es.reduce((a, e) => a + e.ideas.length, 0)} ideas</span></div>
        </div>
        <div className="card" style={{ display: "grid", gap: 12 }}><div className="c-head"><h3>The book</h3></div><Book ps={ps} /></div>
        {!es.length && <p className="muted">No entries yet. The first one is written on the next run after 06:00 UTC, or now with the button above.</p>}
        {es.map((e) => <Day key={e.day} e={e} ps={ps} />)}
      </div>
    </>
  );
}
