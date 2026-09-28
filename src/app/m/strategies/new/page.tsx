import type { Metadata } from "next";
import { getSnapshot } from "@/lib/snapshot";
import { getStrategy, ownerOf } from "@/lib/strategies/store";
import { currentUser } from "@/lib/auth/session";
import { MHead } from "@/components/m/kit";
import { StrategyBuilder } from "@/components/strategy-builder";

export const metadata: Metadata = { title: "Create a strategy" };

export default async function MNewStrategy({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const { from } = await searchParams;
  const [s, g] = await Promise.all([getSnapshot(), from && /^[0-9a-f]{12}$/.test(from) ? getStrategy(from).catch(() => null) : null]);
  const u = g && g.st.by === "strategist" ? await currentUser().catch(() => null) : null;
  const mine = !!u && !!g && u.id === (await ownerOf(g.family.current.id).catch(() => null));
  const base = g && mine ? g.family.current : null;
  const copy = g && !mine ? { ...g.st.doc, name: `${g.st.doc.name} (copy)`.slice(0, 60) } : null;
  return (
    <>
      <MHead back={{ href: "/strategies", label: "Strategies" }} title={base ? `New version of ${base.doc.name}` : "Create a strategy"} sub="Up to four opportunities, one per covenant slot. The bar at the bottom keeps the live result in view." />
      <div className="m-screen">
        <StrategyBuilder opps={s.opportunities} kasUsd={s.kasUsd} from={base ? { id: base.id, version: base.version, doc: base.doc } : null} start={copy} />
      </div>
    </>
  );
}
