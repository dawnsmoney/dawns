import { currentUser, sameOrigin, accountOf } from "@/lib/auth/session";
import { hasDb } from "@/lib/db";
import { startWatch, stopWatch, watchesOf } from "@/lib/earn-watch";

export const dynamic = "force-dynamic";

/** The signed-in user's watched Earn options, and whether their alerts can reach them. */
export async function GET() {
  if (!hasDb()) return Response.json({ signedIn: false, telegram: false, opps: [] });
  const u = await currentUser().catch(() => null);
  if (!u) return Response.json({ signedIn: false, telegram: false, opps: [] });
  const [w, acct] = await Promise.all([watchesOf(u.id), accountOf(u.id)]);
  return Response.json({ signedIn: true, telegram: acct.telegram, opps: w.map((x) => x.opp) });
}

/** { opp, on }: start or stop watching an Earn option. */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return Response.json({ error: "Bad origin" }, { status: 403 });
  if (!hasDb()) return Response.json({ error: "Not available here." }, { status: 503 });
  const u = await currentUser().catch(() => null);
  if (!u) return Response.json({ error: "Sign in first." }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { opp?: unknown; on?: unknown };
  const opp = typeof b.opp === "string" ? b.opp.slice(0, 120) : "";
  if (!opp) return Response.json({ error: "Which option?" }, { status: 400 });
  try {
    if (b.on === false) await stopWatch(u.id, opp); else await startWatch(u.id, opp);
    return Response.json({ ok: true });
  } catch (e) { return Response.json({ error: (e as Error).message }, { status: 400 }); }
}
