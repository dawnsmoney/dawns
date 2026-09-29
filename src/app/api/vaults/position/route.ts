import { getNav, positionOf, positionAt } from "@/lib/vaults/nav";
import { getCredit, creditFigures } from "@/lib/vaults/credit";

export const dynamic = "force-dynamic";

/** One address's position in a dawns vault (?vault=<covenant id>, default the NAV vault): account addresses, pending coins, shares, notes. */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const address = (q.get("address") ?? "").trim().toLowerCase();
  const vault = q.get("vault");
  try {
    const c = await getCredit();
    if (vault && c.l && c.m && vault === c.l.covenantId) {
      return Response.json(await positionAt(c.l, creditFigures(c.l, c.m, null).price, address), { headers: { "cache-control": "no-store" } });
    }
    const { l, m } = await getNav();
    if (!l || !m || (vault && vault !== l.covenantId)) return Response.json({ error: "Unknown vault" }, { status: 404 });
    return Response.json(await positionOf(l, m, address), { headers: { "cache-control": "no-store" } });
  } catch (e) { return Response.json({ error: (e as Error).message }, { status: 400 }); }
}
