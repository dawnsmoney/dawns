import { sql, hasDb } from "@/lib/db";
import { renderCard } from "@/lib/card-image";
import type { CardData } from "@/lib/cards";

export const dynamic = "force-dynamic";

/** A shared plan card. Public by design: it holds only the rules the person chose to share. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!hasDb() || !/^p_[0-9a-f]{18}$/.test(id)) return new Response("Not found", { status: 404 });
  const r = (await sql().query("select data, reading from plan_shares where id = $1", [id])) as { data: CardData; reading: string }[];
  if (!r[0]) return new Response("Not found", { status: 404 });
  const headers: Record<string, string> = { "cache-control": "public, max-age=31536000, immutable" };
  if (new URL(req.url).searchParams.get("dl")) headers["content-disposition"] = `attachment; filename="dawns-plan.png"`;
  return renderCard(r[0].data, r[0].reading, headers);
}
