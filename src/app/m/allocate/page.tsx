import type { Metadata } from "next";
import { Allocator } from "@/components/allocator";
import { DataBridge } from "@/components/providers";
import { getSnapshot } from "@/lib/snapshot";
import { toLite } from "@/lib/view";
import { MHead } from "@/components/m/kit";

export const metadata: Metadata = { title: "Allocate" };
export const revalidate = 120;

export default async function MAllocate() {
  const s = await getSnapshot();
  return (
    <>
      <DataBridge prov={s.prov} protocols={s.protocols.map(toLite)} signals={s.signals} />
      <MHead back={{ href: "/opportunities", label: "Yield" }} eyebrow="Advisory only" title="Build a portfolio" sub="Your amount, your risk, your exit window. dawns proposes a split and checks it against every rule." />
      <div className="m-screen"><Allocator opps={s.opportunities} kasUsd={s.kasUsd} /></div>
    </>
  );
}
