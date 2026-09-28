import { currentUser, sameOrigin } from "@/lib/auth/session";
import { hasDb } from "@/lib/db";
import { getStrategy, ownerOf, setListed, withdrawScheduled } from "@/lib/strategies/store";

export const dynamic = "force-dynamic";

/** GET ?id=: is the signed-in wallet this strategy's strategist. POST { id, action }: withdraw | unlist | list. */
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!hasDb() || !/^[0-9a-f]{12}$/.test(id)) return Response.json({ owner: false });
  const [u, o] = await Promise.all([currentUser().catch(() => null), ownerOf(id).catch(() => null)]);
  return Response.json({ owner: !!u && u.id === o }, { headers: { "cache-control": "no-store" } });
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) return Response.json({ error: "Bad origin" }, { status: 403 });
  if (!hasDb()) return Response.json({ error: "Not available here." }, { status: 503 });
  const u = await currentUser().catch(() => null);
  if (!u) return Response.json({ error: "Sign in with the strategist's wallet." }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { id?: unknown; action?: unknown };
  const id = typeof b.id === "string" ? b.id : "";
  const g = /^[0-9a-f]{12}$/.test(id) ? await getStrategy(id) : null;
  if (!g) return Response.json({ error: "Unknown strategy." }, { status: 404 });
  try {
    if (b.action === "withdraw") await withdrawScheduled(id, u.id);
    else if (b.action === "unlist" || b.action === "list") await setListed(g.st.family, u.id, b.action === "list");
    else return Response.json({ error: "Unknown action." }, { status: 400 });
    return Response.json({ ok: true, current: g.family.current.id });
  } catch (e) { return Response.json({ error: (e as Error).message }, { status: 400 }); }
}
