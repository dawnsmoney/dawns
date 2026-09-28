import type { Metadata } from "next";
import Link from "next/link";
import { Banner } from "@/components/Banner";
import { Pill } from "@/components/bits";
import { vaults, KIND, MANAGERS } from "@/lib/vaults/registry";

export const metadata: Metadata = { title: "Vaults", description: "Vaults whose rules the Kaspa network enforces: mandate, NAV, fixed-term and credit." };
export const revalidate = 60;

const STATUS = { live: { t: "good" as const, w: "Live" }, ready: { t: "info" as const, w: "Launching" }, designed: { t: "info" as const, w: "Designed" } };

export default function VaultsHub() {
  const vs = vaults();
  const man = (id: string) => MANAGERS.find((m) => m.id === id);
  return (
    <>
      <Banner short crumb={[{ label: "Testnet" }]} title="Vaults"
        lede="A vault runs one investment mandate. Its rules are compiled into a Kaspa covenant: the manager cannot move capital outside them, because the network refuses the transaction." />
      <div className="wrap" style={{ paddingTop: 40, display: "grid", gap: 28 }}>

        <div className="card">
          <div className="c-head"><h3>What stops a manager</h3><span className="tag">enforced by the network, not by dawns</span></div>
          <div className="flow">
            {[["Mandate", "Approved destinations, caps, a reserve, limits per move and per hour. Fixed at launch; its hash is in the vault's address."],
              ["Keys", "Allocator moves capital. Valuer marks positions. Guardian stops the vault. No key does two jobs."],
              ["Covenant", "Every transaction is checked against the mandate by every Kaspa node. A breach is not reverted later: it never happens."],
              ["Proof", "Each path is tested against the node's own script engine, every rule removed in turn to show a test catches it."]].map(([h, p], i) => (
              <div key={h} className="flow-step"><span>{i + 1}</span><b>{h}</b><small>{p}</small></div>
            ))}
          </div>
        </div>

        <div className="vcards">
          {vs.map((v) => {
            const k = KIND[v.kind];
            const body = (
              <>
                <span className="vc-top"><span className="vc-kind" style={{ ["--c" as string]: k.color }}><i />{k.label}</span><Pill t={STATUS[v.status].t}>{STATUS[v.status].w}</Pill></span>
                <b className="vc-name">{v.name}</b>
                <small className="muted">{v.pitch}</small>
                {v.figures.length > 0 && <span className="vc-figs">{v.figures.map((f) => <span key={f.label}><small>{f.label}</small><b>{f.value}</b></span>)}</span>}
                <ul className="vc-rules">{v.guarantees.map((g) => <li key={g}>{g}</li>)}</ul>
                <span className="vc-foot"><span>Managed by <b>{man(v.manager)?.name ?? v.manager}</b></span><span className="muted">{v.network}</span></span>
              </>
            );
            return v.href ? <Link key={v.id} href={v.href} className="card vcard">{body}</Link> : <div key={v.id} className="card vcard dim">{body}</div>;
          })}
        </div>

        <div className="card">
          <div className="c-head"><h3>Managers</h3><Link href="/managers" className="tag">All managers →</Link></div>
          <div className="mgr-row">
            {MANAGERS.map((m) => (
              <Link key={m.id} href={`/managers/${m.id}`} className="mgr-chip"><span className="mgr-av">{m.letter}</span><span><b>{m.name}</b><small>{m.kind} · {vs.filter((v) => v.manager === m.id).length} vaults</small></span></Link>
            ))}
          </div>
        </div>

        <p className="muted" style={{ fontSize: 13, margin: 0 }}>Testnet only, not audited. Vaults take no outside capital before an independent audit and a legal review.</p>
      </div>
    </>
  );
}
