import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Banner } from "@/components/Banner";
import { CardMaker, CardDraftView, type StudioDraft } from "@/components/card-studio";
import { isAdmin } from "@/lib/admin";
import { ensureSchema } from "@/lib/db";
import { recentDrafts } from "@/lib/cards";
import { getSnapshot } from "@/lib/snapshot";
import { getAssets } from "@/lib/assets";
import { significant } from "@/lib/assets/view";
import { CHAIN_NAME, STANDARD_NAME } from "@/lib/assets/types";
import { hasBot } from "@/lib/telegram";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Share cards", robots: { index: false, follow: false } };

const dayLabel = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" });

export default async function CardsPage() {
  if (!(await isAdmin())) notFound();
  await ensureSchema();
  const [drafts, s, assets] = await Promise.all([recentDrafts(7), getSnapshot(), getAssets()]);
  const flow = (v7: number | null | undefined, v24: number | null | undefined) => Math.max(v7 ?? 0, (v24 ?? 0) * 7);
  const assetOpts = assets.filter(significant).sort((a, b) => flow(b.vol7, b.vol24) - flow(a.vol7, a.vol24)).slice(0, 400)
    .map((a) => ({ id: a.id, label: `${a.symbol} · ${STANDARD_NAME[a.standard]} · ${CHAIN_NAME[a.chain]}` }));
  const oppOpts = s.opportunities.map((o) => ({ id: o.id, label: `${o.name} · ${o.pname}` }));
  const canTelegram = hasBot() && !!process.env.TELEGRAM_CHANNEL_ID;

  const view: StudioDraft[] = drafts.map((d) => ({
    id: d.id, day: d.day, kind: d.kind, title: d.data.title, sub: d.data.sub, reading: d.reading, status: d.status, origin: d.origin,
    v: String(new Date(d.updated_at).getTime()), path: d.data.path, caption: d.data.caption ?? null,
  }));
  const days = [...new Set(view.map((d) => d.day))];

  return (
    <>
      <Banner short crumb={[{ href: "/admin", label: "Admin" }, { label: "Share cards" }]} title="Share cards"
        lede="Each morning after 07:00 dawns drafts cards by a fixed rule: the 3 most-traded assets over 7 days not featured in the last week, the largest, highest-yield and one flagged opportunity, on Mondays the weekly count and on Thursdays this week in Kaspa capital. Numbers are frozen when drafted. Nothing is posted until you approve it." />
      <div className="wrap" style={{ paddingTop: 40, display: "grid", gap: 24 }}>
        <CardMaker assets={assetOpts} opps={oppOpts} />
        {!days.length && <div className="card"><p className="muted" style={{ margin: 0 }}>No cards yet. The first daily drafts appear after the next run past 07:00 Athens time, or make one above.</p></div>}
        {days.map((day) => (
          <section key={day} style={{ display: "grid", gap: 16 }}>
            <h2 style={{ font: "600 22px var(--display)", margin: "8px 0 0" }}>{dayLabel(day)}</h2>
            <div className="grid g2">
              {view.filter((d) => d.day === day).map((d) => <CardDraftView key={d.id} d={d} canTelegram={canTelegram} />)}
            </div>
          </section>
        ))}
        <p className="muted" style={{ fontSize: 13.5 }}>Cards and their images are visible to admin wallets only. <Link href="/admin">Back to admin</Link></p>
      </div>
    </>
  );
}
