import "server-only";
import { sha256 } from "@noble/hashes/sha256";

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");

/**
 * Cookieless visitor id: hash of (daily salt, IP, user agent). The salt changes every UTC day and
 * is never stored, so the same person cannot be followed across days and no IP is kept.
 */
export function visitorId(req: Request) {
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
  const ua = req.headers.get("user-agent") ?? "";
  const secret = process.env.CRON_SECRET ?? process.env.TELEGRAM_WEBHOOK_SECRET ?? "dawns";
  const salt = hex(sha256(new TextEncoder().encode(`${secret}:${new Date().toISOString().slice(0, 10)}`)));
  return hex(sha256(new TextEncoder().encode(`${salt}|${ip}|${ua}`))).slice(0, 16);
}
