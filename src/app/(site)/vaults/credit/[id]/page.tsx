import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { CreditVaultDesktop } from "@/components/credit-vault-desktop";
import { getCreditById } from "@/lib/vaults/credit";

export const revalidate = 30;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const v = await getCreditById((await params).id).catch(() => null);
  return v ? { title: v.m.name, description: v.m.objective.slice(0, 160) } : { title: "Credit vault" };
}

/** A credit vault launched from a strategy, by its covenant id. */
export default async function LaunchedCreditVault({ params }: { params: Promise<{ id: string }> }) {
  const v = await getCreditById((await params).id);
  if (!v) notFound();
  if (v.reference) redirect("/vaults/credit-tn10");
  return <CreditVaultDesktop l={v.l} m={v.m} reference={false} />;
}
