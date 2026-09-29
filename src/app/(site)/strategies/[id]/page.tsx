import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Banner } from "@/components/Banner";
import { Pill } from "@/components/bits";
import { CopyId, SplitBar } from "@/components/viz";
import { ApyWaterfall, ChangeList, EnforcementMap, ExitStack, LegList, OwnerActions, Roles, VersionTrack } from "@/components/strategy";
import { splitParts } from "@/lib/strategies/parts";
import { getSnapshot } from "@/lib/snapshot";
import { evaluate, enforcement, toMandate, diffDocs, PAUSE } from "@/lib/strategies/model";
import { getStrategy } from "@/lib/strategies/store";
import { usd, pct } from "@/lib/format";

export const revalidate = 120;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const g = await getStrategy((await params).id).catch(() => null);
  return g ? { title: `${g.st.doc.name}${g.family.versions.length > 1 ? ` v${g.st.version}` : ""}`, description: g.st.doc.thesis.slice(0, 160) } : { title: "Strategy" };
}

export default async function StrategyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [g, s] = await Promise.all([getStrategy(id), getSnapshot()]);
  if (!g) notFound();
  const { st, family } = g;
  const { doc } = st;
  const oname = (opp: string) => s.opportunities.find((o) => o.id === opp)?.name ?? opp;
  const cur = family.current, next = family.next;
  // what this page should explain: the change to come, or how this version differs from the one in force
  const cmp = st.status === "current" && next ? { a: st, b: next, head: `v${next.version} takes effect on ${next.effectiveAt.slice(0, 10)}` }
    : st.status !== "current" ? { a: cur, b: st, head: st.status === "scheduled" ? `This version takes effect on ${st.effectiveAt.slice(0, 10)}. Until then v${cur.version} is in force.` : `Superseded. v${cur.version} is in force: here is what changed since this version.` } : null;
  const changes = cmp ? (st.status === "superseded" ? diffDocs(st.doc, cur.doc, oname) : diffDocs(cmp.a.doc, cmp.b.doc, oname)) : [];
  const who = st.by === "dawns" ? "dawns" : st.strategist;
  const ev = evaluate(doc, s.opportunities, s.kasUsd);
  const terms = enforcement(doc, ev);
  const mandate = toMandate(doc, st.hash);
  const passed = ev.checks.filter((c) => c.ok).length;
  const offL1 = ev.legs.some((l) => l.o?.chain === "igra" || l.o?.chain === "kasplex");
  const bp = (b: number) => `${(b / 100).toFixed(b % 100 ? 1 : 0)}%`;
  const tile = (label: string, big: string, small: string, color?: string) => (
    <div className="card st-tile"><span className="eyebrow muted">{label}</span><b style={color ? { color } : undefined}>{big}</b><small className="muted">{small}</small></div>
  );
  return (
    <>
      <Banner short crumb={[{ href: "/strategies", label: "Strategies" }, { href: `/strategists/${who}`, label: st.by === "dawns" ? "Dawns · reference" : `${st.strategist.slice(0, 12)}…${st.strategist.slice(-4)}` }, { label: `v${st.version}` }]} title={doc.name} lede={doc.thesis} />
      <div className="wrap" style={{ paddingTop: 40, display: "grid", gap: 28 }}>
        <OwnerActions id={st.id} family={family.versions[0].id} next={next ? { id: next.id, version: next.version } : null} listed={st.listed} />
        <div className={`card st-vcard ${st.status}`}>
          <div className="c-head"><h3>Versions</h3><span className="tag">{doc.noticeDays}-day notice before any new version</span></div>
          <VersionTrack here={st.id} versions={family.versions.map((v) => ({ id: v.id, version: v.version, effectiveAt: v.effectiveAt, createdAt: v.createdAt, status: v.status }))} />
          {cmp && (
            <div className="st-vdiff">
              <p style={{ margin: 0 }}><b>{cmp.head}</b></p>
              <div className="grid g2" style={{ gap: 18 }}>
                <div><small className="muted">{st.status === "superseded" ? `v${st.version} (this page)` : `v${cmp.a.version} · in force`}</small><SplitBar label="Before" height={14} tip={false} legend={false} parts={splitParts(st.status === "superseded" ? st.doc : cmp.a.doc, evaluate(st.status === "superseded" ? st.doc : cmp.a.doc, s.opportunities, s.kasUsd))} /></div>
                <div><small className="muted">{st.status === "superseded" ? `v${cur.version} · in force` : `v${cmp.b.version} · ${cmp.b.status}`}</small><SplitBar label="After" height={14} tip={false} legend={false} parts={splitParts(st.status === "superseded" ? cur.doc : cmp.b.doc, evaluate(st.status === "superseded" ? cur.doc : cmp.b.doc, s.opportunities, s.kasUsd))} /></div>
              </div>
              <ChangeList changes={changes} />
              <small className="muted">A running vault never changes: its terms are its address. A new version applies to vaults launched after it takes effect; depositors of an older vault move only if they choose to.</small>
            </div>
          )}
        </div>
        <div className="grid st-tiles">
          {tile("Expected net APY", ev.net != null ? pct(ev.net, 2) : "—", ev.gross != null ? `${pct(ev.gross, 2)} native − ${bp(doc.fees.performanceBps)} of yield to the strategist` : "Legs still measuring")}
          {tile("Can leave now", pct(ev.exitNow, 0), `of a full vault: reserve, withdrawable lending cash and pools`)}
          {tile("Capacity", `${doc.vault.capacityKas.toLocaleString("en-US")} KAS`, ev.capacityUsd ? `${usd(ev.capacityUsd)} at today's KAS price` : "KAS price unavailable")}
          {tile("Rules", `${passed} / ${ev.checks.length}`, ev.statusText, ev.status === "crit" ? "var(--crit)" : ev.status === "warn" ? "var(--warn)" : "var(--good)")}
        </div>

        <div className="grid g2">
          <div className="card">
            <div className="c-head"><h3>Split</h3><span className="tag">{doc.legs.length} of 4 slots · {bp(doc.reserveBps)} reserve</span></div>
            <SplitBar parts={splitParts(doc, ev)} label="Strategy split" />
          </div>
          <div className="card">
            <div className="c-head"><h3>Expected net APY</h3><span className="tag">native + rewards − fees</span></div>
            <ApyWaterfall ev={ev} />
          </div>
        </div>

        <div className="card">
          <div className="c-head"><h3>Legs</h3><span className="tag">live, from the opportunities dawns reads on-chain</span></div>
          <LegList doc={doc} ev={ev} />
        </div>

        <div className="grid g2">
          <div className="card">
            <div className="c-head"><h3>If everyone left today</h3><span className="tag">full capacity</span></div>
            <ExitStack doc={doc} ev={ev} />
            <p className="muted" style={{ fontSize: 13.5, margin: "14px 0 0" }}>
              {doc.vault.type === "fixed" ? `Fixed term: no redemptions for ${doc.vault.termDays} days, deposits for the first ${doc.vault.depositDays}.` : doc.vault.redemptionDays ? `The reserve pays at once; the rest within ${doc.vault.redemptionDays} days, after the allocator recalls.` : "The reserve pays at once; the rest waits for the allocator to recall."}
            </p>
          </div>
          <div className="card">
            <div className="c-head"><h3>Checks</h3><Pill t={ev.status}>{ev.statusText}</Pill></div>
            <div className="st-checks">
              {ev.checks.map((c) => (
                <div key={c.key} className={`st-check ${c.ok ? "ok" : c.t}`}><i aria-hidden>{c.ok ? "✓" : c.t === "crit" ? "✕" : "!"}</i><span><b>{c.label}</b><small>{c.detail}</small></span></div>
              ))}
            </div>
          </div>
        </div>

        <div className="grid g2">
          <div className="card">
            <div className="c-head"><h3>Rules that stop new capital</h3><span className="tag">per leg, checked every snapshot</span></div>
            <div className="st-checks">
              {(Object.keys(PAUSE) as (keyof typeof PAUSE)[]).map((k) => {
                const on = doc.pause.includes(k);
                const hit = ev.legs.filter((l) => l.paused.includes(k)).map((l) => l.name);
                return <div key={k} className={`st-check ${!on ? "off" : hit.length ? "warn" : "ok"}`}><i aria-hidden>{!on ? "–" : hit.length ? "!" : "✓"}</i><span><b>{PAUSE[k].label}{!on ? " · off" : hit.length ? ` · pausing ${hit.join(", ")}` : ""}</b><small>{PAUSE[k].why}</small></span></div>;
              })}
              <div className="st-check ok"><i aria-hidden>↻</i><span><b>Rebalance at {bp(doc.driftBps)} drift</b><small>At most {bp(doc.maxProtocolBps)} in one protocol; lending legs covered {doc.exitCover}× by the market&apos;s cash.</small></span></div>
            </div>
          </div>
          <div className="card">
            <div className="c-head"><h3>Exposure</h3><span className="tag">by protocol · by asset</span></div>
            <div style={{ display: "grid", gap: 20 }}>
              <SplitBar label="By protocol" height={18} parts={ev.byProtocol.map((p, i) => ({ key: p.id, label: p.name, color: ["#4F8EE0", "#D17A30", "#2FA88F", "#8578E6"][i % 4], share: p.share }))} />
              <SplitBar label="By asset" height={18} parts={ev.byAsset.map((a, i) => ({ key: a.sym, label: a.sym, color: ["#2FA88F", "#4F8EE0", "#8578E6", "#D55A7C", "#D17A30", "#6E6788"][Math.min(i, 5)], share: a.share }))} />
            </div>
          </div>
        </div>

        <div className="card">
          <div className="c-head"><h3>Who enforces each term</h3><span className="tag">a stated term is not a guarantee</span></div>
          <EnforcementMap terms={terms} />
        </div>

        <div className="card">
          <div className="c-head"><h3>Roles</h3><span className="tag">no key does two jobs</span></div>
          <Roles strategist={st.by === "dawns" ? "Dawns (reference)" : st.strategist} href={`/strategists/${who}`} />
        </div>

        <div className="grid gA">
          <div className="card">
            <div className="c-head"><h3>Vault from this strategy</h3><Pill t="info">{offL1 ? "Needs the Igra bridge rule" : "Ready for NAV v1.1"}</Pill></div>
            <p className="muted" style={{ marginTop: 0 }}>A curator launches a NAV v1.1 vault with these mandate parameters. Each leg becomes a destination slot with its hard cap. {offL1 ? "These legs are Igra markets: a covenant slot is a Kaspa L1 address, so until the bridge payload rule exists the slots have no address and the vault cannot launch." : ""}</p>
            <pre className="st-pre">{JSON.stringify(mandate, null, 2)}</pre>
          </div>
          <div className="card st-cta">
            <span className="eyebrow muted">Strategy hash</span>
            <CopyId text={st.hash} />
            <small className="muted">blake2b-256 of the canonical document. A vault launched from it commits this hash in its mandate, so a strategy cannot change under its depositors: a new version is a new strategy.</small>
            <span className="eyebrow muted" style={{ marginTop: 8 }}>Published</span>
            <small>{st.createdAt} · by <Link href={`/strategists/${who}`}>{st.by === "dawns" ? "Dawns" : st.strategist}</Link> · v{st.version} of {family.versions.length}</small>
            <Link href={`/strategies/new?from=${st.id}`} className="btn ghost sm" style={{ justifySelf: "start", marginTop: 8 }}>Start a strategy from this one</Link>
          </div>
        </div>
      </div>
    </>
  );
}
