import { verifyAndSignIn, accountOf, sameOrigin, type WalletKind } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!sameOrigin(req)) return Response.json({ error: "Bad origin" }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as { kind?: WalletKind; address?: string; message?: string; signature?: string };
  if ((b.kind !== "kaspa" && b.kind !== "evm") || !b.address || !b.message || !b.signature) return Response.json({ error: "Missing signature." }, { status: 400 });
  try {
    const id = await verifyAndSignIn(b.kind, b.address, b.message, b.signature);
    return Response.json(await accountOf(id));
  } catch (e) { return Response.json({ error: (e as Error).message }, { status: 401 }); }
}
