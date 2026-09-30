import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Banner } from "@/components/Banner";
import { Pill } from "@/components/bits";
import { ProofBody } from "@/components/proof";
import { DataBridge } from "@/components/providers";
import { getSnapshot } from "@/lib/snapshot";
import { proofHeadline } from "@/lib/proof";
import { findProof } from "@/lib/proof-vaults";
import { proofHistory } from "@/lib/proof-history";
import { toLite } from "@/lib/view";
import { SITE } from "@/lib/telegram";

export const revalidate = 120;
type P = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const p = await findProof(await getSnapshot(), (await params).id);
  if (!p) return { title: "Proof of reserves" };
  const hl = proofHeadline(p);
  return { title: `${p.name} proof of reserves`, description: `${hl.label} ${hl.value}: ${p.reservesLabel.toLowerCase()} against ${p.owedLabel.toLowerCase()}, read on-chain by dawns every few minutes, with every source listed.` };
}

export default async function Page({ params }: P) {
  const s = await getSnapshot();
  const p = await findProof(s, (await params).id);
  if (!p) notFound();
  const h = await proofHistory(s, p);
  return (
    <>
      <DataBridge prov={s.prov} protocols={s.protocols.map(toLite)} signals={s.signals} />
      <Banner short crumb={[{ href: "/", label: "Kaspa DeFi" }, { href: "/proof", label: "Proof of reserves" }, { label: p.name }]} title={<>{p.name}<span className="prf-title-sub"> · proof of reserves</span></>}
        lede={p.kind === "vault" ? "A dawns vault on testnet, read from the chain by the same code as every protocol. Its own ledger is checked, not trusted." : `Read from the chain by dawns, not reported by ${p.kind === "bridge" ? "the bridge operators" : p.name}.`}>
        <div className="tags" style={{ marginTop: 16 }}><Pill t={p.status}>{p.statusText}</Pill><a className="btn glass sm" href="#badge">Get the badge</a></div>
      </Banner>
      <div className="wrap" style={{ paddingBottom: 40 }}><ProofBody p={p} h={h} origin={SITE} /></div>
    </>
  );
}
