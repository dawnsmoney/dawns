import type { Metadata } from "next";
import Link from "next/link";
import { vaults, KIND, MANAGERS } from "@/lib/vaults/registry";
import { getSnapshot } from "@/lib/snapshot";
import { evaluate, launchPath } from "@/lib/strategies/model";
import { listFamilies } from "@/lib/strategies/store";
import { MCard, MFlags, MHead, MList, MNote, MRow } from "@/components/m/kit";
import { MTabs } from "@/components/m/tabs";
import { Pill } from "@/components/bits";
import { pct } from "@/lib/format";

export const metadata: Metadata = { title: "Vaults", description: "Vaults whose rules the Kaspa network enforces." };
export const revalidate = 60;
const STATUS = { live: { t: "good" as const, w: "Live" }, ready: { t: "info" as const, w: "Launching" }, designed: { t: "info" as const, w: "Designed" } };

export default async function MVaults() {
  const [vs, fams, s] = await Promise.all([vaults(), listFamilies(), getSnapshot()]);
  const live = vs.filter((v) => v.status !== "designed");
  const designed = vs.filter((v) => v.status === "designed");
  return (
    <>
      <MHead eyebrow="Testnet-10" title="Vaults" sub="A vault runs one mandate. Its rules are a Kaspa covenant: the manager cannot move capital outside them, because the network refuses the transaction." />
      <div className="m-screen">
        <MTabs tabs={[{ key: "l", label: "Vaults", badge: live.length }, { key: "p", label: "Proposed", badge: fams.length }, { key: "h", label: "How it works" }]}>
          <div className="m-panel">
            {live.map((v) => {
              const k = KIND[v.kind];
              const body = (
                <>
                  <span className="m-card-h"><span className="vc-kind" style={{ ["--c" as string]: k.color }}><i />{k.label}</span><Pill t={STATUS[v.status].t}>{STATUS[v.status].w}</Pill></span>
                  <b className="m-strat-n">{v.name}</b>
                  <small className="muted">{v.pitch}</small>
                  {v.figures.length > 0 && <span className="m-strat-f" style={{ gridTemplateColumns: `repeat(${v.figures.length},minmax(0,1fr))` }}>{v.figures.map((f) => <span key={f.label}><small>{f.label}</small><b>{f.value}</b></span>)}</span>}
                </>
              );
              return v.href ? <Link key={v.id} href={v.href} className="m-card m-strat" style={{ textDecoration: "none", color: "var(--ink)" }}>{body}</Link> : <div key={v.id} className="m-card m-strat">{body}</div>;
            })}
            <MCard title="Designed next" flush>
              <MList>{designed.map((v) => <MRow key={v.id} title={v.name} sub={v.pitch} pill={{ t: "info", text: KIND[v.kind].label }} />)}</MList>
            </MCard>
            <MCard title="Managers" flush>
              <MList>{MANAGERS.map((m) => <MRow key={m.id} href={`/managers/${m.id}`} title={m.name} sub={`${m.kind} · ${vs.filter((v) => v.manager === m.id).length} vaults`} />)}</MList>
            </MCard>
          </div>
          <div className="m-panel">
            <MNote>Every published strategy is a vault waiting for a curator: its terms become the mandate at launch. Nothing is deposited until then.</MNote>
            <MCard flush>
              <MList>{fams.map((f) => { const ev = evaluate(f.current.doc, s.opportunities, s.kasUsd); return (
                <MRow key={f.current.id} href={`/strategies/${f.current.id}`} title={f.current.doc.name}
                  sub={`0 / ${f.current.doc.vault.capacityKas.toLocaleString("en-US")} KAS · ${launchPath(f.current.doc, ev).note}`}
                  value={ev.net != null ? pct(ev.net, 1) : "—"} valueSub="expected net" />); })}</MList>
            </MCard>
          </div>
          <div className="m-panel">
            <MCard title="What stops a manager">
              <MFlags flags={[
                ["good", "Mandate: approved destinations, caps, a reserve, limits per move and per hour. Fixed at launch; its hash is in the vault's address."],
                ["good", "Keys: the allocator moves capital, the valuer marks positions, the guardian stops the vault. No key does two jobs."],
                ["good", "Covenant: every Kaspa node checks each transaction against the mandate. A breach never happens."],
                ["good", "Proof: every path tested against the node's own script engine, every rule removed in turn to show a test catches it."],
              ]} />
            </MCard>
            <MNote>Testnet only, not audited. Vaults take no outside capital before an independent audit and a legal review.</MNote>
          </div>
        </MTabs>
      </div>
    </>
  );
}
