import type { Metadata } from "next";
import { ComparePicker, type PickOption } from "@/components/compare";
import { CompareTable } from "@/components/compare-table";
import { getAssets } from "@/lib/assets";
import { significant } from "@/lib/assets/view";
import { CHAIN_NAME, STANDARD_NAME, valueCredible, type Asset } from "@/lib/assets/types";
import { MCard, MHead, MNote } from "@/components/m/kit";

export const metadata: Metadata = { title: "Compare assets" };
const sub = (a: Asset) => (a.standard === "native" ? CHAIN_NAME[a.chain] : `${STANDARD_NAME[a.standard]} · ${CHAIN_NAME[a.chain]}`);

export default async function MCompare({ searchParams }: { searchParams: Promise<{ [k: string]: string | string[] | undefined }> }) {
  const sp = await searchParams;
  const raw = typeof sp.ids === "string" ? sp.ids : Array.isArray(sp.ids) ? sp.ids.join(",") : "";
  const all = await getAssets();
  const byId = new Map(all.map((a) => [a.id, a]));
  const ids = [...new Set(raw.split(",").map((x) => decodeURIComponent(x.trim())).filter((x) => byId.has(x)))].slice(0, 3);
  const picked = ids.map((id) => byId.get(id)!);
  const options: PickOption[] = all.filter(significant)
    .sort((x, y) => (y.liquidity ?? 0) - (x.liquidity ?? 0) || (y.mcap && valueCredible(y) ? y.mcap : 0) - (x.mcap && valueCredible(x) ? x.mcap : 0))
    .map((a, i) => ({ id: a.id, symbol: a.symbol, name: a.name, sub: sub(a), rank: i }));
  return (
    <>
      <MHead back={{ href: "/assets", label: "Assets" }} title="Compare assets" sub="Up to three assets on the same measures. Swipe the table sideways for the third." />
      <div className="m-screen">
        <MCard><ComparePicker options={options} selected={ids} /></MCard>
        {picked.length > 0 && <div className="m-cmp"><CompareTable picked={picked} /></div>}
        {picked.length === 1 && <MNote>Add one or two more assets to compare.</MNote>}
      </div>
    </>
  );
}
