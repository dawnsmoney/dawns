import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MANAGERS, trackRecord } from "@/lib/vaults/registry";
import { MCard, MFlags, MHead, MList, MRow, MStats } from "@/components/m/kit";
import { MTabs } from "@/components/m/tabs";
import { Compare } from "@/components/viz";
import type { Status } from "@/lib/types";

export const revalidate = 60;
export function generateStaticParams() { return MANAGERS.map((m) => ({ id: m.id })); }
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const m = MANAGERS.find((x) => x.id === id);
  return m ? { title: `${m.name} · manager` } : {};
}
const kas = (x: number) => `${x.toLocaleString("en-US", { maximumFractionDigits: 2 })} KAS`;
const short = (s: string) => (s.length > 22 ? `${s.slice(0, 12)}…${s.slice(-6)}` : s);

export default async function MManager({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const m = MANAGERS.find((x) => x.id === id);
  if (!m) notFound();
  const t = await trackRecord(m.id);
  const done = m.checks.filter((c) => c[1]).length;
  return (
    <>
      <MHead back={{ href: "/managers", label: "Managers" }} eyebrow={m.kind} title={m.name} sub={m.about} />
      <div className="m-screen">
        <MStats items={[
          { label: "Vaults", value: String(t.vaults.length), sub: `${t.live} live` },
          { label: "Moves", value: String(t.moves), sub: "accepted by the network" },
          { label: "Refused", value: String(t.refusals), sub: "rule-breaking attempts" },
          { label: "NAV per share", value: t.navReturn == null ? "—" : `${t.navReturn >= 0 ? "+" : "−"}${(Math.abs(t.navReturn) * 100).toFixed(2)}%`, sub: "since launch" },
        ]} />
        <MTabs tabs={[{ key: "c", label: "Checks", badge: `${done}/${m.checks.length}` }, { key: "v", label: "Vaults", badge: t.vaults.length }, { key: "k", label: "Keys" }]}>
          <div className="m-panel">
            <MCard title="What dawns has checked"><MFlags flags={m.checks.map(([c, ok]) => [ok ? "good" : "warn", c] as [Status, string])} /></MCard>
            <MCard title="Capital sent and returned"><Compare a={{ label: "Sent out", value: t.sent, display: kas(t.sent) }} b={{ label: "Returned", value: t.back, display: kas(t.back) }} /></MCard>
          </div>
          <div className="m-panel">
            <MCard flush><MList>{t.vaults.map((v) => <MRow key={v.id} href={v.href ?? undefined} title={v.name} sub={v.pitch} pill={{ t: v.status === "live" ? "good" : "info", text: v.status === "live" ? "Live" : v.status === "ready" ? "Launching" : "Designed" }} />)}</MList></MCard>
          </div>
          <div className="m-panel">
            <MCard flush><MList>{t.keys.map((k) => <MRow key={k.vault + k.role} title={k.role} sub={k.vault} value={<span className="mono" style={{ fontSize: 12 }}>{short(k.address)}</span>} />)}</MList></MCard>
          </div>
        </MTabs>
      </div>
    </>
  );
}
