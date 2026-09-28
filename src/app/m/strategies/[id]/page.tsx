import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getSnapshot } from "@/lib/snapshot";
import { evaluate, enforcement, diffDocs, PAUSE } from "@/lib/strategies/model";
import { getStrategy } from "@/lib/strategies/store";
import { splitParts } from "@/lib/strategies/parts";
import { MCard, MFlags, MHead, MHero, MLinkButton, MNote, MStats } from "@/components/m/kit";
import { MTabs } from "@/components/m/tabs";
import { ApyWaterfall, ChangeList, EnforcementMap, ExitStack, LegList, OwnerActions, Roles, VersionTrack } from "@/components/strategy";
import { SplitBar } from "@/components/viz";
import { usd, pct } from "@/lib/format";
import type { Status } from "@/lib/types";

export const revalidate = 120;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const g = await getStrategy((await params).id).catch(() => null);
  return g ? { title: g.st.doc.name, description: g.st.doc.thesis.slice(0, 160) } : { title: "Strategy" };
}

export default async function MStrategy({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [g, s] = await Promise.all([getStrategy(id), getSnapshot()]);
  if (!g) notFound();
  const { st, family } = g;
  const { doc } = st;
  const ev = evaluate(doc, s.opportunities, s.kasUsd);
  const terms = enforcement(doc, ev);
  const oname = (opp: string) => s.opportunities.find((o) => o.id === opp)?.name ?? opp;
  const cur = family.current, next = family.next;
  const changes = st.status === "current" && next ? diffDocs(st.doc, next.doc, oname) : st.status === "scheduled" ? diffDocs(cur.doc, st.doc, oname) : st.status === "superseded" ? diffDocs(st.doc, cur.doc, oname) : [];
  const who = st.by === "dawns" ? "dawns" : st.strategist;
  const bp = (b: number) => `${(b / 100).toFixed(b % 100 ? 1 : 0)}%`;
  const passed = ev.checks.filter((c) => c.ok).length;
  return (
    <>
      <MHead back={{ href: "/strategies", label: "Strategies" }} eyebrow={<><Link href={`/strategists/${who}`} style={{ color: "inherit" }}>{st.by === "dawns" ? "Dawns · reference" : `${st.strategist.slice(0, 12)}…${st.strategist.slice(-4)}`}</Link> · v{st.version}</>}
        title={doc.name} sub={doc.thesis} clamp />
      <div className="m-screen">
        <OwnerActions id={st.id} family={family.versions[0].id} next={next ? { id: next.id, version: next.version } : null} listed={st.listed} />
        {st.status !== "current" && <MFlags flags={[[st.status === "scheduled" ? "warn" : "info", st.status === "scheduled" ? `Not in force yet: takes effect on ${st.effectiveAt.slice(0, 10)}. v${cur.version} applies until then.` : `Superseded: v${cur.version} is in force.`]]} />}
        <MHero label="Expected net APY" value={ev.net != null ? pct(ev.net, 2) : "—"} sub={ev.gross != null ? `${pct(ev.gross, 2)} native − ${bp(doc.fees.performanceBps)} of yield to the strategist` : "legs still measuring"} />
        <MStats items={[
          { label: "Can leave now", value: pct(ev.exitNow, 0), sub: "of a full vault" },
          { label: "Rules", value: `${passed} / ${ev.checks.length}`, sub: ev.statusText, tone: ev.status === "info" ? undefined : ev.status },
          { label: "Capacity", value: `${(doc.vault.capacityKas / 1000).toLocaleString("en-US")}K KAS`, sub: ev.capacityUsd ? usd(ev.capacityUsd) : undefined },
          { label: "Reserve", value: bp(doc.reserveBps), sub: doc.vault.type === "fixed" ? `${doc.vault.termDays}-day term` : "open term" },
        ]} />
        <MTabs tabs={[{ key: "o", label: "Split & yield" }, { key: "l", label: "Legs", badge: doc.legs.length }, { key: "r", label: "Rules", badge: ev.checks.length - passed || null }, { key: "t", label: "Terms" }, { key: "v", label: "Versions", badge: family.versions.length }]}>
          <div className="m-panel">
            <MCard title="Split" tag={`${doc.legs.length} of 4 slots`}><SplitBar parts={splitParts(doc, ev)} label="Strategy split" height={20} /></MCard>
            <MCard title="Expected net APY" tag="native + rewards − fees"><ApyWaterfall ev={ev} /></MCard>
            <MCard title="If everyone left today"><ExitStack doc={doc} ev={ev} /></MCard>
          </div>
          <div className="m-panel"><MCard><LegList doc={doc} ev={ev} /></MCard></div>
          <div className="m-panel">
            <MCard title="Checks" tag={`${passed} of ${ev.checks.length}`}>
              <MFlags flags={ev.checks.map((c) => [c.ok ? "good" : c.t, `${c.label}. ${c.detail}`] as [Status, string])} />
            </MCard>
            <MCard title="Rules that stop new capital">
              <MFlags flags={(Object.keys(PAUSE) as (keyof typeof PAUSE)[]).map((k) => {
                const on = doc.pause.includes(k); const hit = ev.legs.filter((l) => l.paused.includes(k)).map((l) => l.o?.name);
                return [!on ? "info" : hit.length ? "warn" : "good", `${PAUSE[k].label}${!on ? " (off)" : hit.length ? `: pausing ${hit.join(", ")}` : ""}`] as [Status, string];
              })} />
            </MCard>
          </div>
          <div className="m-panel">
            <MCard title="Who enforces each term"><EnforcementMap terms={terms} /></MCard>
            <MCard title="Roles"><Roles strategist={st.by === "dawns" ? "Dawns (reference)" : st.strategist} href={`/strategists/${who}`} /></MCard>
          </div>
          <div className="m-panel">
            <MCard title="Versions" tag={`${doc.noticeDays}-day notice`}>
              <VersionTrack here={st.id} versions={family.versions.map((v) => ({ id: v.id, version: v.version, effectiveAt: v.effectiveAt, createdAt: v.createdAt, status: v.status }))} />
              {changes.length > 0 && <ChangeList changes={changes} />}
              <MNote>A running vault never changes: its terms are its address. A new version applies to vaults launched after it takes effect.</MNote>
            </MCard>
          </div>
        </MTabs>
        <MLinkButton href={`/strategies/new?from=${st.id}`} kind="ghost">Start a strategy from this one</MLinkButton>
      </div>
    </>
  );
}
