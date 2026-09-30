import type { Metadata } from "next";
import { NavVaultView } from "@/components/nav-vault";

export const metadata: Metadata = { title: "NAV vault", description: "Deposit KAS from any wallet, get shares at NAV, redeem at NAV. Rules enforced by the Kaspa network. Testnet-10." };
export const revalidate = 30;

export default function Page() {
  return <NavVaultView slug="nav-tn10" />;
}
