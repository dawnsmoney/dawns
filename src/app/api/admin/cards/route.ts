import { isAdmin } from "@/lib/admin";
import { sameOrigin } from "@/lib/auth/session";
import { sql, ensureSchema } from "@/lib/db";
import { getSnapshot } from "@/lib/snapshot";
import { getDraft, makeCard, type CardKind } from "@/lib/cards";
import { renderCard } from "@/lib/card-image";
import { sendPhoto, hasBot, SITE } from "@/lib/telegram";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const STATUSES = ["draft", "approved", "skipped"] as const;

/**
 * Card actions, admins only:
 * { action: "create", kind, ref } · { action: "text", id, reading } · { action: "status", id, status } · { action: "telegram", id }
 */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return Response.json({ error: "Bad origin" }, { status: 403 });
  if (!(await isAdmin())) return Response.json({ error: "Not found" }, { status: 404 });
  await ensureSchema();
  const b = (await req.json().catch(() => ({}))) as { action?: string; id?: string; kind?: string; ref?: string; reading?: string; status?: string };
  const q = sql();

  if (b.action === "create") {
    const kind = b.kind === "asset" || b.kind === "opp" || b.kind === "count" || b.kind === "week" ? (b.kind as CardKind) : null;
    if (!kind || ((kind === "asset" || kind === "opp") && !b.ref)) return Response.json({ error: "Pick an asset or opportunity." }, { status: 400 });
    const id = await makeCard(kind, b.ref ?? "", await getSnapshot());
    return id ? Response.json({ id }) : Response.json({ error: kind === "week" ? "Intelligence needs a few more days of readings." : "Not found in today's data." }, { status: 404 });
  }

  const d = b.id ? await getDraft(b.id) : null;
  if (!d) return Response.json({ error: "No such card." }, { status: 404 });

  if (b.action === "text") {
    const reading = String(b.reading ?? "").replace(/\s+/g, " ").trim().slice(0, 320);
    if (!reading) return Response.json({ error: "The reading can't be empty." }, { status: 400 });
    await q.query("update card_drafts set reading = $2, updated_at = now() where id = $1", [d.id, reading]);
    return Response.json({ ok: true });
  }
  if (b.action === "status") {
    const st = STATUSES.find((x) => x === b.status);
    if (!st) return Response.json({ error: "Unknown status." }, { status: 400 });
    await q.query("update card_drafts set status = $2, updated_at = now() where id = $1", [d.id, st]);
    return Response.json({ ok: true });
  }
  if (b.action === "telegram") {
    const channel = process.env.TELEGRAM_CHANNEL_ID;
    if (!hasBot() || !channel) return Response.json({ error: "TELEGRAM_BOT_TOKEN or TELEGRAM_CHANNEL_ID is not set." }, { status: 400 });
    if (d.status !== "approved" && d.status !== "sent") return Response.json({ error: "Approve the card first." }, { status: 400 });
    const url = `${SITE}${d.data.path}`;
    const caption = d.data.caption
      ? d.data.caption.replace("{reading}", d.reading).replace("{url}", url)
      : `${d.data.title}\n\n${d.reading}\n\n${url}\nResearch, not advice.`;
    try {
      const png = await (await renderCard(d.data, d.reading)).blob();
      await sendPhoto(channel, png, caption);
    } catch (e) {
      console.error("card telegram", d.id, e);
      return Response.json({ error: `Couldn't post: ${(e as Error).message}` }, { status: 502 });
    }
    await q.query("update card_drafts set status = 'sent', sent_at = now(), updated_at = now() where id = $1", [d.id]);
    return Response.json({ ok: true });
  }
  return Response.json({ error: "Unknown action." }, { status: 400 });
}
