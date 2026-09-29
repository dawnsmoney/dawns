import type { Metadata } from "next";
import { Banner } from "@/components/Banner";
import { TestBody } from "@/components/test-body";
import { currentUser } from "@/lib/auth/session";
import { hasDb } from "@/lib/db";
import { progressOf } from "@/lib/testing";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Test dawns", description: "dawns' vaults are live on Kaspa testnet-10. Test KAS has no value: try a deposit and a withdrawal, and tell us what broke." };

export default async function TestPage() {
  const u = hasDb() ? await currentUser().catch(() => null) : null;
  const progress = u ? await progressOf(u.id).catch(() => null) : null;
  return (
    <>
      <Banner short crumb={[{ href: "/pioneer", label: "Pioneers" }, { label: "Test" }]} title="Test dawns"
        lede="dawns' vaults are live on Kaspa testnet-10. Test KAS has no value, so nothing here can cost you money. Walk the path; every step ticks itself. Anything broken or confusing is exactly what we need." />
      <div className="wrap" style={{ paddingTop: 36 }}><TestBody progress={progress} /></div>
    </>
  );
}
