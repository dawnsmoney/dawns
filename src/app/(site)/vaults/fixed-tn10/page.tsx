import type { Metadata } from "next";
import { NavVaultView } from "@/components/nav-vault";

export const metadata: Metadata = { title: "Fixed-term vault", description: "Deposit KAS while the window is open, get shares at NAV, redeem at NAV from maturity. Both dates enforced by the Kaspa network. Testnet-10." };
export const revalidate = 30;

export default function Page() {
  return <NavVaultView slug="fixed-tn10" />;
}
