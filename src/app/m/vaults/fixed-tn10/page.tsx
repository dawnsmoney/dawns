import type { Metadata } from "next";
import { MNavVault } from "@/components/m/nav-vault-mobile";

export const metadata: Metadata = { title: "Fixed-term vault", description: "Deposit while the window is open, redeem at NAV from maturity. Testnet-10." };
export const revalidate = 30;

export default function Page() {
  return <MNavVault slug="fixed-tn10" />;
}
