import { currentUser, sameOrigin } from "@/lib/auth/session";
import { sql, hasDb, ensureSchema } from "@/lib/db";
import { notifyAdmin } from "@/lib/notify-admin";

export const dynamic = "force-dynamic";

const clean = (x: unknown, max: number) => String(x ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** "Find an opportunity": a signed-in Pioneer submits a market, pool or vault dawns does not list yet. */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return Response.json({ error: "Bad origin" }, { status: 403 });
  if (!hasDb()) return Response.json({ error: "Not available here." }, { status: 503 });
  const u = await currentUser().catch(() => null);
  if (!u) return Response.json({ error: "Sign in with a wallet first." }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const protocol = clean(b.protocol, 60), target = clean(b.target, 120), asset = clean(b.asset, 40), link = clean(b.link, 300), why = clean(b.why, 800);
  if (protocol.length < 2 || target.length < 2) return Response.json({ error: "Name the protocol and the market, pool or vault." }, { status: 400 });
  if (why.length < 30) return Response.json({ error: "Say in a sentence or two why it is interesting (30 characters at least)." }, { status: 400 });
  if (link && !/^(https?:\/\/\S+|0x[0-9a-fA-F]{40}|kaspa(test)?:[a-z0-9]{40,90})$/.test(link)) return Response.json({ error: "The link must be a web address or a contract address." }, { status: 400 });
  await ensureSchema();
  const q = sql();
  const open = ((await q.query("select count(*) filter (where status = 'pending')::int as p, count(*) filter (where created_at > now() - interval '1 day')::int as d from finds where user_id = $1", [u.id])) as { p: number; d: number }[])[0];
  if ((open?.p ?? 0) >= 3) return Response.json({ error: "You have 3 finds waiting for review. dawns will look at those first." }, { status: 429 });
  if ((open?.d ?? 0) >= 5) return Response.json({ error: "Five finds a day at most." }, { status: 429 });
  const id = `f_${[...crypto.getRandomValues(new Uint8Array(8))].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
  await q.query("insert into finds (id, user_id, protocol, target, asset, link, why) values ($1, $2, $3, $4, $5, $6, $7)", [id, u.id, protocol, target, asset || null, link || null, why]);
  await notifyAdmin(`New find · ${protocol} · ${target}`, [asset ? `Asset ${asset}` : null, link, why], "/admin/finds");
  return Response.json({ ok: true, id });
}
