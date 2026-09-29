import { isAdmin } from "@/lib/admin";
import { sameOrigin } from "@/lib/auth/session";
import { sql, ensureSchema } from "@/lib/db";
import { getSnapshot } from "@/lib/snapshot";
import { draftSignal, getIssue, asThread, type SignalData } from "@/lib/signal";
import { send, esc, hasBot, SITE } from "@/lib/telegram";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const clean = (x: unknown, max: number) => String(x ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/**
 * The weekly Dawns Signal, admins only:
 * { action: "draft" } remakes this week's draft from today's data · { action: "save", id, data } ·
 * { action: "publish", id } · { action: "unpublish", id } · { action: "telegram", id } posts it to the channel.
 */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return Response.json({ error: "Bad origin" }, { status: 403 });
  if (!(await isAdmin())) return Response.json({ error: "Not found" }, { status: 404 });
  await ensureSchema();
  const b = (await req.json().catch(() => ({}))) as { action?: string; id?: string; data?: Partial<SignalData> };
  const q = sql();
  if (b.action === "draft") return Response.json({ result: await draftSignal(await getSnapshot(), true) });
  const issue = b.id ? await getIssue(b.id) : null;
  if (!issue) return Response.json({ error: "No such issue." }, { status: 404 });
  if (b.action === "save") {
    const d = b.data ?? {};
    const items = (Array.isArray(d.items) ? d.items : []).slice(0, 7).map((x, i) => ({
      key: clean(x?.key, 80) || `item-${i}`, head: clean(x?.head, 140), line: clean(x?.line, 400),
      href: typeof x?.href === "string" && x.href.startsWith("/") ? x.href.slice(0, 200) : null,
      tone: ["up", "down", "warn", "calm"].includes(String(x?.tone)) ? x!.tone! : "calm",
    })).filter((x) => x.head);
    const data: SignalData = { ...issue.data, title: clean(d.title, 120) || issue.data.title, intro: clean(d.intro, 400), items };
    await q.query("update signal_issues set data = $2::jsonb, updated_at = now() where id = $1", [issue.id, JSON.stringify(data)]);
    return Response.json({ ok: true });
  }
  if (b.action === "publish" || b.action === "unpublish") {
    await q.query("update signal_issues set status = $2, published_at = case when $2 = 'published' then coalesce(published_at, now()) else published_at end, updated_at = now() where id = $1",
      [issue.id, b.action === "publish" ? "published" : "draft"]);
    return Response.json({ ok: true });
  }
  if (b.action === "telegram") {
    const channel = process.env.TELEGRAM_CHANNEL_ID;
    if (!hasBot() || !channel) return Response.json({ error: "TELEGRAM_BOT_TOKEN or TELEGRAM_CHANNEL_ID is not set." }, { status: 400 });
    if (issue.status !== "published") return Response.json({ error: "Publish it first." }, { status: 400 });
    const d = issue.data;
    const html = [`<b>${esc(d.title)}</b>`, esc(d.intro), ...d.items.map((x, i) => `<b>${String(i + 1).padStart(2, "0")} · ${esc(x.head)}</b>\n${esc(x.line)}${x.href ? `\n${SITE}${x.href}` : ""}`), `<a href="${SITE}/signal/${d.week}">Read the full Signal on dawns</a>\n<i>Research, not advice.</i>`].join("\n\n");
    await send(channel, html);
    await q.query("update signal_issues set telegram_at = now() where id = $1", [issue.id]);
    return Response.json({ ok: true });
  }
  if (b.action === "thread") return Response.json({ thread: asThread(issue.data, SITE) });
  return Response.json({ error: "Unknown action." }, { status: 400 });
}
