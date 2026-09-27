import type { Metadata } from "next";
import { Banner } from "@/components/Banner";
import { ProtocolList } from "@/components/sections";
import { DataBridge } from "@/components/providers";
import { getSnapshot } from "@/lib/snapshot";
import { toLite, toRow } from "@/lib/view";
import { usd } from "@/lib/format";

export const metadata: Metadata = { title: "Protocols" };
export const revalidate = 120;

export default async function ProtocolsPage() {
  const s = await getSnapshot();
  const onchain = s.protocols.filter((p) => p.source === "onchain").length;
  return (
    <>
      <DataBridge prov={s.prov} protocols={s.protocols.map(toLite)} signals={s.signals} />
      <Banner short crumb={[{ href: "/", label: "Kaspa DeFi" }, { label: "Protocols" }]} title="Protocols"
        lede={`${s.protocols.length} protocols on Igra and Kasplex, ${usd(s.eco.tvl)} in total. dawns reads ${onchain} of them directly on-chain; the rest come from DefiLlama until their contracts are mapped.`} />
      <section className="wrap" style={{ paddingTop: 40 }}><ProtocolList rows={s.protocols.map(toRow)} /></section>
    </>
  );
}
