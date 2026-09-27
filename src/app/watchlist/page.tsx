import type { Metadata } from "next";
import { Banner } from "@/components/Banner";
import { WatchlistView } from "@/components/sections";

export const metadata: Metadata = { title: "Watchlist" };

export default function WatchlistPage() {
  return (
    <>
      <Banner short crumb={[{ href: "/", label: "Kaspa DeFi" }, { label: "Watchlist" }]} title="Your watchlist"
        lede="Alerts that fired in the last 48 hours under your rules. Telegram and email delivery connect in the live version." />
      <div className="wrap" style={{ paddingTop: 40 }}><WatchlistView /></div>
    </>
  );
}
