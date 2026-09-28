import type { Metadata } from "next";
import Link from "next/link";
import { Banner } from "@/components/Banner";
import { Pill } from "@/components/bits";
import { vaults, KIND, MANAGERS } from "@/lib/vaults/registry";
import { getSnapshot } from "@/lib/snapshot";
import { evaluate } from "@/lib/strategies/model";
import { listFamilies } from "@/lib/strategies/store";
import { pct } from "@/lib/format";

export const metadata: Metadata = { title: "Vaults", description: "Vaults whose rules the Kaspa network enforces: mandate, NAV, fixed-term and credit." };
export const revalidate = 60;

const STATUS = { live: { t: "good" as const, w: "Live" }, ready: { t: "info" as const, w: "Launching" }, designed: { t: "info" as const, w: "Designed" } };

export default async function VaultsHub() {
  const [vs, fams, snap] = await Promise.all([vaults(), listFamilies(), getSnapshot()]);
  const proposed = fams.map((f) => ({ st: f.current, ev: evaluate(f.current.doc, snap.opportunities, snap.kasUsd) }));
  const man = (id: string) => MANAGERS.find((m) => m.id === id);
  return (
    <>
      <Banner short crumb={[{ label: "Testnet" }]} title="Vaults"
        lede="A vault runs one investment mandate. Its rules are compiled into a Kaspa covenant: the manager cannot move capital outside them, because the network refuses the transaction." />
      <div className="wrap" style={{ paddingTop: 40, display: "grid", gap: 28 }}>

        <div className="card">
          <div className="c-head"><h3>What stops a manager</h3><Link href="/strategies" className="tag">A vault runs a strategy: browse strategies →</Link></div>
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
          <div className="c-head"><h3>Proposed from strategies</h3><Link href="/strategies" className="tag">All strategies →</Link></div>
          <p className="muted" style={{ marginTop: 0 }}>Every published strategy is a vault waiting for a curator. Its terms become the vault&apos;s mandate at launch; until then nothing is deposited.</p>
          <div className="vcards st-cards">
            {proposed.map(({ st, ev }) => {
              const k = KIND[st.doc.vault.type === "fixed" ? "fixed" : "nav"];
              const igra = ev.legs.some((l) => l.o?.chain === "igra" || l.o?.chain === "kasplex");
              return (
                <Link key={st.id} href={`/strategies/${st.id}`} className="card vcard">
                  <span className="vc-top"><span className="vc-kind" style={{ ["--c" as string]: k.color }}><i />{k.label}</span><Pill t="info">Proposed</Pill></span>
                  <b className="vc-name">{st.doc.name}</b>
                  <span className="st-fill" title={`0 of ${st.doc.vault.capacityKas.toLocaleString("en-US")} KAS deposited`}>
                    <span className="st-fill-t"><i style={{ width: "0%" }} /></span>
                    <small className="muted"><b style={{ color: "var(--ink)" }}>0</b> / {st.doc.vault.capacityKas.toLocaleString("en-US")} KAS capacity</small>
                  </span>
                  <span className="vc-figs">
                    <span><small>Expected net</small><b>{ev.net != null ? pct(ev.net, 1) : "—"}</b></span>
                    <span><small>Out now</small><b>{pct(ev.exitNow, 0)}</b></span>
                    <span><small>Terms</small><b>{st.doc.vault.type === "fixed" ? `${st.doc.vault.termDays}d` : "Open"}</b></span>
                  </span>
                  <ul className="vc-rules">
                    <li>{st.doc.legs.length} destination slots with hard caps</li>
                    <li>{st.doc.reserveBps / 100}% reserve floor</li>
                    <li>{st.doc.noticeDays}-day notice before a new version</li>
                  </ul>
                  <span className="vc-foot"><span>Strategy by <b>{st.by === "dawns" ? "Dawns" : `${st.strategist.slice(0, 12)}…${st.strategist.slice(-4)}`}</b></span><span className="muted">{igra ? "Needs the Igra bridge rule" : "Needs a curator"}</span></span>
                </Link>
              );
            })}
          </div>
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
