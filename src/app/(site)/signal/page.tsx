import type { Metadata } from "next";
import { SignalPage } from "@/app/(site)/signal/view";
import { listIssues } from "@/lib/signal";
import { hasDb } from "@/lib/db";

export const revalidate = 300;
export const metadata: Metadata = { title: "The Dawns Signal", description: "Five things that changed in Kaspa DeFi this week, each measured on-chain." };

export default async function Page() {
  const issues = hasDb() ? await listIssues(true, 12).catch(() => []) : [];
  return <SignalPage issue={issues[0] ?? null} archive={issues.map((x) => ({ id: x.id, title: x.data.title }))} />;
}
