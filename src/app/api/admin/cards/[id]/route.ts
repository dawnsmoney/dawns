import { isAdmin } from "@/lib/admin";
import { getDraft } from "@/lib/cards";
import { renderCard } from "@/lib/card-image";

export const dynamic = "force-dynamic";

/** The card image, admins only. ?dl=1 downloads it. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) return new Response("Not found", { status: 404 });
  const { id } = await params;
  const d = await getDraft(id);
  if (!d) return new Response("Not found", { status: 404 });
  const slug = d.data.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || d.kind;
  const headers: Record<string, string> = { "cache-control": "private, no-store" };
  if (new URL(req.url).searchParams.get("dl")) headers["content-disposition"] = `attachment; filename="dawns-${slug}-${d.day}.png"`;
  return renderCard(d.data, d.reading, headers);
}
