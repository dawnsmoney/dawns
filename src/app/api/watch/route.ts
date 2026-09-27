import { currentUser, sameOrigin } from "@/lib/auth/session";
import { sql, hasDb } from "@/lib/db";
import type { RuleKey } from "@/lib/types";

export const dynamic = "force-dynamic";

const KEYS: RuleKey[] = ["liq", "util", "large", "tvl", "contract", "vol", "backing"];
/** Keep only well-formed rules: { rules: { key: { on, v } }, ch: string[] } */
function clean(x: unknown) {
  if (!x || typeof x !== "object") return null;
  const o = x as { rules?: Record<string, { on?: unknown; v?: unknown }>; ch?: unknown };
  const rules: Record<string, { on: boolean; v: number | null }> = {};
  for (const k of KEYS) {
    const r = o.rules?.[k];
    if (r && typeof r === "object") rules[k] = { on: !!r.on, v: r.v == null || !Number.isFinite(Number(r.v)) ? null : Math.max(0, Math.min(1e7, Number(r.v))) };
  }
  const ch = Array.isArray(o.ch) ? o.ch.filter((c) => c === "inapp" || c === "telegram") : [];
  return { rules, ch };
}

export async function GET() {
  if (!hasDb()) return Response.json({ signedIn: false });
  const u = await currentUser().catch(() => null);
  if (!u) return Response.json({ signedIn: false }, { headers: { "cache-control": "no-store" } });
  const [rows, tg] = await Promise.all([
    sql().query("select protocol, entry from watch_rules where user_id = $1", [u.id]),
    sql().query("select count(*)::int as n from telegram_chats where user_id = $1", [u.id]),
  ]);
  return Response.json({
    signedIn: true, telegram: ((tg as { n: number }[])[0]?.n ?? 0) > 0,
    entries: Object.fromEntries((rows as { protocol: string; entry: unknown }[]).map((r) => [r.protocol, r.entry])),
  }, { headers: { "cache-control": "no-store" } });
}

/** Save or remove one protocol's rules: { protocol, entry } (entry null removes). */
export async function PUT(req: Request) {
  if (!sameOrigin(req)) return Response.json({ error: "Bad origin" }, { status: 403 });
  const u = await currentUser();
  if (!u) return Response.json({ error: "Not signed in" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { protocol?: unknown; entry?: unknown };
  const protocol = typeof b.protocol === "string" && /^[a-z0-9-]{2,60}$/.test(b.protocol) ? b.protocol : null;
  if (!protocol) return Response.json({ error: "Bad protocol" }, { status: 400 });
  if (b.entry === null) { await sql().query("delete from watch_rules where user_id = $1 and protocol = $2", [u.id, protocol]); return Response.json({ ok: true }); }
  const entry = clean(b.entry);
  if (!entry) return Response.json({ error: "Bad rules" }, { status: 400 });
  const n = (await sql().query("select count(*)::int as n from watch_rules where user_id = $1", [u.id])) as { n: number }[];
  if ((n[0]?.n ?? 0) >= 60) return Response.json({ error: "Too many protocols" }, { status: 400 });
  await sql().query("insert into watch_rules (user_id, protocol, entry, updated_at) values ($1, $2, $3::jsonb, now()) on conflict (user_id, protocol) do update set entry = excluded.entry, updated_at = now()",
    [u.id, protocol, JSON.stringify(entry)]);
  return Response.json({ ok: true });
}
