import type { Metadata } from "next";
import { getSnapshot } from "@/lib/snapshot";
import { MCard, MHead, MHero, MKv, MList, MNote, MRow, MStats } from "@/components/m/kit";
import { MMore, MTabs } from "@/components/m/tabs";
import { AreaChart } from "@/components/charts";
import { Columns, SplitBar } from "@/components/viz";
import { WatchButton } from "@/components/actions";
import { DataBridge } from "@/components/providers";
import { Fresh } from "@/components/Fresh";
import { toLite } from "@/lib/view";
import { usd, pct } from "@/lib/format";

export const metadata: Metadata = { title: "Igra bridge", description: "Is iKAS fully backed? KAS locked on Kaspa L1 against iKAS on Igra, and every exit." };
export const revalidate = 120;

const kasN = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : n.toFixed(0));
const age = (s: number) => (s < 3600 ? `${Math.max(1, Math.round(s / 60))} min ago` : s < 172_800 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86_400)} days ago`);

export default async function MBridge() {
  const s = await getSnapshot();
  const b = s.bridge;
  const data = <DataBridge prov={s.prov} protocols={s.protocols.map(toLite)} signals={s.signals} />;
  if (!b) return (<>{data}<MHead title="Igra bridge" sub="The bridge could not be read on this run. dawns retries every two minutes." /></>);
  const t = b.coverage >= 1 ? "good" : b.coverage >= 0.99 ? "warn" : "crit";
  const po = b.payouts;
  const pending = po ? po.unpaidKas : b.inWindowKas;
  const now = b.timestamp * 1000;
  const took = b.recentExits.map((e) => (e.paidAt ? (e.paidAt - (now - e.ageSec * 1000)) / 3600_000 : null));
  const cols = [
    { key: "a", label: "<12h", value: took.filter((h) => h != null && h < 12).length, color: "#199e70" },
    { key: "b", label: "12–24", value: took.filter((h) => h != null && h >= 12 && h < 24).length, color: "#199e70" },
    { key: "c", label: "24–48", value: took.filter((h) => h != null && h >= 24 && h < 48).length, color: "#3987e5" },
    { key: "d", label: "48–72", value: took.filter((h) => h != null && h >= 48 && h < 72).length, color: "#c98500" },
    { key: "e", label: ">72h", value: took.filter((h) => h != null && h >= 72).length, color: "#d95926" },
    { key: "w", label: "Wait", value: b.recentExits.filter((e) => !e.paidTx).length, color: "#4A4270" },
  ];
  return (
    <>
      {data}
      <MHead eyebrow={<>Kaspa L1 ⇄ Igra · <Fresh since={b.timestamp * 1000} /></>} title="Igra bridge" right={<WatchButton id="igra-bridge" />}
        sub="Is every iKAS on Igra backed by KAS locked on Kaspa L1?" />
      <div className="m-screen">
        <MHero label="Backing" value={pct(b.coverage, 2)} tone={t} sub={b.coverage >= 1 ? `${kasN(b.surplusKas)} KAS more locked than iKAS issued` : `${kasN(-b.surplusKas)} KAS short`} />
        <MStats items={[
          { label: "KAS locked on L1", value: kasN(b.lockedKas), sub: s.kasUsd ? usd(b.lockedKas * s.kasUsd) : undefined },
          { label: "iKAS on Igra", value: kasN(b.ikasSupply) },
          { label: "Exits awaiting payout", value: `${kasN(pending)} KAS`, sub: po ? `${po.unpaid} exits` : `${b.inWindowCount} in 72 h` },
          { label: "Typical payout", value: po?.medianHours != null ? `${Math.round(po.medianHours)} h` : "—", sub: po?.late ? `${po.late} late` : "median, recent exits", tone: po?.late ? "warn" : undefined },
        ]} />
        <MTabs tabs={[{ key: "b", label: "Backing" }, { key: "e", label: "Exits", badge: b.recentExits.length }, { key: "r", label: "Rules" }]}>
          <div className="m-panel">
            <MCard title="Locked KAS">
              <SplitBar label="Locked KAS" height={20} parts={[
                { key: "ikas", label: "Backs iKAS", color: "#3987e5", share: Math.min(b.ikasSupply, b.lockedKas) },
                ...(b.surplusKas > 0 ? [{ key: "exits", label: "Exits awaiting payout", color: "#c98500", share: Math.min(pending, b.surplusKas) }, { key: "extra", label: "Surplus", color: "#199e70", share: Math.max(0, b.surplusKas - pending) }] : []),
              ].filter((x) => x.share > 0)} />
            </MCard>
            {b.history && b.history.length > 2 && (
              <MCard title="Backing ratio" tag="hourly">
                <AreaChart series={[{ name: "Backing", color: "#4ADE9B", values: b.history.map((x) => x.v) }]} dates={b.history.map((x) => x.t)} label="Backing ratio" fmt="pct" height={170} hourly refLine={1} refLabel="100%" />
              </MCard>
            )}
          </div>
          <div className="m-panel">
            <MCard title="How long payouts took" tag="recent exits">
              <Columns cols={cols} label="Exits by payout time" />
            </MCard>
            <MCard title="Recent exits" flush>
              <MList>
                <MMore first={8} label="All recent exits">
                  {b.recentExits.map((e) => (
                    <MRow key={e.id} href={e.tx ? `https://explorer.igralabs.com/tx/${e.tx}` : undefined} ext title={`${kasN(e.kas)} KAS`} sub={`Exit #${e.id} · ${age(e.ageSec)}`}
                      pill={e.paidTx ? { t: "good", text: "Paid on L1" } : { t: e.ageSec > 72 * 3600 ? "crit" : "info", text: e.ageSec > 72 * 3600 ? "Late" : "Waiting" }} />
                  ))}
                </MMore>
              </MList>
            </MCard>
          </div>
          <div className="m-panel">
            <MCard title="Bridge rules" tag="read on-chain">
              <MKv rows={[
                ["Exit size", `${kasN(b.config.minExitKas)} – ${kasN(b.config.maxExitKas)} KAS`],
                ["Exits per window", `${b.config.maxExitsPerWindow} (${b.throttle.remainingExits} left)`],
                ["Unlock per window", `${kasN(b.config.maxUnlockPerWindowKas)} KAS (${kasN(b.throttle.remainingUnlockKas)} left)`],
                ["Owner", b.ownerIsContract ? "a contract" : "a single key"],
                ["Exits so far", b.exitsTotal.toLocaleString("en-US")],
              ]} />
            </MCard>
            <MNote>Exits are paid on Kaspa L1 by the bridge&apos;s guardians, usually within 48–72 hours; dawns matches each exit to its L1 payout.</MNote>
          </div>
        </MTabs>
      </div>
    </>
  );
}
