import { accountOf, sameOrigin } from "@/lib/auth/session";
import { issuePayChallenge, checkPayChallenge } from "@/lib/auth/kaspa-pay";
import { hasDb } from "@/lib/db";

export const dynamic = "force-dynamic";

/** POST {address} starts a self-send sign-in; POST {nonce} checks it. */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return Response.json({ error: "Bad origin" }, { status: 403 });
  if (!hasDb()) return Response.json({ error: "Sign-in is not available right now." }, { status: 503 });
  const b = (await req.json().catch(() => ({}))) as { address?: string; nonce?: string };
  try {
    if (typeof b.nonce === "string") {
      const r = await checkPayChallenge(b.nonce);
      return r.status === "ok" ? Response.json({ status: "ok", account: await accountOf(r.userId) }) : Response.json(r);
    }
    if (typeof b.address === "string") return Response.json(await issuePayChallenge(b.address));
    return Response.json({ error: "Missing address." }, { status: 400 });
  } catch (e) { return Response.json({ error: (e as Error).message }, { status: 400 }); }
}
