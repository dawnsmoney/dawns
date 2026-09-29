import { isAdmin } from "@/lib/admin";
import { sameOrigin } from "@/lib/auth/session";
import { sql, ensureSchema } from "@/lib/db";
import { award } from "@/lib/pioneer";

export const dynamic = "force-dynamic";

/** Review a find, admins only: { id, action: "accept" | "reject", note?, opp? }. Accepting credits the finder once. */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return Response.json({ error: "Bad origin" }, { status: 403 });
  if (!(await isAdmin())) return Response.json({ error: "Not found" }, { status: 404 });
  await ensureSchema();
  const b = (await req.json().catch(() => ({}))) as { id?: string; action?: string; note?: string; opp?: string };
  if (!b.id || (b.action !== "accept" && b.action !== "reject")) return Response.json({ error: "Accept or reject a find." }, { status: 400 });
  const note = String(b.note ?? "").trim().slice(0, 400) || null;
  const opp = String(b.opp ?? "").trim().slice(0, 120) || null;
  const q = sql();
  const r = (await q.query("update finds set status = $2, note = $3, opp = $4, reviewed_at = now() where id = $1 returning user_id, protocol, target",
    [b.id, b.action === "accept" ? "accepted" : "rejected", note, opp])) as { user_id: string; protocol: string; target: string }[];
  if (!r[0]) return Response.json({ error: "No such find." }, { status: 404 });
  if (b.action === "accept") await award(r[0].user_id, "find", b.id, `${r[0].protocol} · ${r[0].target}`);
  return Response.json({ ok: true });
}
