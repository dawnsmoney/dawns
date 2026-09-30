import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EarnSheet } from "@/components/earn-sheet";
import { DataBridge } from "@/components/providers";
import { earnSheet } from "@/lib/earn-sheet-data";
import { earnName } from "@/lib/earn";
import { toLite } from "@/lib/view";

export const dynamic = "force-dynamic";
type P = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const d = await earnSheet(decodeURIComponent((await params).id));
  if (!d) return { title: "Earn" };
  const image = `/api/share/opp/${encodeURIComponent(d.o.id)}`;
  return { title: `Earn · ${earnName(d.o)} on ${d.o.pname}`, description: `Where the yield comes from, how you leave and what you would be trusting: ${earnName(d.o)} on ${d.o.pname}, read on-chain by dawns.`, openGraph: { images: [image] }, twitter: { card: "summary_large_image", images: [image] } };
}

export default async function Page({ params }: P) {
  const d = await earnSheet(decodeURIComponent((await params).id));
  if (!d) notFound();
  return (
    <>
      <DataBridge prov={d.s.prov} protocols={d.s.protocols.map(toLite)} signals={d.s.signals} />
      <div className="wrap" style={{ paddingTop: 110, paddingBottom: 40 }}><EarnSheet o={d.o} p={d.p} it={d.it} protocols={d.s.protocols} asOf={d.s.asOf} stamp={d.stamp} /></div>
    </>
  );
}
