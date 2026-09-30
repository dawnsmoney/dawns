import type { Metadata } from "next";
import { MNavVault } from "@/components/m/nav-vault-mobile";

export const metadata: Metadata = { title: "Demo vault", description: "A dawns demo on an accelerated clock: a NAV vault lending 60% through a credit vault to test borrowers. Testnet-10." };
export const revalidate = 30;

export default function Page() {
  return <MNavVault slug="demo-tn10" />;
}
