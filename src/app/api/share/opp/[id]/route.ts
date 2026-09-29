import { getSnapshot } from "@/lib/snapshot";
import { renderCard } from "@/lib/card-image";
import { oppCard } from "@/lib/cards";

export const revalidate = 600;

/** An opportunity as a share card: what X and Telegram show when its link is posted. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = decodeURIComponent((await params).id);
  const s = await getSnapshot();
  const o = s.opportunities.find((x) => x.id === id);
  if (!o) return new Response("Not found", { status: 404 });
  const c = oppCard(o, s);
  return renderCard(c.data, c.reading, { "cache-control": "public, max-age=600, s-maxage=600" });
}
