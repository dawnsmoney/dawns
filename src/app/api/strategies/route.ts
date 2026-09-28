import { currentUser, accountOf, sameOrigin } from "@/lib/auth/session";
import { hasDb } from "@/lib/db";
import { parseDoc } from "@/lib/strategies/model";
import { listStrategies, publishStrategy } from "@/lib/strategies/store";

export const dynamic = "force-dynamic";

/** GET: every listed strategy. POST { doc }: publish as the signed-in wallet (the strategist). */
export async function GET() {
  const s = await listStrategies();
  return Response.json({ strategies: s.map(({ id, hash, doc, strategist, by, createdAt, family, version, effectiveAt }) => ({ id, hash, doc, strategist, by, createdAt, family, version, effectiveAt })) });
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) return Response.json({ error: "Bad origin" }, { status: 403 });
  if (!hasDb()) return Response.json({ error: "Publishing is not available here." }, { status: 503 });
  const u = await currentUser().catch(() => null);
  if (!u) return Response.json({ error: "Sign in with a wallet to publish. The wallet becomes the strategist." }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { doc?: unknown; parent?: unknown };
  const parent = typeof b.parent === "string" && /^[0-9a-f]{12}$/.test(b.parent) ? b.parent : null;
  const p = parseDoc(b.doc);
  if ("error" in p) return Response.json({ error: p.error }, { status: 400 });
  const acct = await accountOf(u.id);
  const w = acct.wallets.find((x) => x.kind === "kaspa") ?? acct.wallets[0];
  if (!w) return Response.json({ error: "No wallet on this account." }, { status: 400 });
  try {
    const r = await publishStrategy(p.doc, u.id, w.address, parent);
    return Response.json({ ok: true, ...r });
  } catch (e) { return Response.json({ error: (e as Error).message }, { status: 400 }); }
}
