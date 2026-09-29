import "server-only";
import { send, esc, hasBot, SITE } from "./telegram";

/**
 * A private Telegram message to the operator (TELEGRAM_ADMIN_CHAT_ID: your own chat
 * with the dawns bot) when a tester reports something or a Pioneer submits a find.
 * Never the public channel. Best effort: a failed message never fails the request.
 */
export async function notifyAdmin(title: string, lines: (string | null | undefined)[], path: string) {
  const chat = process.env.TELEGRAM_ADMIN_CHAT_ID;
  if (!chat || !hasBot()) return;
  const body = [`<b>${esc(title)}</b>`, ...lines.filter((x): x is string => !!x).map((x) => esc(x.length > 700 ? `${x.slice(0, 700)}…` : x)), `${SITE}${path}`].join("\n\n");
  await send(chat, body).catch(() => null);
}
