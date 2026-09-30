import "server-only";
import { getMeta, setMeta } from "./db";

/** Minimal Telegram Bot API client. Messages use HTML parse mode. */
const TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? null;
export const hasBot = () => !!TOKEN;
export const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.dawns.money";

export async function tg<T = unknown>(method: string, body: Record<string, unknown>): Promise<T> {
  if (!TOKEN) throw new Error("TELEGRAM_BOT_TOKEN is not set");
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  const j = (await r.json()) as { ok: boolean; result?: T; description?: string; error_code?: number };
  if (!j.ok) throw Object.assign(new Error(`Telegram ${method}: ${j.description}`), { code: j.error_code });
  return j.result as T;
}

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function send(chatId: number | string, html: string, extra: Record<string, unknown> = {}) {
  return tg("sendMessage", { chat_id: chatId, text: html, parse_mode: "HTML", link_preview_options: { is_disabled: true }, ...extra });
}

/**
 * Post an image (PNG) with a plain-text caption. Telegram caps captions at 1024 characters:
 * a longer text goes out as a message right below the photo instead of being cut.
 */
export async function sendPhoto(chatId: number | string, png: Blob, caption: string) {
  if (!TOKEN) throw new Error("TELEGRAM_BOT_TOKEN is not set");
  const fits = caption.length <= 1024;
  const fd = new FormData();
  fd.set("chat_id", String(chatId));
  fd.set("photo", new File([await png.arrayBuffer()], "dawns.png", { type: "image/png" }));
  if (fits) fd.set("caption", caption);
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/sendPhoto`, { method: "POST", body: fd, cache: "no-store", signal: AbortSignal.timeout(20_000) });
  const j = (await r.json().catch(() => ({ ok: false, description: `HTTP ${r.status}` }))) as { ok: boolean; description?: string };
  if (!j.ok) throw new Error(`Telegram: ${j.description}`);
  if (!fits) await tg("sendMessage", { chat_id: chatId, text: caption.slice(0, 4096), link_preview_options: { is_disabled: true } });
}

export const COMMANDS = [
  { command: "status", description: "Kaspa DeFi health right now" },
  { command: "watch", description: "Get alerts for a protocol (or all)" },
  { command: "unwatch", description: "Stop alerts for a protocol (or all)" },
  { command: "list", description: "What this chat is watching" },
  { command: "protocols", description: "Protocols you can watch" },
  { command: "bridge", description: "Is iKAS fully backed?" },
  { command: "daily", description: "Morning report on or off" },
  { command: "plan", description: "Your followed plan and what changed" },
];

/** Point the bot at this deployment once. Called from the cron tick, so it heals itself. */
export async function ensureWebhook() {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!TOKEN || !secret || process.env.VERCEL_ENV !== "production") return "skipped";
  let url = `${SITE}/api/telegram`;
  // Telegram does not follow redirects: resolve apex ↔ www first.
  const probe = await fetch(url, { method: "GET", redirect: "manual", cache: "no-store" }).catch(() => null);
  const loc = probe && probe.status >= 300 && probe.status < 400 ? probe.headers.get("location") : null;
  if (loc) url = new URL(loc, url).toString();
  const info = await tg<{ url: string }>("getWebhookInfo", {});
  if (info.url === url) {
    // keep the command menu in step with the code
    const v = String(COMMANDS.length);
    if ((await getMeta("tg_commands")) !== v) { await tg("setMyCommands", { commands: COMMANDS }); await setMeta("tg_commands", v); return "commands updated"; }
    return "ok";
  }
  await tg("setWebhook", { url, secret_token: secret, allowed_updates: ["message", "callback_query", "my_chat_member"], drop_pending_updates: false });
  await tg("setMyCommands", { commands: COMMANDS });
  await tg("setMyDescription", { description: "Live health of Kaspa DeFi from dawns.money. Watch a protocol and get an alert when liquidity, utilization, oracles or bridge backing cross a line." }).catch(() => null);
  return "set";
}
