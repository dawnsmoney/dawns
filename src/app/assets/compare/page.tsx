import type { Metadata } from "next";
import { Banner } from "@/components/Banner";
import { ComparePicker, type PickOption } from "@/components/compare";
import { CompareTable } from "@/components/compare-table";
import { getAssets } from "@/lib/assets";
import { significant } from "@/lib/assets/view";
import { CHAIN_NAME, STANDARD_NAME, valueCredible, type Asset } from "@/lib/assets/types";

export const metadata: Metadata = { title: "Compare assets", description: "Two or three Kaspa-ecosystem assets side by side: market, holders, depth, supply and dawns' reading." };

type P = { searchParams: Promise<{ [k: string]: string | string[] | undefined }> };
const sub = (a: Asset) => (a.standard === "native" ? CHAIN_NAME[a.chain] : `${STANDARD_NAME[a.standard]} · ${CHAIN_NAME[a.chain]}`);

export default async function ComparePage({ searchParams }: P) {
  const sp = await searchParams;
  const raw = typeof sp.ids === "string" ? sp.ids : Array.isArray(sp.ids) ? sp.ids.join(",") : "";
  const all = await getAssets();
  const byId = new Map(all.map((a) => [a.id, a]));
  const ids = [...new Set(raw.split(",").map((x) => decodeURIComponent(x.trim())).filter((x) => byId.has(x)))].slice(0, 3);
  const picked = ids.map((id) => byId.get(id)!);
  const options: PickOption[] = all.filter(significant)
    .sort((x, y) => (y.liquidity ?? 0) - (x.liquidity ?? 0) || (y.mcap && valueCredible(y) ? y.mcap : 0) - (x.mcap && valueCredible(x) ? x.mcap : 0) || (y.holders ?? 0) - (x.holders ?? 0))
    .map((a, i) => ({ id: a.id, symbol: a.symbol, name: a.name, sub: sub(a), rank: i }));

  return (
    <>
      <Banner short crumb={[{ href: "/assets", label: "Assets" }, { label: "Compare" }]} title="Compare assets"
        lede="Up to three assets side by side, on the same measures. Bars compare within a row; the longest bar is the largest." />
      <div className="wrap" style={{ paddingTop: 40, display: "grid", gap: 28 }}>
        <div className="card"><ComparePicker options={options} selected={ids} /></div>

        {picked.length > 0 && <CompareTable picked={picked} />}
        {picked.length === 1 && <p className="muted" style={{ margin: 0 }}>Add one or two more assets to compare.</p>}
      </div>
    </>
  );
}
