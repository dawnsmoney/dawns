import type { Metadata } from "next";
import { MHead } from "@/components/m/kit";
import { EarnBody } from "@/components/earn";
import { earnPage } from "@/lib/earn-data";
import { HAVES } from "@/lib/earn";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Earn" };
type P = { searchParams: Promise<{ [k: string]: string | string[] | undefined }> };

export default async function MEarnPage({ searchParams }: P) {
  const d = await earnPage(await searchParams);
  return (
    <>
      <MHead eyebrow="Earn" title={`Put your ${HAVES.find((h) => h.key === d.have)!.label} to work`} sub="Know how you get out. Your wallet signs; dawns never holds your funds." />
      <div style={{ padding: "0 16px 24px" }}>
        <EarnBody have={d.have} win={d.win} options={d.options} excluded={d.excluded} vaults={d.vaults} stamp={d.stamp} />
      </div>
    </>
  );
}
