import type { Metadata } from "next";
import { Banner } from "@/components/Banner";
import { PioneerBody } from "@/components/pioneer-body";
import { currentUser } from "@/lib/auth/session";
import { hasDb } from "@/lib/db";
import { acceptedFinds, pioneerOf } from "@/lib/pioneer";
import { SITE } from "@/lib/telegram";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Dawns Pioneers", description: "Help map Kaspa DeFi. Explore the market, find emerging opportunities, share what you discover, earn Pioneer points." };

export default async function PioneerPage() {
  const u = hasDb() ? await currentUser().catch(() => null) : null;
  const [me, finds] = await Promise.all([u ? pioneerOf(u.id).catch(() => null) : null, hasDb() ? acceptedFinds().catch(() => []) : []]);
  return (
    <>
      <Banner short crumb={[{ label: "Pioneers" }]} title="Dawns Pioneer Program"
        lede="Help map Kaspa DeFi. Explore the market, find emerging opportunities, share what you discover. Earn Pioneer points." />
      <div className="wrap" style={{ paddingTop: 36 }}><PioneerBody me={me} finds={finds} site={SITE} /></div>
    </>
  );
}
