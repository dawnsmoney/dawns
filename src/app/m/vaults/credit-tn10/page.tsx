import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CreditVaultMobile } from "@/components/m/credit-vault-mobile";
import { getCredit } from "@/lib/vaults/credit";

export const metadata: Metadata = { title: "Credit vault", description: "Loans to named borrowers; repayments only return to the vault; late loans marked down on schedule. Testnet-10." };
export const revalidate = 30;

export default async function MCredit() {
  const { l, m } = await getCredit();
  if (!l || !m) notFound();
  return <CreditVaultMobile l={l} m={m} />;
}
