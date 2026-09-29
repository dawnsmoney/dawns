import type { Metadata } from "next";
import Link from "next/link";
import { Banner } from "@/components/Banner";
import { StrategyCard, StrategyMap } from "@/components/strategy";
import { getSnapshot } from "@/lib/snapshot";
import { evaluate } from "@/lib/strategies/model";
import { listFamilies, listStrategists } from "@/lib/strategies/store";

export const metadata: Metadata = {
  title: "Strategies",
  description: "Strategies turn Kaspa DeFi opportunities into a split with rules: yield, exit liquidity and every term with who enforces it. Strategists write them; vaults run them.",
};
export const revalidate = 120;

export default async function StrategiesPage() {
  const [s, fams, strategists] = await Promise.all([getSnapshot(), listFamilies(), listStrategists()]);
  const rows = fams.map((f) => ({ ...f.current, next: f.next, ev: evaluate(f.current.doc, s.opportunities, s.kasUsd) }));
  return (
    <>
      <Banner short crumb={[{ href: "/opportunities", label: "Opportunities" }, { label: "Strategies · Beta" }]} title="Strategies"
        lede="The vault does not make the yield; the opportunities do. A strategy is the choice: which opportunities, how much in each, when to stop adding, what it costs. Strategists write them, anyone can check them, vaults run them." />
      <div className="wrap" style={{ paddingTop: 40, display: "grid", gap: 28 }}>
        <div className="card">
          <div className="c-head"><h3>From an asset to a vault</h3><span className="tag">strategist ≠ curator ≠ depositor</span></div>
          <div className="st-chain">
            {[["Assets", "What exists, who holds it, how deep it trades", "/assets"],
              ["Opportunities", "Native yield next to what it costs to leave", "/opportunities"],
              ["Strategies", "A split across opportunities, with rules and fees", null],
              ["Vaults", "A covenant runs one strategy; the network enforces it", "/vaults"],
              ["Monitor", "Every term checked against live data", null]].map(([h, p, href], i) => {
              const inner = <><span>{i + 1}</span><b>{h}</b><small>{p}</small></>;
              return href ? <Link key={h} href={href} className="st-step">{inner}</Link> : <div key={h} className={`st-step${h === "Strategies" ? " on" : ""}`}>{inner}</div>;
            })}
          </div>
        </div>

        <div className="grid gA">
          <div className="card">
            <div className="c-head"><h3>Yield against the way out</h3><span className="tag">{rows.length} strategies</span></div>
            <StrategyMap rows={rows.map((r) => ({ id: r.id, name: r.doc.name, net: r.ev.net, exit: r.ev.exitNow, status: r.ev.status }))} />
          </div>
          <div className="card st-cta">
            <span className="eyebrow muted">For strategists</span>
            <b style={{ font: "600 24px var(--display)" }}>Write a strategy</b>
            <p className="muted" style={{ margin: 0 }}>Pick up to four opportunities, set targets and hard caps, a reserve, the rules that stop new capital, and your fee on yield. dawns checks it against live data and shows which terms the covenant can enforce.</p>
            <Link href="/strategies/new" className="btn iris" style={{ justifySelf: "start" }}>Create a strategy</Link>
            <small className="muted">You sign in with a wallet; it becomes the strategist. Nothing moves funds.</small>
          </div>
        </div>

        <div className="vcards st-cards">
          {rows.map((r) => <StrategyCard key={r.id} id={r.id} doc={r.doc} ev={r.ev} strategist={r.strategist} by={r.by} version={r.version} next={r.next ? { version: r.next.version, at: r.next.effectiveAt.slice(0, 10) } : null} />)}
        </div>

        <div className="card">
          <div className="c-head"><h3>Strategists</h3><span className="tag">judged on their record, not their pitch</span></div>
          <div className="mgr-row">
            {strategists.map((m) => (
              <Link key={m.address} href={`/strategists/${m.address}`} className="mgr-chip">
                <span className="mgr-av">{m.address === "dawns" ? "D" : m.address.slice(6, 7).toUpperCase()}</span>
                <span><b className={m.address === "dawns" ? undefined : "mono"} style={{ fontSize: m.address === "dawns" ? undefined : 13.5 }}>{m.address === "dawns" ? "Dawns" : `${m.address.slice(0, 12)}…${m.address.slice(-5)}`}</b><small>{m.strategies} {m.strategies === 1 ? "strategy" : "strategies"} · {m.versions} {m.versions === 1 ? "version" : "versions"}</small></span>
              </Link>
            ))}
          </div>
        </div>

        <p className="muted" style={{ fontSize: 13, margin: 0 }}>Expected yield is native only, from on-chain rates and swap volume right now; it is not a promise. Strategies are published by their strategists; dawns evaluates them, it does not endorse them.</p>
      </div>
    </>
  );
}
