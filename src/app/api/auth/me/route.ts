import { currentUser, accountOf } from "@/lib/auth/session";
import { hasDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!hasDb()) return Response.json(null);
  const u = await currentUser().catch(() => null);
  return Response.json(u ? await accountOf(u.id) : null, { headers: { "cache-control": "no-store" } });
}
