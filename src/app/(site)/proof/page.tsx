import type { Metadata } from "next";
import { Banner } from "@/components/Banner";
import { ProofIndex } from "@/components/proof";
import { DataBridge } from "@/components/providers";
import { getSnapshot } from "@/lib/snapshot";
import { proofs } from "@/lib/proof";
import { toLite } from "@/lib/view";

export const metadata: Metadata = {
  title: "Proof of reserves",
  description: "Is the money there? Reserves against what users are owed for the Igra bridge and Kaspa DeFi protocols, read on-chain by dawns every few minutes. Nothing is reported by the protocols.",
};
export const revalidate = 120;

export default async function Page() {
  const s = await getSnapshot();
  const list = proofs(s);
  return (
    <>
      <DataBridge prov={s.prov} protocols={s.protocols.map(toLite)} signals={s.signals} />
      <Banner short crumb={[{ href: "/", label: "Kaspa DeFi" }, { label: "Proof of reserves" }]} title="Is the money there?"
        lede="Reserves against what users are owed, for the Igra bridge and every protocol dawns reads on-chain. dawns reads each figure itself, every few minutes: nothing here is reported by the protocols." />
      <div className="wrap" style={{ paddingTop: 34, paddingBottom: 40 }}><ProofIndex list={list} /></div>
    </>
  );
}
