import type { Metadata } from "next";
import { Banner } from "@/components/Banner";
import { WatchlistView } from "@/components/sections";
import { DataBridge } from "@/components/providers";
import { getSnapshot } from "@/lib/snapshot";
import { toLite } from "@/lib/view";

export const metadata: Metadata = { title: "Watchlist" };
export const revalidate = 120;

export default async function WatchlistPage() {
  const s = await getSnapshot();
  return (
    <>
      <DataBridge prov={s.prov} protocols={s.protocols.map(toLite)} signals={s.signals} />
      <Banner short crumb={[{ href: "/", label: "Kaspa DeFi" }, { label: "Watchlist" }]} title="Your watchlist"
        lede="Signals that cross your rules right now, from the latest on-chain reads. Rules are saved in this browser. Telegram and email delivery come next." />
      <div className="wrap" style={{ paddingTop: 40 }}><WatchlistView /></div>
    </>
  );
}
