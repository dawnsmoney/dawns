import type { Metadata } from "next";
import { Banner } from "@/components/Banner";
import { StrategyBuilder } from "@/components/strategy-builder";
import { getSnapshot } from "@/lib/snapshot";

export const metadata: Metadata = {
  title: "Create a strategy",
  description: "Split capital across live Kaspa DeFi opportunities with targets, hard caps, a reserve, pause rules and a fee on yield. dawns checks it against live data as you build.",
};
export const revalidate = 120;

export default async function NewStrategyPage() {
  const s = await getSnapshot();
  return (
    <>
      <Banner short crumb={[{ href: "/strategies", label: "Strategies" }, { label: "New" }]} title="Create a strategy"
        lede="Up to four opportunities, one per covenant slot. Every number on the right is computed from live on-chain data as you change the left." />
      <div className="wrap" style={{ paddingTop: 40 }}>
        <StrategyBuilder opps={s.opportunities} kasUsd={s.kasUsd} />
      </div>
    </>
  );
}
