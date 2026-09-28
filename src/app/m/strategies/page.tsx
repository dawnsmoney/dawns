import type { Metadata } from "next";
import Link from "next/link";
import { getSnapshot } from "@/lib/snapshot";
import { evaluate } from "@/lib/strategies/model";
import { listFamilies, listStrategists } from "@/lib/strategies/store";
import { splitParts } from "@/lib/strategies/parts";
import { MCard, MHead, MLinkButton, MList, MNote, MRow } from "@/components/m/kit";
import { MTabs } from "@/components/m/tabs";
import { StrategyMap } from "@/components/strategy";
import { Pill } from "@/components/bits";
import { SplitBar } from "@/components/viz";
import { pct } from "@/lib/format";

export const metadata: Metadata = { title: "Strategies", description: "Strategies turn Kaspa DeFi opportunities into a split with rules." };
export const revalidate = 120;

export default async function MStrategies() {
  const [s, fams, strategists] = await Promise.all([getSnapshot(), listFamilies(), listStrategists()]);
  const rows = fams.map((f) => ({ ...f.current, next: f.next, ev: evaluate(f.current.doc, s.opportunities, s.kasUsd) }));
  return (
    <>
      <MHead eyebrow="Opportunities → Strategies → Vaults" title="Strategies" sub="The vault does not make the yield; the opportunities do. A strategy is the choice, with rules anyone can check." />
      <div className="m-screen">
        <MTabs tabs={[{ key: "l", label: "Strategies", badge: rows.length }, { key: "m", label: "Yield vs exit" }, { key: "s", label: "Strategists", badge: strategists.length }]}>
          <div className="m-panel">
            {rows.map((r) => (
              <Link key={r.id} href={`/strategies/${r.id}`} className="m-card m-strat" style={{ textDecoration: "none", color: "var(--ink)" }}>
                <span className="m-card-h"><span className="m-tag">{r.doc.vault.type === "fixed" ? `${r.doc.vault.termDays}-day term` : "Open term"}</span><Pill t={r.ev.status}>{r.ev.statusText}</Pill></span>
                <b className="m-strat-n">{r.doc.name}</b>
                <SplitBar parts={splitParts(r.doc, r.ev)} label="Split" height={10} legend={false} tip={false} />
                <span className="m-strat-f">
                  <span><small>Net APY</small><b>{r.ev.net != null ? pct(r.ev.net, 1) : "—"}</b></span>
                  <span><small>Out now</small><b>{pct(r.ev.exitNow, 0)}</b></span>
                  <span><small>Legs</small><b>{r.doc.legs.length}</b></span>
                  <span><small>Fee</small><b>{r.doc.fees.performanceBps / 100}%</b></span>
                </span>
                <small className="muted">{r.by === "dawns" ? "Dawns · reference" : `${r.strategist.slice(0, 12)}…${r.strategist.slice(-4)}`} · {r.next ? `v${r.next.version} from ${r.next.effectiveAt.slice(0, 10)}` : `v${r.version}`}</small>
              </Link>
            ))}
            <MLinkButton href="/strategies/new">Write a strategy</MLinkButton>
          </div>
          <div className="m-panel">
            <MCard title="Yield against the way out" tag="full capacity">
              <StrategyMap rows={rows.map((r) => ({ id: r.id, name: r.doc.name, net: r.ev.net, exit: r.ev.exitNow, status: r.ev.status }))} />
            </MCard>
          </div>
          <div className="m-panel">
            <MCard flush>
              <MList>{strategists.map((m) => <MRow key={m.address} href={`/strategists/${m.address}`} title={m.address === "dawns" ? "Dawns" : `${m.address.slice(0, 12)}…${m.address.slice(-5)}`} sub={`${m.strategies} ${m.strategies === 1 ? "strategy" : "strategies"} · ${m.versions} ${m.versions === 1 ? "version" : "versions"}`} />)}</MList>
            </MCard>
          </div>
        </MTabs>
        <MNote>Expected yield is native only and not a promise. Strategists publish on their own; dawns evaluates, it does not endorse.</MNote>
      </div>
    </>
  );
}
