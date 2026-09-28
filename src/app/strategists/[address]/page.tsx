import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Banner } from "@/components/Banner";
import { ChangeList, NetHistory, StrategyCard } from "@/components/strategy";
import { getSnapshot } from "@/lib/snapshot";
import { diffDocs, evaluate } from "@/lib/strategies/model";
import { dailyOf, getStrategist } from "@/lib/strategies/store";
import { pct } from "@/lib/format";

export const revalidate = 300;
const COLORS = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#9085e9", "#e66767", "#008300"];
const short = (a: string) => (a === "dawns" ? "Dawns" : `${a.slice(0, 12)}…${a.slice(-5)}`);

export async function generateMetadata({ params }: { params: Promise<{ address: string }> }): Promise<Metadata> {
  const a = decodeURIComponent((await params).address);
  return { title: `Strategist ${short(a)}`, description: "A strategist's published strategies, every version with its notice, and dawns' daily evaluation of each." };
}

export default async function StrategistPage({ params }: { params: Promise<{ address: string }> }) {
  const address = decodeURIComponent((await params).address);
  const [v, s] = await Promise.all([getStrategist(address).catch(() => null), getSnapshot()]);
  if (!v) notFound();
  const fams = v.families;
  const versions = fams.flatMap((f) => f.versions);
  const changes = fams.flatMap((f) => f.versions.slice(1).map((x, i) => ({ f, x, prev: f.versions[i] })));
  const oname = (opp: string) => s.opportunities.find((o) => o.id === opp)?.name ?? opp;
  const notice = fams.reduce((t, f) => t + f.current.doc.noticeDays, 0) / (fams.length || 1);
  const evs = fams.map((f) => ({ f, ev: evaluate(f.current.doc, s.opportunities, s.kasUsd) }));
  const daily = await dailyOf(fams.map((f) => f.current.family));
  const days = [...new Set(daily.map((d) => d.day))].sort();
  const lines = fams.map((f, i) => ({ key: f.current.family, name: f.current.doc.name, color: COLORS[i % COLORS.length], values: days.map((d) => daily.find((x) => x.day === d && x.family === f.current.family)?.net ?? null) }));
  const tile = (label: string, big: string, small: string) => <div className="card st-tile"><span className="eyebrow muted">{label}</span><b>{big}</b><small className="muted">{small}</small></div>;
  return (
    <>
      <Banner short crumb={[{ href: "/strategies", label: "Strategies" }, { label: "Strategist" }]} title={short(address)}
        lede={v.by === "dawns" ? "Dawns' reference strategies: written to show how a strategy is checked, not as recommendations." : `Publishing on dawns since ${v.since}. The wallet that signed in is the strategist: it earns the fee and alone can publish new versions.`} />
      <div className="wrap" style={{ paddingTop: 40, display: "grid", gap: 28 }}>
        {v.by === "strategist" && <div className="card" style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", justifyContent: "space-between" }}><span className="mono" style={{ fontSize: 13.5, wordBreak: "break-all" }}>{address}</span><a className="tag" href={`https://explorer.kaspa.org/addresses/${address}`} target="_blank" rel="noopener noreferrer">On the Kaspa explorer →</a></div>}
        <div className="grid st-tiles">
          {tile("Strategies", String(fams.length), `${evs.filter((e) => e.ev.status === "good").length} hold all their rules today`)}
          {tile("Versions", String(versions.length), changes.length ? `${changes.length} changes, each after notice` : "No changes yet")}
          {tile("Notice", `${Math.round(notice)} days`, "average notice before a new version")}
          {tile("Vaults running them", "0", "No vault runs a strategy yet: the record below is dawns' evaluation, not realized returns")}
        </div>

        <div className="card">
          <div className="c-head"><h3>Evaluated net APY, day by day</h3><span className="tag">the version in force each day</span></div>
          {days.length ? <NetHistory days={days} lines={lines} /> : <p className="muted" style={{ margin: 0 }}>dawns records each strategy&apos;s evaluation once a day. The first reading lands with the next daily run.</p>}
          <p className="muted" style={{ fontSize: 13, margin: "12px 0 0" }}>Native yield of the legs that could take capital that day, minus the strategist&apos;s fees, from on-chain rates and swap volume. It becomes a realized track record once a vault runs the strategy.</p>
        </div>

        <div className="vcards st-cards">
          {evs.map(({ f, ev }) => <StrategyCard key={f.current.id} id={f.current.id} doc={f.current.doc} ev={ev} strategist={f.current.strategist} by={f.current.by} version={f.current.version} next={f.next ? { version: f.next.version, at: f.next.effectiveAt.slice(0, 10) } : null} />)}
        </div>

        <div className="card">
          <div className="c-head"><h3>Every change</h3><span className="tag">published → in force, with what changed</span></div>
          {changes.length ? (
            <div className="st-log">
              {changes.reverse().map(({ f, x, prev }) => (
                <div key={x.id} className="st-log-row">
                  <span className="st-log-when"><b>{x.effectiveAt.slice(0, 10)}</b><small className="muted">published {x.createdAt} · {x.status === "scheduled" ? "scheduled" : "in force"}</small></span>
                  <span style={{ display: "grid", gap: 10, minWidth: 0 }}>
                    <Link href={`/strategies/${x.id}`}><b>{f.current.doc.name}</b> v{prev.version} → v{x.version}</Link>
                    <ChangeList changes={diffDocs(prev.doc, x.doc, oname)} />
                  </span>
                </div>
              ))}
            </div>
          ) : <p className="muted" style={{ margin: 0 }}>No strategy has a second version yet. Every change will appear here with its date and what it changed, safer or riskier for depositors.</p>}
        </div>
        <p className="muted" style={{ fontSize: 13, margin: 0 }}>Expected yield is native only and not a promise. {v.by === "strategist" ? "Strategists publish on their own; dawns evaluates, it does not endorse." : ""} Net APY today: {evs.map((e) => `${e.f.current.doc.name} ${e.ev.net != null ? pct(e.ev.net, 1) : "—"}`).join(" · ")}.</p>
      </div>
    </>
  );
}
