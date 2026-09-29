import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Banner } from "@/components/Banner";
import { UseOpportunity } from "@/components/use-opportunity";
import { getSnapshot } from "@/lib/snapshot";
import { planFor } from "@/lib/chain/act";
import { pct } from "@/lib/format";

export const revalidate = 120;
type P = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const id = decodeURIComponent((await params).id);
  const o = (await getSnapshot()).opportunities.find((x) => x.id === id);
  return o ? { title: `${o.name} on ${o.pname}`, description: `Take ${o.name} on ${o.pname} from your own wallet: ${o.apy != null ? pct(o.apy, 2) : "—"} native yield, and what it costs to leave.` } : { title: "Opportunity" };
}

export default async function UsePage({ params }: P) {
  const id = decodeURIComponent((await params).id);
  const s = await getSnapshot();
  const o = s.opportunities.find((x) => x.id === id);
  if (!o) notFound();
  const plan = await planFor(o, s.protocols);
  return (
    <>
      <Banner short crumb={[{ href: "/opportunities", label: "Opportunities" }, { label: o.pname }]} title={o.name}
        lede={`On ${o.pname}, ${o.chain === "igra" ? "Igra" : "Kasplex"}. From your own wallet, one step at a time: dawns builds and checks each transaction, your wallet signs it.`} />
      <div className="wrap" style={{ paddingTop: 40, display: "grid", gap: 20 }}>
        <UseOpportunity o={o} plan={plan} />
        <p className="muted" style={{ fontSize: 13, margin: 0 }}>Research, not advice. <Link href={`/protocols/${o.protocol}`}>{o.pname}&apos;s health</Link> · <Link href="/opportunities">all opportunities</Link></p>
      </div>
    </>
  );
}
