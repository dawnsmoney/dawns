import { sameOrigin } from "@/lib/auth/session";
import { sql, hasDb, ensureSchema } from "@/lib/db";
import { navByCovenant } from "@/lib/vaults/nav";
import { creditLedger, getCreditById } from "@/lib/vaults/credit";
import { ownerOf } from "@/lib/vaults/account";

export const dynamic = "force-dynamic";

/**
 * The keeper's watch list: Kaspa addresses whose personal NAV-vault accounts it
 * sweeps (NAV and credit vaults). Public on purpose (addresses are public; the accounts can only pay the
 * vault or their owner). GET ?vault=<covenant id>; POST { vault, address }.
 */
const known = async (v: string | null) => !!v && (!!navByCovenant(v) || v === creditLedger?.covenantId || (/^[0-9a-f]{64}$/.test(v) && !!(await getCreditById(v))));

export async function GET(req: Request) {
  const vault = new URL(req.url).searchParams.get("vault");
  if (!(await known(vault))) return Response.json({ error: "Unknown vault" }, { status: 404 });
  if (!hasDb()) return Response.json({ accounts: [] });
  await ensureSchema();
  const r = (await sql().query("select address from vault_accounts where vault = $1 order by created_at limit 5000", [vault])) as { address: string }[];
  return Response.json({ vault, accounts: r.map((x) => x.address) }, { headers: { "cache-control": "no-store" } });
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) return Response.json({ error: "Bad origin" }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as { vault?: unknown; address?: unknown };
  const vault = typeof b.vault === "string" ? b.vault : null;
  if (!(await known(vault))) return Response.json({ error: "Unknown vault" }, { status: 404 });
  const address = typeof b.address === "string" ? b.address.trim().toLowerCase() : "";
  try {
    const { prefix } = ownerOf(address);
    if (prefix !== "kaspatest") throw new Error("This vault runs on testnet-10: use a kaspatest: address.");
  } catch (e) { return Response.json({ error: (e as Error).message }, { status: 400 }); }
  if (!hasDb()) return Response.json({ ok: true, stored: false });
  await ensureSchema();
  const n = (await sql().query("select count(*)::int as n from vault_accounts where vault = $1", [vault])) as { n: number }[];
  if ((n[0]?.n ?? 0) >= 5000) return Response.json({ error: "The testnet vault is full" }, { status: 429 });
  await sql().query("insert into vault_accounts (vault, address) values ($1, $2) on conflict do nothing", [vault, address]);
  return Response.json({ ok: true, stored: true });
}
