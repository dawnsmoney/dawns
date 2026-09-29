import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CreditVaultDesktop } from "@/components/credit-vault-desktop";
import { getCredit } from "@/lib/vaults/credit";

export const metadata: Metadata = { title: "Credit vault", description: "Loans to named borrowers with repayments that can only return to the vault and late loans marked down on a schedule anyone can enforce. Testnet-10." };
export const revalidate = 30;

export default async function CreditVaultPage() {
  const { l, m } = await getCredit();
  if (!l || !m) notFound();
  return <CreditVaultDesktop l={l} m={m} reference />;
}
