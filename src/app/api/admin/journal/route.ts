import { isAdmin } from "@/lib/admin";
import { sameOrigin } from "@/lib/auth/session";
import { getSnapshot } from "@/lib/snapshot";
import { maybeDailyJournal } from "@/lib/journal";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Admins only: write (or rewrite) today's journal entry now. */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return Response.json({ error: "Bad origin" }, { status: 403 });
  if (!(await isAdmin())) return Response.json({ error: "Not found" }, { status: 404 });
  const r = await maybeDailyJournal(await getSnapshot(), true);
  return Response.json({ ok: !r.startsWith("error"), result: r }, { status: r.startsWith("error") ? 502 : 200 });
}
