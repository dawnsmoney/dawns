import { allReceipts } from "@/lib/receipts";
import { ReceiptRow } from "@/components/underneath";
import { MMore } from "@/components/m/tabs";
import type { Metadata } from "next";
import { getAssets } from "@/lib/assets";
import { toAssetLite, significant } from "@/lib/assets/view";
import { valueCredible } from "@/lib/assets/types";
import { MCard, MHead, MNote, MStats } from "@/components/m/kit";
import { MAssetList } from "@/components/m/assets";
import { usd } from "@/lib/format";

export const metadata: Metadata = { title: "Assets", description: "Every asset in the Kaspa ecosystem: supply, holders, concentration, liquidity and dawns' reading." };
export const revalidate = 300;

export default async function MAssets() {
  const [all, receipts] = await Promise.all([getAssets(), allReceipts()]);
  const live = all.filter(significant);
  const traded = all.reduce((s, a) => s + (a.standard !== "native" ? a.vol24 ?? 0 : 0), 0);
  const inDefi = all.filter((a) => a.pools.length > 0).length;
  const movers = all.filter((a) => a.price7 && a.price != null && valueCredible(a)).map((a) => ({ a, v: a.price! / a.price7! - 1 })).sort((x, y) => Math.abs(y.v) - Math.abs(x.v))[0];
  return (
    <>
      <MHead eyebrow="Kaspa ecosystem" title="Assets" sub="KAS, KRC-20, covenant tokens, Igra and Kasplex tokens, ZKAS: each identified by chain and contract, never by ticker alone." />
      <div className="m-screen">
        {!all.length ? <MNote>The asset index is being built. It fills on the next data refresh.</MNote> : (
          <>
            <MStats items={[
              { label: "Tracked", value: all.length.toLocaleString("en-US"), sub: `${live.length} active` },
              { label: "Tokens traded 24h", value: usd(traded), sub: `${inDefi} held in DeFi` },
              ...(movers ? [{ label: "Biggest 7-day move", value: `${movers.v >= 0 ? "+" : "−"}${Math.abs(movers.v * 100).toFixed(1)}%`, sub: movers.a.symbol, tone: (movers.v >= 0 ? "good" : "crit") as "good" | "crit" }] : []),
            ]} />
            <MAssetList rows={all.map(toAssetLite)} />
            {receipts.length > 0 && <MCard title="Receipt tokens" tag="what's underneath"><MNote>Claims on something else, listed by what they hold.</MNote><div className="rc-list"><MMore first={5} label="Show all">{receipts.map((r) => <ReceiptRow key={r.id} r={r} />)}</MMore></div></MCard>}
          </>
        )}
      </div>
    </>
  );
}
