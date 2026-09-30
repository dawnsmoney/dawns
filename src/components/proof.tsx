import Link from "next/link";
import { AreaChart } from "./charts";
import { Columns } from "./viz";
import { Pill, SERIES } from "./bits";
import { Alert, Check, External, Minus } from "./icons";
import { Fresh } from "./Fresh";
import { ProofEmbed, ProofRequest } from "./proof-client";
import type { Proof } from "@/lib/proof";
import type { ProofHistory } from "@/lib/proof-history";
import { proofHeadline, usdShort } from "@/lib/proof";

const pct = (x: number, d = 1) => `${(x * 100).toFixed(d)}%`;
const full = (p: Proof, v: number) => (p.unit === "KAS" ? `${Math.round(v).toLocaleString("en-US")} KAS` : `$${Math.round(v).toLocaleString("en-US")}`);
const shortV = (p: Proof, v: number) => (p.unit === "KAS" ? `${v >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}K` : v.toFixed(0)} KAS` : usdShort(v));
const short = (a: string) => (a.startsWith("0x") && a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);
const explorer = (chain: string, a: string) => `${chain === "kasplex" ? "https://explorer.kasplex.org" : "https://explorer.igralabs.com"}/address/${a}`;
const KIND: Record<Proof["kind"], string> = { bridge: "Bridge", lending: "Lending", dex: "DEX" };

/** The strip under the title: what was read, when, and how often. */
function Verified({ p }: { p: Proof }) {
  return (
    <div className="prf-strip">
      <span className="prf-ok"><Check />Read on-chain</span>
      <div><small>Sources</small><b>{p.sources.length}</b></div>
      <div><small>Re-read</small><b>every 2 min</b></div>
      <div><small>Last read</small><b>{p.read ? <>{p.read.chain === "kasplex" ? "Kasplex" : "Igra"} #{p.read.block.toLocaleString("en-US")} · <Fresh since={p.read.t} /></> : "—"}</b></div>
      <div><small>Reported by {p.name}</small><b>nothing</b></div>
    </div>
  );
}

function Headline({ p }: { p: Proof }) {
  const cov = p.coverage;
  return (
    <div className="prf-kpis">
      <div className="card"><span>{p.reservesLabel}</span><b>{shortV(p, p.reserves)}</b><small>{p.reservesSub}</small>{p.unit === "KAS" && p.kasUsd ? <small className="mono">≈ {usdShort(p.reserves * p.kasUsd)}</small> : null}</div>
      <div className="card"><span>{p.owedLabel}</span><b>{shortV(p, p.owed)}</b><small>{p.owedSub}</small></div>
      <div className={`card prf-cov ${cov == null ? "" : cov >= 1 ? "up" : "down"}`}><span>{p.kind === "bridge" ? "Backing" : "Coverage"}</span><b>{cov == null ? "100%" : pct(cov, 2)}</b><small>{p.coverageSub}</small></div>
    </div>
  );
}

function History({ p, h }: { p: Proof; h: ProofHistory | null }) {
  const calc = (
    <div className="card">
      <div className="c-head"><h3>The calculation</h3>{p.read && <span className="tag">block #{p.read.block.toLocaleString("en-US")}</span>}</div>
      <div className="vlist">
        <div className="vrow"><span /><div>{p.reservesLabel}<small>{p.reservesSub}</small></div><b>{full(p, p.reserves)}</b></div>
        <div className="vrow"><span /><div>{p.owedLabel}<small>{p.owedSub}</small></div><b>{full(p, p.owed)}</b></div>
        {p.coverage != null && <div className="vrow"><span /><div>{p.reserves >= p.owed ? "Surplus" : "Shortfall"}<small>reserves minus what is owed</small></div><b className={p.reserves >= p.owed ? "up" : "down"}>{p.reserves >= p.owed ? "+" : "−"}{full(p, Math.abs(p.reserves - p.owed))}</b></div>}
        <div className="vrow"><span style={{ color: p.coverage == null || p.coverage >= 1 ? "var(--good)" : "var(--crit)" }}>{p.coverage == null || p.coverage >= 1 ? <Check /> : <Alert />}</span><div><b style={{ fontSize: 15 }}>{p.kind === "bridge" ? "Backing" : "Coverage"}</b><small>{p.coverage == null ? "a pool's tokens are its LPs' tokens" : "reserves ÷ what is owed"}</small></div><b className={p.coverage == null || p.coverage >= 1 ? "up" : "down"}>{p.coverage == null ? "100%" : pct(p.coverage, 2)}</b></div>
      </div>
    </div>
  );
  if (!h) return calc;
  const fmt = p.unit === "KAS" ? "num" : "usdFull";
  return (
    <div className="grid gA">
      <div className="card">
        <div className="c-head"><h3>{h.kind === "ratio" ? "Backing over time" : h.kind === "reserves" ? "Reserves over time" : "Reserves vs what is owed"}</h3><span className="tag">dawns&apos; own readings · hourly</span></div>
        {h.kind === "ratio"
          ? <AreaChart label={`${p.name} backing`} hourly fmt="pct" stats refLine={1} refLabel="100%" area="none" dates={h.t} series={[{ name: "Backing", color: SERIES[2], values: h.reserves }]} height={240} />
          : <AreaChart label={`${p.name} reserves`} hourly fmt={fmt} stats zero={false} dates={h.t} series={[{ name: "Reserves", color: SERIES[2], values: h.reserves }, ...(h.kind === "both" ? [{ name: "Owed", color: SERIES[3], values: h.owed }] : [])]} height={240} />}
      </div>
      {calc}
    </div>
  );
}

function Breakdown({ p }: { p: Proof }) {
  const b = p.breakdown;
  return (
    <div className="card flush">
      <div className="c-head" style={{ padding: "22px 22px 0" }}><h3>{b.title}</h3><span className="tag">{b.sub}</span></div>
      <div className="tbl-wrap"><table className="prf-tbl">
        <thead><tr><th>{p.kind === "dex" ? "Pool" : p.kind === "lending" ? "Market" : "Part"}</th><th>Network</th><th>Value</th><th className="prf-share-h">Share</th></tr></thead>
        <tbody>
          {b.rows.map((r) => (
            <tr key={r.label + (r.chain ?? "")}>
              <td><b>{r.label}</b>{r.href && <a href={r.href} target="_blank" rel="noopener noreferrer" className="prf-x" aria-label={`${r.label} on the explorer`}><External width={13} height={13} /></a>}{r.sub && <small className="prf-sub">{r.sub}</small>}</td>
              <td className="muted">{r.chain ?? "—"}</td>
              <td className="mono">{full(p, r.value)}</td>
              <td><div className="prf-share"><div className="bar-h"><i style={{ width: `${Math.min(100, r.share * 100)}%`, background: SERIES[2] }} /></div><span>{pct(r.share)}</span></div></td>
            </tr>
          ))}
        </tbody>
      </table></div>
    </div>
  );
}

function Exits({ p }: { p: Proof }) {
  const e = p.exits;
  return (
    <div className="grid gA">
      <div className="card">
        <div className="c-head"><h3>{e.title}</h3></div>
        <p className="muted" style={{ margin: "0 0 14px", fontSize: 14.5 }}>{e.lead}</p>
        <div className="vlist">
          {e.rows.map((r) => (
            <div className="vrow" key={r.label}><span style={{ color: r.tone === "warn" ? "var(--warn)" : r.tone === "crit" ? "var(--crit)" : r.tone === "good" ? "var(--good)" : "var(--ink-3)" }}>{r.tone === "warn" || r.tone === "crit" ? <Alert /> : r.tone === "good" ? <Check /> : null}</span><div>{r.label}{r.sub && <small>{r.sub}</small>}</div><b>{r.value}</b></div>
          ))}
        </div>
      </div>
      {e.bars.length > 0 && (
        <div className="card">
          <div className="c-head"><h3>Withdrawable, by market</h3></div>
          <div style={{ display: "grid", gap: 18 }}>
            {e.bars.map((b) => {
              const a = b.of ? Math.max(0, Math.min(1, b.have / b.of)) : 0;
              return (
                <div key={b.label} style={{ display: "grid", gap: 7 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><b>{b.label}</b><span className="muted" style={{ fontSize: 13.5 }}>{usdShort(b.have)} of {usdShort(b.of)}</span></div>
                  <div className="bar-h"><i style={{ width: `${a * 100}%`, background: a < 0.2 ? "var(--crit)" : SERIES[2] }} /></div>
                  <small className={a < 0.2 ? "down" : "muted"}>{b.sub}</small>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {e.waits.length > 0 && (
        <div className="card">
          <div className="c-head"><h3>How long recent exits waited</h3><span className="tag">{e.waits.reduce((s, w) => s + w.value, 0)} exits</span></div>
          <Columns label="Payout times" cols={e.waits.map((w, i) => ({ key: String(i), label: w.label, value: w.value, color: w.color }))} />
          <p className="foot">From the burn on Igra to the KAS arriving on L1. Past payouts do not promise future ones.</p>
        </div>
      )}
    </div>
  );
}

function Loans({ p }: { p: Proof }) {
  const L = p.loans;
  if (!L) return null;
  return (
    <div className="card">
      <div className="c-head"><h3>Are the loans good?</h3><span className="tag">{L.borrowers} borrowers</span></div>
      <div className="prf-loans">
        <div><span>Collateral</span><b>{usdShort(L.collateralUsd)}</b></div>
        <div><span>Debt</span><b>{usdShort(L.debtUsd)}</b></div>
        <div className={L.liquidatableUsd > 0 ? "warn" : ""}><span>Can be liquidated now</span><b>{usdShort(L.liquidatableUsd)}</b><small>{L.liquidatable} accounts</small></div>
        <div className={L.badDebtUsd > 0 ? "down" : "up"}><span>Bad debt</span><b>{usdShort(L.badDebtUsd)}</b><small>{L.badDebtAccounts} accounts owe more than they hold</small></div>
      </div>
      <p className="foot">Every borrower&apos;s collateral and debt, computed by dawns from token balances at market prices.</p>
    </div>
  );
}

function Sources({ p }: { p: Proof }) {
  return (
    <div className="card flush">
      <div className="c-head" style={{ padding: "22px 22px 0" }}><h3>Where every figure comes from</h3><span className="tag">{p.sources.length} sources · re-read every 2 min</span></div>
      <div className="tbl-wrap"><table className="prf-tbl">
        <thead><tr><th>Source</th><th>What dawns reads</th><th>Type</th><th>For</th><th>Network</th></tr></thead>
        <tbody>
          {p.sources.map((x) => (
            <tr key={x.name + x.side}>
              <td><b>{x.name}</b>{x.href && <a href={x.href} target="_blank" rel="noopener noreferrer" className="prf-x" aria-label={`${x.name} on the explorer`}><External width={13} height={13} /></a>}</td>
              <td className="muted" style={{ fontSize: 13.5 }}>{x.what}</td>
              <td className="mono" style={{ fontSize: 12.5 }}>{x.type}</td>
              <td><span className={`prf-side ${x.side.toLowerCase()}`}>{x.side}</span></td>
              <td className="muted">{x.chain}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
    </div>
  );
}

function Control({ p }: { p: Proof }) {
  if (!p.control.length && !p.owner.length) return null;
  return (
    <div className="grid gA">
      {p.control.length > 0 && (
        <div className="card flush">
          <div className="c-head" style={{ padding: "22px 22px 0" }}><h3>Who can change the contracts</h3></div>
          <div className="tbl-wrap"><table className="prf-tbl">
            <thead><tr><th>Contract</th><th>Upgradeability</th><th>Control</th><th /></tr></thead>
            <tbody>
              {p.control.map((c) => (
                <tr key={c.n + c.addr}>
                  <td><b>{c.n}</b><a href={explorer(c.chain, c.addr)} target="_blank" rel="noopener noreferrer" className="mono prf-sub" style={{ display: "block" }}>{short(c.addr)}</a></td>
                  <td>{c.up}</td><td>{c.admin}</td>
                  <td><Pill t={c.t}>{c.t === "good" ? "OK" : c.t === "warn" ? "Review" : "Noted"}</Pill></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>
      )}
      <div className="card">
        <div className="c-head"><h3>Latest owner actions</h3></div>
        {p.owner.length ? (
          <div className="vlist">
            {p.owner.map((a) => (
              <a key={a.tx} className="vrow" href={`https://explorer.igralabs.com/tx/${a.tx}`} target="_blank" rel="noopener noreferrer"><span /><div>{a.what.charAt(0).toUpperCase() + a.what.slice(1)}<small>{a.label} · {new Date(a.t).toISOString().slice(0, 10)}</small></div><span className="src">tx</span></a>
            ))}
          </div>
        ) : <p className="muted" style={{ margin: 0 }}>No admin transactions on the watched contracts. A new one raises a signal on dawns within minutes.</p>}
      </div>
    </div>
  );
}

function Limits({ p }: { p: Proof }) {
  return (
    <div className="grid gA">
      <div className="card">
        <div className="c-head"><h3>What dawns checks</h3></div>
        <div className="vlist">{p.checks.map(([a, b, c]) => <div className="vrow" key={a}><span style={{ color: "var(--good)" }}><Check /></span><div>{a}<small>{b}</small></div><span className="src">{c}</span></div>)}</div>
      </div>
      <div className="card">
        <div className="c-head"><h3>What this does not prove</h3></div>
        <div className="vlist">
          {p.pending.map(([a, b]) => <div className="vrow" key={a}><span style={{ color: "var(--ink-3)" }}><Minus /></span><div>{a}<small>{b}</small></div><span className="src">Not checked</span></div>)}
          <div className="vrow"><span style={{ color: "var(--ink-3)" }}><Minus /></span><div>That the contracts are safe<small>A proof shows the money is there now, not that the code cannot fail. Read the audits and the control table.</small></div><span className="src">Not in scope</span></div>
        </div>
      </div>
    </div>
  );
}

const FAQ: [string, string][] = [
  ["What does “read on-chain” mean here?", "dawns reads each figure itself, straight from the contracts and addresses listed under sources, at a known block. The protocol supplies nothing: there is no report to trust, and anyone can check the same calls on the explorer."],
  ["How often is it updated?", "The page is re-read at most every two minutes. dawns also stores a reading every ten minutes; that is the history in the chart."],
  ["Does this mean the protocol is safe, or endorsed by dawns?", "No. It shows that reserves cover what users are owed right now, and how users get their money back. Contracts can still have bugs, owners can still change things, and prices can move. A protocol cannot change what its proof says: dawns reads it the same way whether or not the protocol works with dawns."],
  ["Why is a DEX always 100%?", "A pool's tokens belong to its liquidity providers, who redeem straight from the pool. What matters for a DEX is how much is there, how deep it is, and who can change the contracts."],
];

/** One protocol's proof of reserves. */
export function ProofBody({ p, h, origin, compact }: { p: Proof; h: ProofHistory | null; origin: string; compact?: boolean }) {
  return (
    <div className={`prf${compact ? " compact" : ""}`}>
      <Verified p={p} />
      <Headline p={p} />
      <section className="prf-sec"><h2>Reserves</h2><History p={p} h={h} /></section>
      <section className="prf-sec"><h2>Breakdown</h2><Breakdown p={p} /></section>
      <section className="prf-sec"><h2>Getting money out</h2><Exits p={p} />{p.loans && <div style={{ marginTop: 22 }}><Loans p={p} /></div>}</section>
      <section className="prf-sec"><h2>Sources</h2><Sources p={p} /></section>
      {(p.control.length > 0 || p.owner.length > 0) && <section className="prf-sec"><h2>Control</h2><Control p={p} /></section>}
      <section className="prf-sec"><h2>Limits</h2><Limits p={p} /></section>
      <section className="prf-sec" id="badge">
        <h2>Show it on your site</h2>
        <div className="grid gA">
          <div className="card">
            <div className="c-head"><h3>Live badge</h3><span className="tag">updates itself</span></div>
            <p className="muted" style={{ margin: "0 0 14px", fontSize: 14.5 }}>{p.name} can show this proof on its own site. The badge is read live and links here, so anyone can check it.</p>
            <ProofEmbed id={p.id} name={p.name} origin={origin} />
          </div>
          <div className="card prf-custom">
            <div className="c-head"><h3>A custom proof dashboard</h3></div>
            <p className="muted" style={{ margin: "0 0 14px", fontSize: 14.5 }}>For protocols that want more: treasury and team wallets, reserves on other chains, your branding, and alerts to your team the moment coverage moves.</p>
            <ProofRequest about={p.id} />
          </div>
        </div>
      </section>
      <section className="prf-sec">
        <h2>Questions</h2>
        <div className="card prf-faq">{FAQ.map(([q, a]) => <details key={q}><summary>{q}</summary><p>{a}</p></details>)}</div>
      </section>
      <p className="muted" style={{ fontSize: 13, marginTop: 28 }}>Full reading of {p.name}: <Link href={p.href}>{p.kind === "bridge" ? "the Igra bridge page" : `${p.name} on dawns`} →</Link> · Research, not advice.</p>
    </div>
  );
}

/** Every proof, as cards. */
export function ProofIndex({ list }: { list: Proof[] }) {
  return (
    <>
    <div className="prf-index">
      {list.map((p) => {
        const hl = proofHeadline(p);
        return (
          <Link key={p.id} href={`/proof/${p.id}`} className="card prf-card">
            <div className="prf-card-top"><b>{p.name}</b><span className="tag">{KIND[p.kind]}</span></div>
            <div className="prf-card-main"><span>{hl.label}</span><b className={p.coverage == null ? "" : p.coverage >= 1 ? "up" : "down"}>{hl.value}</b></div>
            <div className="prf-card-rows">
              <div><span>{p.reservesLabel}</span><b>{shortV(p, p.reserves)}</b></div>
              {p.coverage != null && <div><span>{p.owedLabel}</span><b>{shortV(p, p.owed)}</b></div>}
              <div><span>Sources read</span><b>{p.sources.length}</b></div>
            </div>
            <div className="prf-card-foot"><Pill t={p.status}>{p.statusText}</Pill><span className="muted">Open the proof →</span></div>
          </Link>
        );
      })}
    </div>
    <div className="grid gA prf-more">
      <div className="card">
        <div className="c-head"><h3>Run a vault or a protocol?</h3><span className="tag">custom proof</span></div>
        <p className="muted" style={{ margin: "0 0 12px", fontSize: 14.5 }}>Give your depositors the same view: what the vault holds against shares × NAV, every NAV update with its transaction, and how redemptions were paid. Reserves on other chains, treasury wallets, your branding and alerts to your team can be added.</p>
        <p className="muted" style={{ margin: 0, fontSize: 14.5 }}>dawns&apos; own covenant vaults already prove themselves: the network enforces the mandate, and each vault page rebuilds its covenant byte for byte. <Link href="/vaults">See the vaults →</Link></p>
      </div>
      <div className="card"><ProofRequest about="proof-index" /></div>
    </div>
    </>
  );
}
