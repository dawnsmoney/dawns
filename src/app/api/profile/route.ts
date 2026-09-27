import { currentUser, accountOf, sameOrigin } from "@/lib/auth/session";
import { parsePolicy } from "@/lib/allocator";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function PUT(req: Request) {
  if (!sameOrigin(req)) return Response.json({ error: "Bad origin" }, { status: 403 });
  const u = await currentUser();
  if (!u) return Response.json({ error: "Sign in with a wallet to save your profile." }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { policy?: unknown };
  const policy = parsePolicy(b.policy);
  if (!policy) return Response.json({ error: "That profile is not valid." }, { status: 400 });
  await sql().query(
    "insert into profiles (user_id, policy, updated_at) values ($1, $2::jsonb, now()) on conflict (user_id) do update set policy = excluded.policy, updated_at = now()",
    [u.id, JSON.stringify(policy)]);
  return Response.json(await accountOf(u.id));
}
