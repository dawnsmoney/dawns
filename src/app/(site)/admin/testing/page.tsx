import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Banner } from "@/components/Banner";
import { FeedbackReview } from "@/components/feedback-review";
import { isAdmin } from "@/lib/admin";
import { sql, ensureSchema } from "@/lib/db";
import { funnel, STEPS } from "@/lib/testing";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Testing", robots: { index: false, follow: false } };

type F = { id: string; kind: string; path: string | null; text: string | null; answers: Record<string, string> | null; contact: string | null; device: string | null; status: string; note: string | null; created_at: string; by: string | null };
const when = (t: string) => new Date(t).toISOString().slice(0, 16).replace("T", " ");
const short = (a: string | null) => (a ? `${a.slice(0, 14)}…${a.slice(-5)}` : "anonymous");
const KIND: Record<string, string> = { bug: "Broke", confusing: "Confusing", idea: "Idea" };
const SAFE: Record<string, string> = { clear: "Yes, clearly", partly: "Partly", no: "No" };
const MAIN: Record<string, string> = { yes: "Yes", "not-yet": "Not yet", no: "No" };

/** Testers: how far they get, what they report, what they answer. */
export default async function TestingAdmin() {
  if (!(await isAdmin())) notFound();
  await ensureSchema();
  const q = sql();
  const by = "(select address from wallets w where w.user_id = f.user_id order by created_at limit 1) as by";
  const [fun, reports, surveys] = await Promise.all([
    funnel(),
    q.query(`select f.*, ${by} from feedback f where kind <> 'survey' order by (status = 'new') desc, created_at desc limit 100`) as unknown as Promise<F[]>,
    q.query(`select f.*, ${by} from feedback f where kind = 'survey' order by created_at desc limit 100`) as unknown as Promise<F[]>,
  ]);
  const tally = (k: string, v: string) => surveys.filter((s) => s.answers?.[k] === v).length;
  const top = Math.max(1, fun.visitors, ...Object.values(fun.counts));
  const open = reports.filter((r) => r.status === "new").length;
  return (
    <>
      <Banner short crumb={[{ href: "/admin", label: "Admin" }, { label: "Testing" }]} title="Testers" lede="How far people get on /test, what they report, and what they answer. Confirming a report pays its signed-in reporter 500 points once." />
      <div className="wrap" style={{ paddingTop: 32, display: "grid", gap: 20 }}>
        <div className="card">
          <div className="c-head"><h3>The funnel</h3><span className="tag">accounts at each step, all time</span></div>
          <div className="adm-fun">
            <div><span>Opened /test</span><i style={{ width: `${(fun.visitors / top) * 100}%` }} /><b>{fun.visitors}</b></div>
            {STEPS.map((s) => <div key={s.key}><span>{s.title}</span><i style={{ width: `${(fun.counts[s.key] / top) * 100}%` }} /><b>{fun.counts[s.key]}</b></div>)}
          </div>
          <p className="foot" style={{ marginBottom: 0 }}>Opened /test counts browsers per day (the visitor id resets daily), so it runs high. Steps count accounts with a Kaspa wallet, whether they came through /test or not.</p>
        </div>

        <div className="card">
          <div className="c-head"><h3>Answers</h3><span className="tag">{surveys.length} testers</span></div>
          {surveys.length > 0 && (
            <div className="depth-top depth-4" style={{ margin: "0 0 14px" }}>
              <div><span className="eyebrow muted">Could tell what&apos;s safe</span><b>{tally("safe", "clear")} · {tally("safe", "partly")} · {tally("safe", "no")}</b><small>clearly · partly · no</small></div>
              <div><span className="eyebrow muted">Would use on mainnet</span><b>{tally("mainnet", "yes")} · {tally("mainnet", "not-yet")} · {tally("mainnet", "no")}</b><small>yes · not yet · no</small></div>
            </div>
          )}
          <div className="adm-list">
            {surveys.map((s) => (
              <div key={s.id} className="adm-item">
                <small className="muted">{when(s.created_at)} · <span className="mono">{short(s.by)}</span></small>
                <p><b>Safe?</b> {SAFE[s.answers?.safe ?? ""] ?? "—"}{s.answers?.safeWhy ? ` · ${s.answers.safeWhy}` : ""}</p>
                {s.answers?.stuck && <p><b>Stuck:</b> {s.answers.stuck}</p>}
                <p><b>Mainnet?</b> {MAIN[s.answers?.mainnet ?? ""] ?? "—"}{s.answers?.mainnetWhy ? ` · ${s.answers.mainnetWhy}` : ""}</p>
              </div>
            ))}
            {!surveys.length && <p className="muted">No answers yet.</p>}
          </div>
        </div>

        <div className="card">
          <div className="c-head"><h3>Reports</h3><span className="tag">{open} new</span></div>
          <div className="adm-list">
            {reports.map((r) => (
              <div key={r.id} className="adm-item">
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}><span className="tag">{KIND[r.kind] ?? r.kind}</span><span className="tag">{r.status}</span><small className="muted">{when(r.created_at)} · {r.path ?? "—"} · <span className="mono">{r.by ? short(r.by) : r.contact ? `anonymous, reply to ${r.contact}` : "anonymous"}</span></small></div>
                <p style={{ whiteSpace: "pre-wrap" }}>{r.text}</p>
                <small className="muted">{r.device}</small>
                {r.note && <small>Note: {r.note}</small>}
                <FeedbackReview id={r.id} status={r.status} />
              </div>
            ))}
            {!reports.length && <p className="muted">No reports yet.</p>}
          </div>
        </div>
      </div>
    </>
  );
}
