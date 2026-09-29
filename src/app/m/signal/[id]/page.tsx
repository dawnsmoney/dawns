import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SignalPage } from "@/app/m/signal/view";
import { getIssue, listIssues } from "@/lib/signal";
import { hasDb } from "@/lib/db";

export const revalidate = 300;
type P = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const i = hasDb() ? await getIssue((await params).id).catch(() => null) : null;
  return i?.status === "published" ? { title: i.data.title, description: i.data.items.map((x) => x.head).join(" · ").slice(0, 200) } : { title: "The Dawns Signal" };
}

export default async function Page({ params }: P) {
  const id = (await params).id;
  if (!/^\d{4}-W\d{2}$/.test(id) || !hasDb()) notFound();
  const [issue, all] = await Promise.all([getIssue(id), listIssues(true, 12)]);
  if (!issue || issue.status !== "published") notFound();
  return <SignalPage issue={issue} archive={all.map((x) => ({ id: x.id, title: x.data.title }))} />;
}
