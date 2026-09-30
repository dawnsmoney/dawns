import type { Metadata } from "next";
import { Banner } from "@/components/Banner";
import { EarnBody } from "@/components/earn";
import { earnPage } from "@/lib/earn-data";
import { HAVES } from "@/lib/earn";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Earn",
  description: "Earn on KAS, USDC or USDT in Kaspa DeFi, sorted by how soon you may need it back: where each yield comes from, how you leave, and the main risk. Your wallet signs; dawns never holds funds.",
};
type P = { searchParams: Promise<{ [k: string]: string | string[] | undefined }> };

export default async function EarnPage({ searchParams }: P) {
  const d = await earnPage(await searchParams);
  return (
    <>
      <Banner short crumb={[{ label: "Earn" }]} title={`Put your ${HAVES.find((h) => h.key === d.have)!.label} to work. Know how you get out.`}
        lede="Every option is read on-chain by dawns: where its yield comes from, how much could leave today, and what you would be trusting. Your wallet signs each step. dawns never holds your funds." />
      <div className="wrap" style={{ paddingTop: 36 }}>
        <EarnBody have={d.have} win={d.win} options={d.options} excluded={d.excluded} vaults={d.vaults} stamp={d.stamp} />
      </div>
    </>
  );
}
