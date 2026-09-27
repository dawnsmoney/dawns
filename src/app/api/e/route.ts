import { sql, hasDb, ensureSchema } from "@/lib/db";
import { currentUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/** Product events allowed from the page. Anything else is dropped. */
const NAMES = new Set([
  "signin_start", "signin_ok", "signin_fail", "profile_saved", "plan_followed", "plan_unfollowed", "telegram_link",
  "watch_saved", "watch_removed", "prov_open", "opportunity_open", "report_copied", "telegram_click",
]);

export async function POST(req: Request) {
  if (!hasDb()) return new Response(null, { status: 204 });
  const raw = await req.text();
  if (raw.length > 2000) return new Response(null, { status: 413 });
  let b: { name?: string; path?: string; props?: Record<string, unknown> };
  try { b = JSON.parse(raw); } catch { return new Response(null, { status: 400 }); }
  if (!b.name || !NAMES.has(b.name)) return new Response(null, { status: 204 });
  const props = b.props && typeof b.props === "object" ? Object.fromEntries(Object.entries(b.props).slice(0, 6).map(([k, v]) => [k.slice(0, 32), typeof v === "number" || typeof v === "boolean" ? v : String(v).slice(0, 120)])) : null;
  await ensureSchema();
  const u = await currentUser().catch(() => null);
  await sql().query("insert into app_events (name, path, user_id, props) values ($1, $2, $3, $4::jsonb)",
    [b.name, typeof b.path === "string" ? b.path.slice(0, 120) : null, u?.id ?? null, props ? JSON.stringify(props) : null]);
  return new Response(null, { status: 204 });
}
