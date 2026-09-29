import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { CreditVaultMobile } from "@/components/m/credit-vault-mobile";
import { getCreditById } from "@/lib/vaults/credit";

export const revalidate = 30;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const v = await getCreditById((await params).id).catch(() => null);
  return v ? { title: v.m.name } : { title: "Credit vault" };
}

export default async function MLaunchedCreditVault({ params }: { params: Promise<{ id: string }> }) {
  const v = await getCreditById((await params).id);
  if (!v) notFound();
  if (v.reference) redirect("/vaults/credit-tn10");
  return <CreditVaultMobile l={v.l} m={v.m} />;
}
