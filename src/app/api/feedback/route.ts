import { currentUser, sameOrigin } from "@/lib/auth/session";
import { sql, hasDb, ensureSchema } from "@/lib/db";
import { visitorId } from "@/lib/visitor";
import { award } from "@/lib/pioneer";

export const dynamic = "force-dynamic";

const clean = (x: unknown, max: number) => String(x ?? "").replace(/[ \t]+/g, " ").trim().slice(0, max);
const KINDS = new Set(["bug", "confusing", "idea", "survey"]);
const CHOICES: Record<string, string[]> = { safe: ["clear", "partly", "no"], mainnet: ["yes", "not-yet", "no"] };

/**
 * "Report a problem" and the tester survey. Anyone can report (signed-in reports can
 * earn points once confirmed); the page, device and account ride along so a report
 * needs no back-and-forth.
 */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return Response.json({ error: "Bad origin" }, { status: 403 });
  if (!hasDb()) return Response.json({ error: "Not available here." }, { status: 503 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const kind = String(b.kind ?? "");
  if (!KINDS.has(kind)) return Response.json({ error: "Pick what kind of report this is." }, { status: 400 });
  const u = await currentUser().catch(() => null);
  const vid = visitorId(req);
  await ensureSchema();
  const q = sql();
  const recent = ((await q.query("select count(*)::int as n from feedback where created_at > now() - interval '1 day' and (vid = $1 or ($2::text is not null and user_id = $2))", [vid, u?.id ?? null])) as { n: number }[])[0]?.n ?? 0;
  if (recent >= 15) return Response.json({ error: "That's a lot of reports for one day: thank you. Send the rest tomorrow, or in Telegram." }, { status: 429 });
  const id = `fb_${[...crypto.getRandomValues(new Uint8Array(8))].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
  const path = clean(b.path, 200) || null;
  const device = clean(b.device, 200) || clean(req.headers.get("user-agent"), 200);
  const contact = u ? null : clean(b.contact, 80) || null;

  if (kind === "survey") {
    if (!u) return Response.json({ error: "Sign in first, so your answers count once." }, { status: 401 });
    const a = (b.answers ?? {}) as Record<string, unknown>;
    const answers = {
      safe: CHOICES.safe.includes(String(a.safe)) ? String(a.safe) : null, safeWhy: clean(a.safeWhy, 800),
      stuck: clean(a.stuck, 800),
      mainnet: CHOICES.mainnet.includes(String(a.mainnet)) ? String(a.mainnet) : null, mainnetWhy: clean(a.mainnetWhy, 800),
    };
    if (!answers.safe || !answers.mainnet) return Response.json({ error: "Pick an answer for the first and last question." }, { status: 400 });
    const had = ((await q.query("select id from feedback where user_id = $1 and kind = 'survey'", [u.id])) as { id: string }[])[0];
    if (had) await q.query("update feedback set answers = $2::jsonb, created_at = now() where id = $1", [had.id, JSON.stringify(answers)]);
    else await q.query("insert into feedback (id, user_id, kind, path, answers, device, vid) values ($1, $2, 'survey', $3, $4::jsonb, $5, $6)", [id, u.id, path, JSON.stringify(answers), device, vid]);
    // effort, not a click: some words beyond the two choices
    if ((answers.safeWhy + answers.stuck + answers.mainnetWhy).length >= 40) await award(u.id, "survey", "first").catch(() => null);
    return Response.json({ ok: true });
  }

  const text = clean(b.text, 2000);
  if (text.length < 10) return Response.json({ error: "Say a little more: what did you do, and what happened?" }, { status: 400 });
  await q.query("insert into feedback (id, user_id, kind, path, text, contact, device, vid) values ($1, $2, $3, $4, $5, $6, $7, $8)", [id, u?.id ?? null, kind, path, text, contact, device, vid]);
  return Response.json({ ok: true, id });
}
