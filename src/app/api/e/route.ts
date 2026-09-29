import { sha256 } from "@noble/hashes/sha256";
import { sql, hasDb, ensureSchema } from "@/lib/db";
import { currentUser } from "@/lib/auth/session";
import { isCode, onEvent, onReferralVisit } from "@/lib/pioneer";

export const dynamic = "force-dynamic";

/** Product events allowed from the page. Anything else is dropped. */
const NAMES = new Set([
  "pageview",
  "signin_start", "signin_ok", "signin_fail", "profile_saved", "plan_followed", "plan_unfollowed", "telegram_link",
  "watch_saved", "watch_removed", "prov_open", "opportunity_open", "report_copied", "telegram_click",
  "intel_day", "share_copy", "share_x", "find_submitted",
]);
const BOT = /bot|crawl|spider|slurp|preview|headless|lighthouse|facebookexternalhit|embedly|vercel|curl|wget|python|axios|node-fetch/i;
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");

/**
 * Cookieless visitor id: hash of (daily salt, IP, user agent). The salt changes every UTC day and
 * is never stored, so the same person cannot be followed across days and no IP is kept.
 */
function visitorId(req: Request) {
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
  const ua = req.headers.get("user-agent") ?? "";
  const secret = process.env.CRON_SECRET ?? process.env.TELEGRAM_WEBHOOK_SECRET ?? "dawns";
  const salt = hex(sha256(new TextEncoder().encode(`${secret}:${new Date().toISOString().slice(0, 10)}`)));
  return hex(sha256(new TextEncoder().encode(`${salt}|${ip}|${ua}`))).slice(0, 16);
}

export async function POST(req: Request) {
  if (!hasDb()) return new Response(null, { status: 204 });
  if (BOT.test(req.headers.get("user-agent") ?? "")) return new Response(null, { status: 204 });
  const raw = await req.text();
  if (raw.length > 2000) return new Response(null, { status: 413 });
  let b: { name?: string; path?: string; props?: Record<string, unknown> };
  try { b = JSON.parse(raw); } catch { return new Response(null, { status: 400 }); }
  if (!b.name || !NAMES.has(b.name)) return new Response(null, { status: 204 });
  const props: Record<string, unknown> = b.props && typeof b.props === "object" ? Object.fromEntries(Object.entries(b.props).slice(0, 6).map(([k, v]) => [k.slice(0, 32), typeof v === "number" || typeof v === "boolean" ? v : String(v).slice(0, 120)])) : {};
  const country = req.headers.get("x-vercel-ip-country");
  if (country) props.country = country.slice(0, 2);
  await ensureSchema();
  // a page view that came through a share link (?r=code) counts for the link's owner; the viewer
  // is looked up only to stop anyone earning from their own link
  const via = b.name === "pageview" && isCode(props.r) ? props.r : null;
  const u = b.name === "pageview" && !via ? null : await currentUser().catch(() => null);
  const vid = visitorId(req);
  const path = typeof b.path === "string" ? b.path.slice(0, 120) : null;
  await sql().query("insert into app_events (name, path, user_id, props, vid) values ($1, $2, $3, $4::jsonb, $5)",
    [b.name, path, b.name === "pageview" ? null : u?.id ?? null, Object.keys(props).length ? JSON.stringify(props) : null, vid]);
  try {
    if (via) await onReferralVisit(via, vid, path, u?.id ?? null);
    else if (u) await onEvent(u.id, b.name, props);
  } catch { /* points never break analytics */ }
  return new Response(null, { status: 204 });
}
