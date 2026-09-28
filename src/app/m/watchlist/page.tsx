import type { Metadata } from "next";
import { WatchlistView } from "@/components/sections";
import { DataBridge } from "@/components/providers";
import { getSnapshot } from "@/lib/snapshot";
import { toLite } from "@/lib/view";
import { MHead } from "@/components/m/kit";

export const metadata: Metadata = { title: "Watchlist" };
export const revalidate = 120;

export default async function MWatchlist() {
  const s = await getSnapshot();
  return (
    <>
      <DataBridge prov={s.prov} protocols={s.protocols.map(toLite)} signals={s.signals} />
      <MHead title="Your watchlist" sub="Signals that cross your rules right now, from the latest on-chain reads. Alerts can go to Telegram." />
      <div className="m-screen"><WatchlistView /></div>
    </>
  );
}
