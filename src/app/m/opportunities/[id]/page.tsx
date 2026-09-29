import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MHead } from "@/components/m/kit";
import { UseOpportunity } from "@/components/use-opportunity";
import { getSnapshot } from "@/lib/snapshot";
import { planFor } from "@/lib/chain/act";
import { getIntelRaw } from "@/lib/intel-db";
import { buildIntel } from "@/lib/intel";
import { oppShareText } from "@/lib/share-text";
import { acceptedFinds } from "@/lib/pioneer";
import { Share } from "@/components/share";
import { OppOpen } from "@/components/pioneer-ping";

export const revalidate = 120;
type P = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const id = decodeURIComponent((await params).id);
  const o = (await getSnapshot()).opportunities.find((x) => x.id === id);
  if (!o) return { title: "Opportunity" };
  const image = `/api/share/opp/${encodeURIComponent(o.id)}`;
  return { title: `${o.name} on ${o.pname}`, openGraph: { images: [image] }, twitter: { card: "summary_large_image", images: [image] } };
}

export default async function MUsePage({ params }: P) {
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
      <MHead back={{ href: "/opportunities", label: "Yield" }} eyebrow={`${o.pname} · ${o.chain === "igra" ? "Igra" : "Kasplex"}`} title={o.name} sub="From your own wallet: dawns builds and checks each transaction, your wallet signs it." />
      <div style={{ padding: "0 16px 24px", display: "grid", gap: 14 }}>
        <OppOpen id={o.id} />
        <div className="share-row"><span className="muted">{found?.by ? <>Discovered by <span className="mono">{found.by.slice(0, 10)}…{found.by.slice(-4)}</span> · </> : null}Share</span>{share}</div>
        <UseOpportunity o={o} plan={plan} />
      </div>
    </>
  );
}
