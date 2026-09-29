import { isAdmin } from "@/lib/admin";
import { sameOrigin } from "@/lib/auth/session";
import { sql, ensureSchema } from "@/lib/db";
import { award } from "@/lib/pioneer";

export const dynamic = "force-dynamic";

const STATUSES = ["new", "confirmed", "fixed", "dismissed"] as const;

/** Review a report, admins only: { id, status, note? }. Confirming (or fixing) a signed-in report pays its reporter once. */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return Response.json({ error: "Bad origin" }, { status: 403 });
  if (!(await isAdmin())) return Response.json({ error: "Not found" }, { status: 404 });
  await ensureSchema();
  const b = (await req.json().catch(() => ({}))) as { id?: string; status?: string; note?: string };
  const st = STATUSES.find((x) => x === b.status);
  if (!b.id || !st) return Response.json({ error: "Pick a status." }, { status: 400 });
  const r = (await sql().query("update feedback set status = $2, note = coalesce($3, note), reviewed_at = now() where id = $1 and kind <> 'survey' returning user_id, kind, path",
    [b.id, st, String(b.note ?? "").trim().slice(0, 400) || null])) as { user_id: string | null; kind: string; path: string | null }[];
  if (!r[0]) return Response.json({ error: "No such report." }, { status: 404 });
  if ((st === "confirmed" || st === "fixed") && r[0].user_id) await award(r[0].user_id, "bug", b.id, `${r[0].kind} · ${r[0].path ?? ""}`);
  return Response.json({ ok: true });
}
