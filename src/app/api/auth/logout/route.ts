import { signOut, sameOrigin } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!sameOrigin(req)) return Response.json({ error: "Bad origin" }, { status: 403 });
  await signOut();
  return Response.json({ ok: true });
}
