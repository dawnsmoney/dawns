import type { Metadata } from "next";
import { MNavVault } from "@/components/m/nav-vault-mobile";

export const metadata: Metadata = { title: "NAV vault", description: "Deposit KAS from any wallet, get shares at NAV, redeem at NAV. Testnet-10." };
export const revalidate = 30;

export default function Page() {
  return <MNavVault slug="nav-tn10" />;
}
