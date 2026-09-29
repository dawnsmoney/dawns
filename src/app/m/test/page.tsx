import type { Metadata } from "next";
import { MHead } from "@/components/m/kit";
import { TestBody } from "@/components/test-body";
import { currentUser } from "@/lib/auth/session";
import { hasDb } from "@/lib/db";
import { progressOf } from "@/lib/testing";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Test dawns" };

export default async function MTestPage() {
  const u = hasDb() ? await currentUser().catch(() => null) : null;
  const progress = u ? await progressOf(u.id).catch(() => null) : null;
  return (
    <>
      <MHead eyebrow="Testnet-10" title="Test dawns" sub="Test KAS has no value: nothing here can cost you money. Every step ticks itself." />
      <div style={{ padding: "0 16px 24px" }}><TestBody progress={progress} /></div>
    </>
  );
}
