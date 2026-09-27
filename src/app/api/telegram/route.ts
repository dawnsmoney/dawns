import { getSnapshot } from "@/lib/snapshot";
import { sql, hasDb, ensureSchema } from "@/lib/db";
import { send, tg, esc, SITE } from "@/lib/telegram";
import { dawnReport } from "@/lib/report";
import { usd, pct } from "@/lib/format";
import type { Snapshot } from "@/lib/types";
import { parsePolicy, type FollowedPlan } from "@/lib/allocator";
import { planChecks } from "@/lib/plan-alerts";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Chat = { id: number; type: string; title?: string; username?: string; first_name?: string };
type Update = {
  message?: { chat: Chat; text?: string };
  callback_query?: { id: string; data?: string; message?: { chat: Chat; message_id: number } };
  my_chat_member?: { chat: Chat; new_chat_member: { status: string } };
};

const BRIDGE = { id: "igra-bridge", name: "Igra bridge" };

/** Everything a chat can watch: protocols above the alert floor, the bridge, or all. */
function targets(s: Snapshot) {
  return [...s.protocols.filter((p) => !p.floor).map((p) => ({ id: p.id, name: p.name })), BRIDGE];
}
function resolve(s: Snapshot, arg: string) {
  const a = arg.trim().toLowerCase().replace(/^watch_/, "");
  if (!a) return null;
  if (a === "all" || a === "everything") return { id: "all", name: "all of Kaspa DeFi" };
  const list = [...s.protocols.map((p) => ({ id: p.id, name: p.name })), BRIDGE];
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, "");
  return list.find((p) => p.id === a) ?? list.find((p) => norm(p.name) === norm(a)) ?? list.find((p) => norm(p.name).startsWith(norm(a)) || p.id.startsWith(a)) ?? null;
}

async function upsertChat(c: Chat) {
  const title = c.title ?? c.username ?? c.first_name ?? null;
  await sql().query("insert into telegram_chats (chat_id, title) values ($1, $2) on conflict (chat_id) do update set title = excluded.title", [c.id, title]);
}
async function subs(chatId: number) {
  return ((await sql().query("select protocol from telegram_subs where chat_id = $1 order by created_at", [chatId])) as { protocol: string }[]).map((r) => r.protocol);
}
async function watch(c: Chat, id: string) {
  await upsertChat(c);
  await sql().query("insert into telegram_subs (chat_id, protocol) values ($1, $2) on conflict do nothing", [c.id, id]);
}

function pickerKeyboard(s: Snapshot, have: string[]) {
  const rows: { text: string; callback_data: string }[][] = [];
  const items = [...targets(s), { id: "all", name: "Everything" }];
  for (let i = 0; i < items.length; i += 2)
    rows.push(items.slice(i, i + 2).map((p) => ({ text: `${have.includes(p.id) ? "✓ " : ""}${p.name}`, callback_data: `w:${p.id}`.slice(0, 64) })));
  return { inline_keyboard: rows };
}

function status(s: Snapshot) {
  const open = s.signals.filter((g) => g.t === "crit" || g.t === "warn").slice(0, 5);
  return `<pre>${esc(dawnReport(s))}</pre>${open.length ? `\n<b>Open warnings</b>\n${open.map((g) => `${g.t === "crit" ? "🔴" : "🟠"} ${esc(g.strong)}`).join("\n")}` : ""}\n\n<a href="${SITE}">Open dawns.money</a>`;
}
function bridge(s: Snapshot) {
  const b = s.bridge;
  if (!b) return "The bridge could not be read on the last run. Try again in a few minutes.";
  const k = (n: number) => Math.round(n).toLocaleString("en-US");
  return `${b.coverage >= 1 ? "🟢" : "🔴"} <b>iKAS is ${pct(b.coverage)} backed</b>\n\nLocked on Kaspa L1: ${k(b.lockedKas)} KAS${s.kasUsd ? ` (${usd(b.lockedKas * s.kasUsd)})` : ""}\niKAS on Igra: ${k(b.ikasSupply)}\n${b.payouts ? `Awaiting L1 payout: ${k(b.payouts.unpaidKas)} KAS${b.payouts.late ? ` (${b.payouts.late} over 72h)` : ""}${b.payouts.medianHours != null ? `\nTypical payout time: ${Math.round(b.payouts.medianHours)} h` : ""}` : `Exits in the 72h release window: ${k(b.inWindowKas)} KAS (${b.inWindowCount})`}\n\n<a href="${SITE}/bridge">Full bridge page</a>`;
}
const HELP = `<b>dawns.money</b> watches Kaspa DeFi on-chain and tells you when something crosses a line.

/status · health right now
/watch · pick protocols to get alerts for
/watch kaskad · or name one directly (or <code>all</code>)
/unwatch kaskad · stop one (or <code>all</code>)
/list · what this chat watches
/bridge · is iKAS fully backed?
/daily on · morning report at 07:00 Athens time
/plan · your followed plan (link it on dawns.money/allocate)`;

async function handleCommand(c: Chat, text: string) {
  const [raw, ...rest] = text.trim().split(/\s+/);
  const cmd = raw.toLowerCase().replace(/@.*$/, "");
  const arg = rest.join(" ");
  const s = await getSnapshot();

  switch (cmd) {
    case "/start": {
      await upsertChat(c);
      if (arg.startsWith("link_")) {
        const r = (await sql().query("delete from telegram_links where token = $1 and expires_at > now() returning user_id", [arg.slice(5)])) as { user_id: string }[];
        if (!r[0]) return send(c.id, "That link expired. Open dawns.money/allocate and press Connect Telegram again.");
        await sql().query("update telegram_chats set user_id = $2 where chat_id = $1", [c.id, r[0].user_id]);
        return send(c.id, `🔗 <b>Linked to your dawns profile.</b>\nWhen you follow a plan on dawns.money/allocate, I'll tell you here when a position stops fitting your rules: its exit gets tight, its yield drops, or its price swings too far.\n\n/plan · your followed plan right now\n/unlink · disconnect this chat`);
      }
      const t = arg ? resolve(s, arg) : null;
      if (t) {
        await watch(c, t.id);
        return send(c.id, `🔔 <b>Watching ${esc(t.name)}.</b>\nYou'll get a message here when dawns raises a warning for it, and when it clears.\n\n${HELP}`);
      }
      return send(c.id, `☀️ ${HELP}`);
    }
    case "/help": return send(c.id, HELP);
    case "/plan": {
      const r = (await sql().query("select p.plan, p.policy from telegram_chats c join profiles p on p.user_id = c.user_id where c.chat_id = $1", [c.id])) as { plan: FollowedPlan | null; policy: unknown }[];
      if (!r[0]) return send(c.id, "This chat is not linked to a profile. Open dawns.money/allocate, sign in, and press Connect Telegram.");
      if (!r[0].plan?.lines?.length) return send(c.id, "You are not following a plan yet. Build one on dawns.money/allocate and press Follow this plan.");
      const checks = planChecks(s, r[0].plan, parsePolicy(r[0].policy));
      const lines = r[0].plan.lines.map((l) => {
        const o = s.opportunities.find((x) => x.id === l.id);
        const bad = checks.filter((x) => x.lineId === l.id);
        return `${bad.length ? (bad.some((x) => x.t === "crit") ? "🔴" : "🟠") : "🟢"} <b>${esc(l.name)}</b> · $${l.usd.toLocaleString("en-US")}\n   ${o?.apy != null ? `yield ${pct(o.apy)} (was ${pct(l.apy)})` : "not listed now"}${bad.length ? `\n   ${bad.map((x) => esc(x.strong)).join("\n   ")}` : ""}`;
      });
      return send(c.id, `<b>Your plan</b> · followed since ${new Date(r[0].plan.at).toISOString().slice(0, 10)}\n\n${lines.join("\n\n")}\n\n<a href="${SITE}/allocate">Open on dawns</a>`);
    }
    case "/unlink": {
      await sql().query("update telegram_chats set user_id = null where chat_id = $1", [c.id]);
      return send(c.id, "This chat is no longer linked to your dawns profile.");
    }
    case "/status": return send(c.id, status(s));
    case "/bridge": return send(c.id, bridge(s));
    case "/protocols":
    case "/watch": {
      if (cmd === "/watch" && arg) {
        const t = resolve(s, arg);
        if (!t) return send(c.id, `I don't know “${esc(arg)}”. Send /watch to pick from the list.`);
        await watch(c, t.id);
        return send(c.id, `🔔 Watching <b>${esc(t.name)}</b>.`);
      }
      return send(c.id, "Tap to watch. Tap again to stop.", { reply_markup: pickerKeyboard(s, await subs(c.id)) });
    }
    case "/unwatch": {
      if (!arg) return send(c.id, "Tap a protocol to stop watching it.", { reply_markup: pickerKeyboard(s, await subs(c.id)) });
      if (arg.toLowerCase() === "all") { await sql().query("delete from telegram_subs where chat_id = $1", [c.id]); return send(c.id, "Stopped all alerts in this chat."); }
      const t = resolve(s, arg);
      if (!t) return send(c.id, `I don't know “${esc(arg)}”.`);
      await sql().query("delete from telegram_subs where chat_id = $1 and protocol = $2", [c.id, t.id]);
      return send(c.id, `Stopped watching <b>${esc(t.name)}</b>.`);
    }
    case "/list": {
      const have = await subs(c.id);
      if (!have.length) return send(c.id, "This chat isn't watching anything yet. Send /watch.");
      const nm = (id: string) => (id === "all" ? "Everything" : id === BRIDGE.id ? BRIDGE.name : s.protocols.find((p) => p.id === id)?.name ?? id);
      return send(c.id, `<b>Watching</b>\n${have.map((id) => `· ${esc(nm(id))}`).join("\n")}`);
    }
    case "/daily": {
      await upsertChat(c);
      const on = !/^(off|no|stop|0)$/i.test(arg);
      await sql().query("update telegram_chats set daily = $2 where chat_id = $1", [c.id, on]);
      return send(c.id, on ? "☀️ You'll get the dawns report here every morning at 07:00 Athens time. /daily off to stop." : "Morning report off.");
    }
    case "/stop": {
      await sql().query("delete from telegram_chats where chat_id = $1", [c.id]);
      return send(c.id, "Removed this chat from dawns. Send /start any time to come back.");
    }
    default:
      if (c.type === "private") return send(c.id, HELP);
  }
}

async function handleCallback(q: NonNullable<Update["callback_query"]>) {
  const c = q.message?.chat;
  const id = q.data?.startsWith("w:") ? q.data.slice(2) : null;
  if (!c || !id) return tg("answerCallbackQuery", { callback_query_id: q.id });
  const have = await subs(c.id);
  const s = await getSnapshot();
  const name = id === "all" ? "Everything" : id === BRIDGE.id ? BRIDGE.name : s.protocols.find((p) => p.id === id)?.name ?? id;
  if (have.includes(id)) await sql().query("delete from telegram_subs where chat_id = $1 and protocol = $2", [c.id, id]);
  else await watch(c, id);
  const next = await subs(c.id);
  await tg("answerCallbackQuery", { callback_query_id: q.id, text: have.includes(id) ? `Stopped: ${name}` : `Watching: ${name}` });
  await tg("editMessageReplyMarkup", { chat_id: c.id, message_id: q.message!.message_id, reply_markup: pickerKeyboard(s, next) }).catch(() => null);
}

export async function POST(req: Request) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret || req.headers.get("x-telegram-bot-api-secret-token") !== secret) return new Response("unauthorized", { status: 401 });
  if (!hasDb()) return Response.json({ ok: false, reason: "no database" });
  const u = (await req.json()) as Update;
  try {
    await ensureSchema();
    if (u.message?.text?.startsWith("/")) await handleCommand(u.message.chat, u.message.text);
    else if (u.callback_query) await handleCallback(u.callback_query);
    else if (u.my_chat_member && ["kicked", "left"].includes(u.my_chat_member.new_chat_member.status))
      await sql().query("delete from telegram_chats where chat_id = $1", [u.my_chat_member.chat.id]);
  } catch (e) {
    console.error("telegram webhook", e);
  }
  // always 200 so Telegram does not retry the same update forever
  return Response.json({ ok: true });
}

export async function GET() {
  return Response.json({ ok: true, service: "dawns telegram webhook" });
}
