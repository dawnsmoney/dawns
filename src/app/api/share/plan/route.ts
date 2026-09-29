import { sameOrigin } from "@/lib/auth/session";
import { parsePolicy } from "@/lib/allocator";
import { sql, hasDb, ensureSchema } from "@/lib/db";
import { getSnapshot } from "@/lib/snapshot";
import { planCard } from "@/lib/plan-share";

export const dynamic = "force-dynamic";

/** Make a share card from a plan's rules: { policy, showAmount }. Returns its id and post text. */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return Response.json({ error: "Bad origin" }, { status: 403 });
  if (!hasDb()) return Response.json({ error: "Sharing is not available right now." }, { status: 503 });
  const b = (await req.json().catch(() => ({}))) as { policy?: unknown; showAmount?: unknown };
  const policy = parsePolicy(b.policy);
  if (!policy) return Response.json({ error: "That plan is not valid." }, { status: 400 });
  await ensureSchema();
  const c = planCard(policy, await getSnapshot(), b.showAmount === true);
  const id = `p_${[...crypto.getRandomValues(new Uint8Array(9))].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
  await sql().query("insert into plan_shares (id, data, reading) values ($1, $2::jsonb, $3)", [id, JSON.stringify(c.data), c.reading]);
  return Response.json({ id, image: `/api/share/plan/${id}`, text: (c.data.caption ?? "").replace("{url}", "https://www.dawns.money/allocate") });
}
