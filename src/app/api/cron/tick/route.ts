import { revalidateTag } from "next/cache";
import { buildSnapshot } from "@/lib/snapshot";
import { hasDb, ensureSchema } from "@/lib/db";
import { recordSnapshot, diffSignals, deliver, maybeDailyReport } from "@/lib/alerts";
import { hasBot, ensureWebhook } from "@/lib/telegram";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Every 10 minutes (GitHub Actions) and once a day (Vercel cron):
 * fresh snapshot → store history → diff signals → Telegram alerts → morning report.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return new Response("unauthorized", { status: 401 });

  const out: Record<string, unknown> = {};
  const step = async (name: string, f: () => Promise<unknown>) => {
    try { out[name] = (await f()) ?? "ok"; } catch (e) { out[name] = `error: ${(e as Error).message.slice(0, 200)}`; }
  };

  const s = await buildSnapshot();
  out.snapshot = { asOf: new Date(s.asOf).toISOString(), buildMs: s.buildMs, protocols: s.protocols.length, signals: s.signals.length, errors: s.errors };
  revalidateTag("snapshot", "max");

  if (hasDb()) {
    await step("schema", ensureSchema);
    await step("history", () => recordSnapshot(s));
    let events: Awaited<ReturnType<typeof diffSignals>> = [];
    await step("signals", async () => { events = await diffSignals(s); return events.map((e) => `${e.kind} ${e.key}`); });
    if (hasBot()) {
      await step("webhook", ensureWebhook);
      await step("alerts", () => deliver(events, s));
      await step("daily", () => maybeDailyReport(s));
    } else out.telegram = "TELEGRAM_BOT_TOKEN not set";
  } else out.db = "DATABASE_URL not set";

  return Response.json(out);
}
