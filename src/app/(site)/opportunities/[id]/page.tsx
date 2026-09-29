import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Banner } from "@/components/Banner";
import { UseOpportunity } from "@/components/use-opportunity";
import { getSnapshot } from "@/lib/snapshot";
import { planFor } from "@/lib/chain/act";
import { getIntelRaw } from "@/lib/intel-db";
import { buildIntel } from "@/lib/intel";
import { oppShareText } from "@/lib/share-text";
import { acceptedFinds } from "@/lib/pioneer";
import { Share } from "@/components/share";
import { OppOpen } from "@/components/pioneer-ping";
import { pct } from "@/lib/format";

export const revalidate = 120;
type P = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const id = decodeURIComponent((await params).id);
  const o = (await getSnapshot()).opportunities.find((x) => x.id === id);
  if (!o) return { title: "Opportunity" };
  const image = `/api/share/opp/${encodeURIComponent(o.id)}`;
  const description = `${o.name} on ${o.pname}: ${o.apy != null ? pct(o.apy, 2) : "—"} native yield, and what it costs to leave. Read on-chain by dawns.`;
  return { title: `${o.name} on ${o.pname}`, description, openGraph: { images: [image] }, twitter: { card: "summary_large_image", images: [image] } };
}

export default async function UsePage({ params }: P) {
  const id = decodeURIComponent((await params).id);
  const s = await getSnapshot();
  const o = s.opportunities.find((x) => x.id === id);
  if (!o) notFound();
  const [plan, raw, finds] = await Promise.all([planFor(o, s.protocols), getIntelRaw().catch(() => null), acceptedFinds(100).catch(() => [])]);
  const tags = raw ? buildIntel(raw, s).byOpp[o.id]?.tags ?? [] : [];
  const found = finds.find((f) => f.opp === o.id);
  const share = <Share path={`/opportunities/${encodeURIComponent(o.id)}`} text={oppShareText(o, tags)} />;
  return (
    <>
      <Banner short crumb={[{ href: "/opportunities", label: "Opportunities" }, { label: o.pname }]} title={o.name}
        lede={`On ${o.pname}, ${o.chain === "igra" ? "Igra" : "Kasplex"}. From your own wallet, one step at a time: dawns builds and checks each transaction, your wallet signs it.`} />
      <div className="wrap" style={{ paddingTop: 40, display: "grid", gap: 20 }}>
        <OppOpen id={o.id} />
        <div className="share-row"><span className="muted">{found?.by ? <>Discovered by <span className="mono">{found.by.slice(0, 10)}…{found.by.slice(-4)}</span>, a Dawns Pioneer · </> : null}Share this reading</span>{share}</div>
        <UseOpportunity o={o} plan={plan} />
        <p className="muted" style={{ fontSize: 13, margin: 0 }}>Research, not advice. <Link href={`/protocols/${o.protocol}`}>{o.pname}&apos;s health</Link> · <Link href="/opportunities">all opportunities</Link></p>
      </div>
    </>
  );
}
