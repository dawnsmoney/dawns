import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Banner } from "@/components/Banner";
import { SignalEditor, SignalDraftButton } from "@/components/signal-editor";
import { isAdmin } from "@/lib/admin";
import { listIssues } from "@/lib/signal";
import { hasBot, SITE } from "@/lib/telegram";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Signal", robots: { index: false, follow: false } };

/** The weekly Dawns Signal: this week's draft to edit and publish, then the issues before it. */
export default async function SignalAdmin() {
  if (!(await isAdmin())) notFound();
  const issues = await listIssues(false, 8);
  const canTelegram = hasBot() && !!process.env.TELEGRAM_CHANNEL_ID;
  const [cur, ...past] = issues;
  return (
    <>
      <Banner short crumb={[{ href: "/admin", label: "Admin" }, { label: "Signal" }]} title="The Dawns Signal" lede="Drafted every Monday from dawns' own records: the heaviest measured changes of the week. Reword, reorder or drop items, then publish to /signal, post to Telegram, and copy the X thread." />
      <div className="wrap" style={{ paddingTop: 32, display: "grid", gap: 20 }}>
        <div><SignalDraftButton /></div>
        {cur ? (
          <div className="card" style={{ display: "grid", gap: 12 }}>
            <div className="c-head"><h3>{cur.id}</h3><span className="tag">{cur.status}{cur.telegram_at ? " · on Telegram" : ""}</span>{cur.status === "published" && <Link href={`/signal/${cur.id}`}>View ↗</Link>}</div>
            <SignalEditor id={cur.id} data={cur.data} status={cur.status} telegramAt={cur.telegram_at} site={SITE} canTelegram={canTelegram} />
          </div>
        ) : <p className="muted">No issue yet: draft this week above.</p>}
        {past.map((x) => <div key={x.id} className="card"><div className="c-head"><h3>{x.id}</h3><span className="tag">{x.status}</span>{x.status === "published" && <Link href={`/signal/${x.id}`}>View ↗</Link>}</div></div>)}
      </div>
    </>
  );
}
