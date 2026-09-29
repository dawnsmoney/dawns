import type { Metadata } from "next";
import Link from "next/link";
import { Banner } from "@/components/Banner";
import { Pill } from "@/components/bits";
import { vaults, KIND, MANAGERS } from "@/lib/vaults/registry";
import { getSnapshot } from "@/lib/snapshot";
import { evaluate, launchPath } from "@/lib/strategies/model";
import { listFamilies } from "@/lib/strategies/store";
import { pct } from "@/lib/format";

export const metadata: Metadata = { title: "Vaults", description: "Vaults whose rules the Kaspa network enforces: mandate, NAV, fixed-term and credit." };
export const revalidate = 60;

const STATUS = { live: { t: "good" as const, w: "Live" }, ready: { t: "info" as const, w: "Launching" }, designed: { t: "info" as const, w: "Designed" } };

export default async function VaultsHub() {
  const [vs, fams, snap] = await Promise.all([vaults(), listFamilies(), getSnapshot()]);
  const proposed = fams.map((f) => ({ st: f.current, ev: evaluate(f.current.doc, snap.opportunities, snap.kasUsd) }));
  const man = (id: string) => MANAGERS.find((m) => m.id === id);
  const EXIT: Record<string, string> = { mandate: "The owner withdraws; no outside shares", nav: "Redeem at NAV any time, from liquid KAS", fixed: "Redeem at NAV after maturity", credit: "As borrowers repay" };
  const rows = [
    ...vs.filter((v) => v.status !== "designed").map((v) => ({ key: v.id, href: v.href, name: v.name, color: KIND[v.kind].color, kind: KIND[v.kind].label, network: v.network,
      deposits: v.figures[0]?.value ?? "—", depositsSub: v.figures[0]?.label && v.figures[0].label !== "Value" && v.figures[0].label !== "NAV" ? v.figures[0].label : null,
      net: <span className="muted">test KAS</span>, exit: EXIT[v.kind], curator: man(v.manager)?.name ?? v.manager, state: STATUS[v.status] })),
    ...proposed.map(({ st, ev }) => { const lp = launchPath(st.doc, ev); const k = lp.kind; return { key: st.id, href: `/strategies/${st.id}`, name: st.doc.name, color: KIND[k].color, kind: `${KIND[k].label} · proposed`, network: lp.note,
      deposits: `0 / ${st.doc.vault.capacityKas.toLocaleString("en-US")} KAS`, depositsSub: "capacity",
      net: <b>{ev.net != null ? pct(ev.net, 1) : "—"}</b>, exit: `${pct(ev.exitNow, 0)} out now${st.doc.vault.type === "fixed" ? ` · ${st.doc.vault.termDays}-day term` : ""}`,
      curator: st.by === "dawns" ? "Dawns" : `${st.strategist.slice(0, 8)}…${st.strategist.slice(-4)}`, state: { t: "info" as const, w: "Proposed" } }; }),
    ...vs.filter((v) => v.status === "designed").map((v) => ({ key: v.id, href: v.href, name: v.name, color: KIND[v.kind].color, kind: KIND[v.kind].label, network: v.network,
      deposits: "—", depositsSub: null, net: <span className="muted">—</span>, exit: EXIT[v.kind], curator: man(v.manager)?.name ?? v.manager, state: STATUS[v.status] })),
  ];
  return (
    <>
      <Banner short crumb={[{ label: "Testnet" }]} title="Vaults"
        lede="A vault runs one investment mandate. Its rules are compiled into a Kaspa covenant: the manager cannot move capital outside them, because the network refuses the transaction." />
      <div className="wrap" style={{ paddingTop: 40, display: "grid", gap: 28 }}>

        <div className="card flush"><div className="tbl-wrap"><table className="vault-tbl">
          <thead><tr><th>Vault</th><th>Deposits</th><th>Expected net</th><th>Getting out</th><th>Curator</th><th>State</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td>{(() => { const inner = <><i style={{ background: r.color }} /><span><b>{r.name}</b><small>{r.kind} · {r.network}</small></span></>; return r.href ? <Link href={r.href} className="vt-name">{inner}</Link> : <span className="vt-name off">{inner}</span>; })()}</td>
                <td>{r.deposits}{r.depositsSub && <small className="muted" style={{ display: "block" }}>{r.depositsSub}</small>}</td>
                <td>{r.net}</td>
                <td className="soft">{r.exit}</td>
                <td>{r.curator}</td>
                <td><Pill t={r.state.t}>{r.state.w}</Pill></td>
              </tr>
            ))}
          </tbody>
        </table></div></div>
        <p className="muted" style={{ fontSize: 13, margin: "-14px 0 0" }}>Expected net is native yield after fees, from the strategy&apos;s live evaluation; token incentives are never added. Testnet vaults hold test KAS and earn nothing.</p>

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
