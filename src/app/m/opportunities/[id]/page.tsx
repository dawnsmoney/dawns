import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MHead } from "@/components/m/kit";
import { UseOpportunity } from "@/components/use-opportunity";
import { getSnapshot } from "@/lib/snapshot";
import { planFor } from "@/lib/chain/act";

export const revalidate = 120;
type P = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const id = decodeURIComponent((await params).id);
  const o = (await getSnapshot()).opportunities.find((x) => x.id === id);
  return { title: o ? `${o.name} on ${o.pname}` : "Opportunity" };
}

export default async function MUsePage({ params }: P) {
  const id = decodeURIComponent((await params).id);
  const s = await getSnapshot();
  const o = s.opportunities.find((x) => x.id === id);
  if (!o) notFound();
  const plan = await planFor(o, s.protocols);
  return (
    <>
      <MHead back={{ href: "/opportunities", label: "Yield" }} eyebrow={`${o.pname} · ${o.chain === "igra" ? "Igra" : "Kasplex"}`} title={o.name} sub="From your own wallet: dawns builds and checks each transaction, your wallet signs it." />
      <div style={{ padding: "0 16px 24px" }}><UseOpportunity o={o} plan={plan} /></div>
    </>
  );
}
