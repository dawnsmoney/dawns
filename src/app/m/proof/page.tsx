import type { Metadata } from "next";
import { MHead } from "@/components/m/kit";
import { ProofIndex } from "@/components/proof";
import { getSnapshot } from "@/lib/snapshot";
import { proofs } from "@/lib/proof";

export const metadata: Metadata = { title: "Proof of reserves", description: "Reserves against what users are owed, read on-chain by dawns every few minutes." };
export const revalidate = 120;

export default async function Page() {
  const s = await getSnapshot();
  return (
    <>
      <MHead eyebrow="Proof of reserves" title="Is the money there?" sub="Reserves against what users are owed, read on-chain by dawns. Nothing is reported by the protocols." />
      <div style={{ padding: "0 16px 24px" }}><ProofIndex list={proofs(s)} /></div>
    </>
  );
}
