import type { Metadata } from "next";
import { getSnapshot } from "@/lib/snapshot";
import { MCard, MHead, MList, MNote, MStats } from "@/components/m/kit";
import { MTabs } from "@/components/m/tabs";
import { MProtocolRow } from "@/components/m/rows";
import { usd } from "@/lib/format";

export const metadata: Metadata = { title: "Protocols", description: "Live health for every Kaspa DeFi protocol on Igra and Kasplex." };
export const revalidate = 120;

export default async function MProtocols() {
  const s = await getSnapshot();
  const all = [...s.protocols].sort((a, b) => b.tvl - a.tvl);
  const groups = [
    { key: "all", label: "All", list: all },
    { key: "lending", label: "Lending", list: all.filter((p) => p.kind === "lending") },
    { key: "dex", label: "DEX", list: all.filter((p) => p.kind === "dex") },
    { key: "other", label: "Other", list: all.filter((p) => p.kind === "other") },
  ].filter((g) => g.list.length);
  const attention = all.filter((p) => p.status !== "good");
  return (
    <>
      <MHead eyebrow="Kaspa DeFi" title="Protocols" sub="Every protocol on Igra and Kasplex, read at the latest block." />
      <div className="m-screen">
        <MStats items={[
          { label: "Value locked", value: usd(s.eco.tvl), sub: `${all.length} protocols` },
          { label: "Need attention", value: String(attention.length), sub: attention.slice(0, 2).map((p) => p.name).join(", ") || "none", tone: attention.length ? "warn" : "good" },
        ]} />
        <MTabs tabs={groups.map((g) => ({ key: g.key, label: g.label, badge: g.list.length }))}>
          {groups.map((g) => (
            <div key={g.key} className="m-panel">
              <MCard flush><MList>{g.list.map((p) => <MProtocolRow key={p.id} p={p} />)}</MList></MCard>
            </div>
          ))}
        </MTabs>
        <MNote>Rows marked with a state other than healthy carry a warning; open one for the reading behind it.</MNote>
      </div>
    </>
  );
}
