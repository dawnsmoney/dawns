import { currentUser, sameOrigin } from "@/lib/auth/session";
import { sql } from "@/lib/db";
import { tgLink } from "@/lib/tglink";

export const dynamic = "force-dynamic";

/** One-time deep link that ties a Telegram chat to the signed-in profile. */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return Response.json({ error: "Bad origin" }, { status: 403 });
  const u = await currentUser();
  if (!u) return Response.json({ error: "Sign in first." }, { status: 401 });
  const token = [...crypto.getRandomValues(new Uint8Array(18))].map((b) => b.toString(16).padStart(2, "0")).join("");
  await sql().query("delete from telegram_links where expires_at < now()");
  await sql().query("insert into telegram_links (token, user_id, expires_at) values ($1, $2, now() + interval '15 minutes')", [token, u.id]);
  const url = tgLink(`link_${token}`);
  if (!url) return Response.json({ error: "The Telegram bot is not configured." }, { status: 503 });
  return Response.json({ url });
}
