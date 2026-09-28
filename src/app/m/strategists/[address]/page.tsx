import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSnapshot } from "@/lib/snapshot";
import { diffDocs, evaluate } from "@/lib/strategies/model";
import { dailyOf, getStrategist } from "@/lib/strategies/store";
import { MCard, MHead, MList, MNote, MRow, MStats } from "@/components/m/kit";
import { MTabs } from "@/components/m/tabs";
import { ChangeList, NetHistory } from "@/components/strategy";
import { pct } from "@/lib/format";

export const revalidate = 300;
const COLORS = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#9085e9"];
const short = (a: string) => (a === "dawns" ? "Dawns" : `${a.slice(0, 12)}…${a.slice(-5)}`);

export async function generateMetadata({ params }: { params: Promise<{ address: string }> }): Promise<Metadata> {
  return { title: `Strategist ${short(decodeURIComponent((await params).address))}` };
}

export default async function MStrategist({ params }: { params: Promise<{ address: string }> }) {
  const address = decodeURIComponent((await params).address);
  const [v, s] = await Promise.all([getStrategist(address).catch(() => null), getSnapshot()]);
  if (!v) notFound();
  const fams = v.families;
  const changes = fams.flatMap((f) => f.versions.slice(1).map((x, i) => ({ f, x, prev: f.versions[i] })));
  const oname = (opp: string) => s.opportunities.find((o) => o.id === opp)?.name ?? opp;
  const evs = fams.map((f) => ({ f, ev: evaluate(f.current.doc, s.opportunities, s.kasUsd) }));
  const daily = await dailyOf(fams.map((f) => f.current.family));
  const days = [...new Set(daily.map((d) => d.day))].sort();
  const lines = fams.map((f, i) => ({ key: f.current.family, name: f.current.doc.name, color: COLORS[i % COLORS.length], values: days.map((d) => daily.find((x) => x.day === d && x.family === f.current.family)?.net ?? null) }));
  return (
    <>
      <MHead back={{ href: "/strategies", label: "Strategies" }} eyebrow="Strategist" title={short(address)} sub={v.by === "dawns" ? "Reference strategies, written to show how a strategy is checked." : `Publishing since ${v.since}.`} />
      <div className="m-screen">
        <MStats items={[
          { label: "Strategies", value: String(fams.length), sub: `${evs.filter((e) => e.ev.status === "good").length} hold all their rules` },
          { label: "Versions", value: String(fams.reduce((n, f) => n + f.versions.length, 0)), sub: changes.length ? `${changes.length} changes, each after notice` : "no changes yet" },
        ]} />
        <MTabs tabs={[{ key: "s", label: "Strategies", badge: fams.length }, { key: "r", label: "Record" }, { key: "c", label: "Changes", badge: changes.length || null }]}>
          <div className="m-panel">
            <MCard flush><MList>{evs.map(({ f, ev }) => <MRow key={f.current.id} href={`/strategies/${f.current.id}`} title={f.current.doc.name} sub={`v${f.current.version} · ${ev.statusText}`} value={ev.net != null ? pct(ev.net, 1) : "—"} valueSub="net APY" />)}</MList></MCard>
          </div>
          <div className="m-panel">
            <MCard title="Evaluated net APY" tag="daily">
              {days.length ? <NetHistory days={days} lines={lines} /> : <MNote>The first daily reading lands with the next run.</MNote>}
              <MNote>dawns&apos; evaluation of the version in force each day, not realized returns: no vault runs these yet.</MNote>
            </MCard>
          </div>
          <div className="m-panel">
            {changes.length ? changes.reverse().map(({ f, x, prev }) => (
              <MCard key={x.id} title={`${f.current.doc.name} v${prev.version} → v${x.version}`} tag={x.effectiveAt.slice(0, 10)}>
                <ChangeList changes={diffDocs(prev.doc, x.doc, oname)} />
              </MCard>
            )) : <MNote>No strategy has a second version yet.</MNote>}
          </div>
        </MTabs>
      </div>
    </>
  );
}
