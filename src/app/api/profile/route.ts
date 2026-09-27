import { currentUser, accountOf, sameOrigin } from "@/lib/auth/session";
import { parsePolicy, parseFollowed } from "@/lib/allocator";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Save the profile policy, and optionally the plan to follow (plan: null stops following). */
export async function PUT(req: Request) {
  if (!sameOrigin(req)) return Response.json({ error: "Bad origin" }, { status: 403 });
  const u = await currentUser();
  if (!u) return Response.json({ error: "Sign in with a wallet to save your profile." }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { policy?: unknown; plan?: unknown };
  const policy = parsePolicy(b.policy);
  if (!policy) return Response.json({ error: "That profile is not valid." }, { status: 400 });
  const touchPlan = "plan" in b;
  const plan = b.plan === null ? null : touchPlan ? parseFollowed(b.plan) : undefined;
  if (touchPlan && b.plan !== null && !plan) return Response.json({ error: "That plan is not valid." }, { status: 400 });
  if (touchPlan)
    await sql().query(
      "insert into profiles (user_id, policy, plan, updated_at) values ($1, $2::jsonb, $3::jsonb, now()) on conflict (user_id) do update set policy = excluded.policy, plan = excluded.plan, updated_at = now()",
      [u.id, JSON.stringify(policy), plan ? JSON.stringify(plan) : null]);
  else
    await sql().query(
      "insert into profiles (user_id, policy, updated_at) values ($1, $2::jsonb, now()) on conflict (user_id) do update set policy = excluded.policy, updated_at = now()",
      [u.id, JSON.stringify(policy)]);
  return Response.json(await accountOf(u.id));
}
