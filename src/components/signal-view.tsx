import Link from "next/link";
import type { SignalIssue } from "@/lib/signal";
import { Share } from "./share";

const TONE = { up: "#199e70", down: "#e66767", warn: "#FFC061", calm: "#8578E6" } as const;

/** One issue of the Dawns Signal: five numbered changes, each linking to the reading behind it. */
export function SignalView({ issue, archive }: { issue: SignalIssue; archive: { id: string; title: string }[] }) {
  const d = issue.data;
  const text = `${d.title}\n\n${d.items.slice(0, 3).map((x, i) => `${String(i + 1).padStart(2, "0")} · ${x.head}`).join("\n")}`;
  return (
    <div style={{ display: "grid", gap: 18 }}>
      <div className="share-row"><span className="muted">{d.intro} Published {new Date(issue.published_at ?? issue.created_at).toISOString().slice(0, 10)}.</span><Share path={`/signal/${d.week}`} text={text} /></div>
      <ol className="sig-list">
        {d.items.map((x, i) => (
          <li key={x.key} style={{ ["--tone" as string]: TONE[x.tone] }}>
            <span className="sig-n">{String(i + 1).padStart(2, "0")}</span>
            <div><b>{x.head}</b><p>{x.line}</p>{x.href && <Link href={x.href}>Read the full intelligence →</Link>}</div>
          </li>
        ))}
      </ol>
      <p className="muted" style={{ fontSize: 13, margin: 0 }}>Every figure is read on-chain by dawns, with how it was calculated on the page it links to. Research, not advice.</p>
      {archive.length > 1 && <div className="sig-arch"><span className="eyebrow muted">Earlier issues</span>{archive.filter((a) => a.id !== issue.id).map((a) => <Link key={a.id} href={`/signal/${a.id}`}>{a.title}</Link>)}</div>}
    </div>
  );
}
