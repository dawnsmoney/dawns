import { getNav, positionOf } from "@/lib/vaults/nav";

export const dynamic = "force-dynamic";

/** One address's NAV-vault position: account addresses, pending coins, shares, notes. */
export async function GET(req: Request) {
  const { l: navLedger, m: navMandate } = await getNav();
  if (!navLedger || !navMandate) return Response.json({ error: "The NAV vault is not live yet" }, { status: 404 });
  const address = (new URL(req.url).searchParams.get("address") ?? "").trim().toLowerCase();
  try {
    return Response.json(await positionOf(navLedger, navMandate, address), { headers: { "cache-control": "no-store" } });
  } catch (e) { return Response.json({ error: (e as Error).message }, { status: 400 }); }
}
