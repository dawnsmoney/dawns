import type { Metadata } from "next";
import { MHead } from "@/components/m/kit";
import { PioneerBody } from "@/components/pioneer-body";
import { currentUser } from "@/lib/auth/session";
import { hasDb } from "@/lib/db";
import { acceptedFinds, pioneerOf } from "@/lib/pioneer";
import { SITE } from "@/lib/telegram";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Dawns Pioneers" };

export default async function MPioneerPage() {
  const u = hasDb() ? await currentUser().catch(() => null) : null;
  const [me, finds] = await Promise.all([u ? pioneerOf(u.id).catch(() => null) : null, hasDb() ? acceptedFinds().catch(() => []) : []]);
  return (
    <>
      <MHead eyebrow="Kaspa DeFi" title="Dawns Pioneers" sub="Early users who help map Kaspa DeFi, and earn points for it." />
      <div style={{ padding: "0 16px 24px" }}><PioneerBody me={me} finds={finds} site={SITE} /></div>
    </>
  );
}
