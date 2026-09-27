import type { Metadata } from "next";
import { Banner } from "@/components/Banner";
import { ProtocolList } from "@/components/sections";
import { PROTOCOLS } from "@/lib/data";

export const metadata: Metadata = { title: "Protocols" };

export default function ProtocolsPage() {
  return (
    <>
      <Banner short crumb={[{ href: "/", label: "Kaspa DeFi" }, { label: "Protocols" }]} title="Protocols"
        lede={`${PROTOCOLS.length} protocols on Kaspa, sorted by value locked. Protocols under $10K get balance tracking only.`} />
      <section className="wrap" style={{ paddingTop: 40 }}><ProtocolList /></section>
    </>
  );
}
