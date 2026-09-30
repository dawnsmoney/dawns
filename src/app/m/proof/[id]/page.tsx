import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MHead } from "@/components/m/kit";
import { Pill } from "@/components/bits";
import { ProofBody } from "@/components/proof";
import { DataBridge } from "@/components/providers";
import { getSnapshot } from "@/lib/snapshot";
import { findProof } from "@/lib/proof-vaults";
import { proofHistory } from "@/lib/proof-history";
import { toLite } from "@/lib/view";
import { SITE } from "@/lib/telegram";

export const revalidate = 120;
type P = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const p = await findProof(await getSnapshot(), (await params).id);
  return { title: p ? `${p.name} proof of reserves` : "Proof of reserves" };
}

export default async function Page({ params }: P) {
  const s = await getSnapshot();
  const p = await findProof(s, (await params).id);
  if (!p) notFound();
  const h = await proofHistory(s, p);
  return (
    <>
      <DataBridge prov={s.prov} protocols={s.protocols.map(toLite)} signals={s.signals} />
      <MHead back={{ href: "/proof", label: "Proof of reserves" }} eyebrow="Proof of reserves" title={p.name} sub={<Pill t={p.status}>{p.statusText}</Pill>} />
      <div style={{ padding: "0 16px 24px" }}><ProofBody p={p} h={h} origin={SITE} compact /></div>
    </>
  );
}
