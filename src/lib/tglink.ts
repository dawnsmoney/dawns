/** Deep link into the dawns Telegram bot, or null until the bot username is configured. */
export const TG_BOT = process.env.NEXT_PUBLIC_TELEGRAM_BOT?.replace(/^@/, "") || null;
export const tgLink = (start?: string) => (TG_BOT ? `https://t.me/${TG_BOT}${start ? `?start=${encodeURIComponent(start)}` : ""}` : null);
