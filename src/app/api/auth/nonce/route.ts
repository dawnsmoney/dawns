import { issueNonce, sameOrigin, type WalletKind } from "@/lib/auth/session";
import { hasDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!sameOrigin(req)) return Response.json({ error: "Bad origin" }, { status: 403 });
  if (!hasDb()) return Response.json({ error: "Sign-in is not available right now." }, { status: 503 });
  const b = (await req.json().catch(() => ({}))) as { kind?: WalletKind; address?: string };
  if ((b.kind !== "kaspa" && b.kind !== "evm") || typeof b.address !== "string") return Response.json({ error: "Missing wallet details." }, { status: 400 });
  try { return Response.json(await issueNonce(b.kind, b.address)); }
  catch (e) { return Response.json({ error: (e as Error).message }, { status: 400 }); }
}
