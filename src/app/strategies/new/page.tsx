import type { Metadata } from "next";
import { Banner } from "@/components/Banner";
import { StrategyBuilder } from "@/components/strategy-builder";
import { getSnapshot } from "@/lib/snapshot";
import { getStrategy, ownerOf } from "@/lib/strategies/store";
import { currentUser } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Create a strategy",
  description: "Split capital across live Kaspa DeFi opportunities with targets, hard caps, a reserve, pause rules and a fee on yield. dawns checks it against live data as you build.",
};

export default async function NewStrategyPage({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const { from } = await searchParams;
  const [s, g] = await Promise.all([getSnapshot(), from && /^[0-9a-f]{12}$/.test(from) ? getStrategy(from).catch(() => null) : null]);
  // the strategist starts a new version from the version in force; anyone else starts a new strategy from a copy
  const u = g && g.st.by === "strategist" ? await currentUser().catch(() => null) : null;
  const mine = !!u && !!g && u.id === (await ownerOf(g.family.current.id).catch(() => null));
  const base = g && mine ? g.family.current : null;
  const copy = g && !mine ? { ...g.st.doc, name: `${g.st.doc.name} (copy)`.slice(0, 60) } : null;
  return (
    <>
      <Banner short crumb={[{ href: "/strategies", label: "Strategies" }, ...(base ? [{ href: `/strategies/${base.id}`, label: base.doc.name }] : []), { label: base ? `New version` : "New" }]}
        title={base ? `New version of ${base.doc.name}` : "Create a strategy"}
        lede="Up to four opportunities, one per covenant slot. Every number on the right is computed from live on-chain data as you change the left." />
      <div className="wrap" style={{ paddingTop: 40 }}>
        <StrategyBuilder opps={s.opportunities} kasUsd={s.kasUsd} from={base ? { id: base.id, version: base.version, doc: base.doc } : null} start={copy} />
      </div>
    </>
  );
}
