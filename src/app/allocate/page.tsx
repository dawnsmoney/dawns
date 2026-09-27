import type { Metadata } from "next";
import { Banner } from "@/components/Banner";
import { DataBridge } from "@/components/providers";
import { Allocator } from "@/components/allocator";
import { getSnapshot } from "@/lib/snapshot";
import { toLite } from "@/lib/view";

export const metadata: Metadata = {
  title: "Allocate",
  description: "Tell dawns your risk and how fast you may need your money back. It suggests a split across Kaspa DeFi, with a reason for every line. Advisory only.",
};
export const revalidate = 120;

export default async function AllocatePage() {
  const s = await getSnapshot();
  return (
    <>
      <DataBridge prov={s.prov} protocols={s.protocols.map(toLite)} signals={s.signals} />
      <Banner short crumb={[{ href: "/opportunities", label: "Opportunities" }, { label: "Allocate · Beta" }]} title="Build an allocation"
        lede="Your risk, your exit window, your amount. dawns suggests a split across live Kaspa DeFi opportunities and explains every line. Advisory only: nothing moves unless you move it." />
      <div className="wrap" style={{ paddingTop: 40 }}>
        <Allocator opps={s.opportunities} />
      </div>
    </>
  );
}
