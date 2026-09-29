import { currentUser } from "@/lib/auth/session";
import { hasDb } from "@/lib/db";
import { codeOf } from "@/lib/pioneer";

export const dynamic = "force-dynamic";

/** The signed-in account's share code, so share buttons can put it on the link. */
export async function GET() {
  if (!hasDb()) return Response.json({ code: null });
  const u = await currentUser().catch(() => null);
  if (!u) return Response.json({ code: null });
  return Response.json({ code: await codeOf(u.id) });
}
