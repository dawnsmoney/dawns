import type { Metadata } from "next";
import { Fragment } from "react";
import { Banner } from "@/components/Banner";
import { Pill } from "@/components/bits";
import { SplitBar, Ring, CapBars, CopyId } from "@/components/viz";
import { External } from "@/components/icons";
import { mandate as m, ledger as l, readLive, figures, SOMPI, explorerAddr, apiAddr } from "@/lib/vault";

export const metadata: Metadata = { title: "Dawns TN10 mandate vault", description: "A vault that runs one investment mandate, enforced by the Kaspa network. Live on testnet-10." };
export const revalidate = 60;

const COLORS = ["#3987e5", "#d95926", "#199e70", "#c98500"];
const LIQUID = "#9085e9";
const kas = (x: number, d = 2) => `${x.toLocaleString("en-US", { maximumFractionDigits: d })} KAS`;
const short = (s: string) => (s.length > 22 ? `${s.slice(0, 14)}…${s.slice(-6)}` : s);
const when = (sec: number) => new Date(sec * 1000).toISOString().slice(0, 16).replace("T", " ") + " UTC";
const pct = (x: number, d = 0) => `${(x * 100).toFixed(d)}%`;

const REFUSED: Record<string, string> = {
  "breach-dest": "Tried to send to an address the mandate never approved",
  "breach-cap": "Tried to go past a destination's cap",
  "breach-floor": "Tried to take the vault below its reserve floor",
  "breach-epoch": "Tried to move more than this period allows",
};

export default async function MandateVaultPage() {
  const live = await readLive();
  const f = figures(l, m, live.daa);
  // what the vault opened with: today's principal, before any deposit or withdrawal since
  const opened = l.state.principal + l.moves.reduce((s, x) => s + (x.kind === "withdraw" ? x.amount ?? 0 : x.kind === "deposit" ? -(x.amount ?? 0) : 0), 0);
  const dest = (i: number | null | undefined) => (i != null ? m.destinations[i]?.label.replace(" (test wallet)", "") : "");
  const log = [
    ...l.moves.map((x) => {
      const t = x.kind === "allocate" ? { c: COLORS[x.slot ?? 0], title: `Sent to ${dest(x.slot)}`, sign: "−" }
        : x.kind === "recall" ? { c: COLORS[x.slot ?? 0], title: `Returned from ${dest(x.slot)}`, sign: "+" }
        : x.kind === "withdraw" ? { c: "#199e70", title: "Depositor withdrew", sign: "−" }
        : x.kind === "deposit" ? { c: "#199e70", title: "Depositor added", sign: "+" }
        : x.kind === "halt" ? { c: "#c98500", title: "Guardian halted the vault: everything to the depositor", sign: "" }
        : x.kind === "close" ? { c: "#c98500", title: "Vault closed", sign: "" }
        : { c: LIQUID, title: x.kind, sign: "" };
      return { key: x.txid, at: x.at, refused: false, ...t, amount: x.amount ?? 0, sub: `${x.txid.slice(0, 16)}… · vault holds ${kas(x.valueAfter / SOMPI)} after`, err: null as string | null };
    }),
    ...l.refusals.map((x) => ({ key: `r-${x.txid}`, at: x.at, refused: true, c: "#e66767", title: REFUSED[x.kind] ?? x.kind, sign: "", amount: x.amount ?? 0, sub: `refused by the network · ${x.txid.slice(0, 16)}…`, err: x.error })),
    { key: "genesis", at: l.createdAt, refused: false, c: LIQUID, title: "Vault opened", sign: "+", amount: opened, sub: `${l.genesisTx.slice(0, 16)}… · mandate fixed`, err: null },
  ].sort((a, b) => b.at - a.at);
  const hour = (m.epochLengthDaa / 10 / 3600);

  return (
    <>
      <Banner short crumb={[{ href: "/vaults", label: "Vaults" }, { label: "Mandate · testnet-10" }]} title="Mandate vault"
        lede="One owner, one mandate. Its rules are compiled into a Kaspa covenant, so the allocator cannot move capital outside them: the network refuses the transaction." />
      <div className="wrap" style={{ paddingTop: 40, display: "grid", gap: 28 }}>

        <div className="card vault-hero">
          <div className="vault-top">
            <h2>{m.name}</h2>
            <div className="vault-tags"><Pill t="info">testnet-10</Pill><Pill t="warn">Not audited</Pill>{l.closed ? <Pill t="crit">Closed</Pill> : <Pill t="good">Live</Pill>}</div>
          </div>
          <div className={`proof ${live.matches ? "" : "off"}`}>
            <span className="dot" />
            <span>{live.matches
              ? <><b>The chain agrees.</b> The vault&apos;s coin at <span className="mono">{short(l.address)}</span> holds {kas(live.vaultCoin!.amount / SOMPI)}, created by its last recorded move. The address itself commits to the mandate and the vault&apos;s state.</>
              : !live.ok ? <><b>Chain check unavailable.</b> The public TN10 API did not answer; figures below are the operator&apos;s ledger.</>
              : <><b>The ledger is behind the chain.</b> No coin matching the last recorded move sits at <span className="mono">{short(l.address)}</span>: the vault has moved since this page&apos;s ledger was published.</>}</span>
          </div>
          <div className="depth-top" style={{ margin: 0 }}>
            <div><span className="eyebrow muted">Vault value</span><b>{kas(f.value, 0)}</b><small>{kas(f.inVault, 0)} in the vault · {kas(f.deployed.reduce((s, x) => s + x, 0), 0)} deployed at cost</small></div>
            <div><span className="eyebrow muted">Moves</span><b>{l.moves.length}</b><small>accepted by the network since {when(l.createdAt).slice(0, 10)}</small></div>
            <div><span className="eyebrow muted">Refused by the network</span><b>{l.refusals.length}</b><small>attempts to break the mandate, on the record</small></div>
          </div>
          <div>
            <div className="eyebrow muted" style={{ marginBottom: 10 }}>Where the value is</div>
            <SplitBar label="Vault value by place" parts={[
              ...m.destinations.map((d, i) => ({ key: `d${i}`, label: d.label.replace(" (test wallet)", ""), color: COLORS[i], share: f.deployed[i] ?? 0, note: kas(f.deployed[i] ?? 0) })),
              { key: "liquid", label: "In the vault", color: LIQUID, share: f.inVault, note: kas(f.inVault) },
            ]} />
          </div>
        </div>

        <div className="grid gA" style={{ alignItems: "start" }}>
          <div className="card">
            <div className="c-head"><h3>Caps per destination</h3><span className="tag">share of vault value</span></div>
            <CapBars rows={m.destinations.map((d, i) => ({ key: d.address, label: d.label.replace(" (test wallet)", ""), sub: short(d.address), share: f.value ? (f.deployed[i] ?? 0) / f.value : 0, cap: d.capBps / 1e4, display: `${pct(f.value ? (f.deployed[i] ?? 0) / f.value : 0, 1)} / ${pct(d.capBps / 1e4)}`, color: COLORS[i] }))} />
            <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>Solid: sent and not yet returned. Hatched: room left under the cap. The white tick is the cap the covenant enforces.</p>
            {live.strategies.some((x) => x != null) && (
              <dl className="kv" style={{ marginTop: 14 }}>
                {m.destinations.map((d, i) => <Fragment key={d.address}><dt>{d.label.replace(" (test wallet)", "")} wallet now</dt><dd>{live.strategies[i] != null ? kas(live.strategies[i]!) : "—"} <span className="muted">· sent at cost {kas(f.deployed[i] ?? 0)}</span></dd></Fragment>)}
              </dl>
            )}
          </div>
          <div className="card">
            <div className="c-head"><h3>Liquidity and limits</h3><span className="tag">epoch #{Math.max(0, f.epochNow)}</span></div>
            <div className="rings">
              <Ring value={f.liquidShare} label="Held in the vault" sub={`floor ${pct(m.reserveFloorBps / 1e4)}: can't go lower`} color={LIQUID} />
              <Ring value={Math.min(1, f.epochUsed / f.epochLimit)} display={`${f.epochUsed.toFixed(0)}/${f.epochLimit.toFixed(0)}`} label={`Moved out this ${hour === 1 ? "hour" : "period"}`} sub={`KAS, of ${kas(f.epochLimit, 0)} allowed`} color="#d95926" />
            </div>
            <dl className="kv" style={{ marginTop: 14 }}>
              <dt>Largest single move</dt><dd>{kas(m.maxPerMoveSompi / SOMPI, 0)}</dd>
              <dt>Period</dt><dd>{m.epochLengthDaa.toLocaleString("en-US")} DAA ≈ {hour === 1 ? "1 hour" : `${hour.toFixed(1)} hours`}</dd>
              <dt>Network fee per move</dt><dd>at most {kas(m.maxFeeSompi / SOMPI)}</dd>
            </dl>
          </div>
        </div>

        <div className="card">
          <div className="c-head"><h3>Three keys, three powers</h3><span className="tag">never one key for two</span></div>
          <div className="keys3">
            <div className="key3" style={{ ["--c" as string]: "#3987e5" }}>
              <h4><i />Allocator</h4>
              <ul><li>Moves capital to approved destinations</li><li>Brings capital back</li><li className="no">Cannot withdraw, halt or close</li><li className="no">Cannot break a cap, the floor or a limit</li></ul>
              <small className="mono">{short(m.roles.allocator)}</small>
            </div>
            <div className="key3" style={{ ["--c" as string]: "#c98500" }}>
              <h4><i />Guardian</h4>
              <ul><li>Stops the vault at any time</li><li>On halt, everything goes to the depositor</li><li className="no">Cannot send capital anywhere else</li></ul>
              <small className="mono">{short(m.roles.guardian)}</small>
            </div>
            <div className="key3" style={{ ["--c" as string]: "#199e70" }}>
              <h4><i />Depositor</h4>
              <ul><li>Owns the capital</li><li>Withdraws any time, to its own address only</li><li className="no">Cannot allocate</li></ul>
              <small className="mono">{short(m.roles.depositor)}</small>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="c-head"><h3>History</h3><span className="tag">{l.moves.length + 1} accepted · {l.refusals.length} refused</span></div>
          <div className="vlog">
            {log.map((x) => (
              <div key={x.key} className="vlog-row" style={{ ["--c" as string]: x.c }}>
                <i />
                <div><b>{x.refused ? <Pill t="crit">Refused</Pill> : null} {x.title}</b><small>{when(x.at)} · {x.sub}</small>{x.err && <small title={x.err}>Network&apos;s answer: {x.err.split(": ").slice(-2).join(": ")}</small>}</div>
                <span className="amt">{x.amount ? `${x.sign}${kas(x.amount / SOMPI)}` : ""}{x.refused && <small>nothing moved</small>}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="c-head"><h3>The mandate</h3><span className="tag">{m.standard}</span></div>
          <p style={{ marginTop: 0, color: "var(--ink-2)" }}>{m.objective}</p>
          <dl className="kv">
            <dt>Mandate hash</dt><dd><CopyId text={l.mandateHash} /></dd>
            <dt>Covenant id</dt><dd><CopyId text={l.covenantId} /></dd>
            <dt>Opened in</dt><dd><CopyId text={l.genesisTx} /></dd>
            <dt>Vault address now</dt><dd><CopyId text={l.address} /></dd>
          </dl>
          <div className="srcbar" style={{ marginTop: 18 }}>
            <span className="eyebrow muted">Check it</span>
            <a className="srcchip" href={apiAddr(l.address)} target="_blank" rel="noopener noreferrer"><External width={13} height={13} />Vault coin, TN10 API</a>
            <a className="srcchip" href={explorerAddr(m.roles.depositor)} target="_blank" rel="noopener noreferrer"><External width={13} height={13} />Depositor on an explorer</a>
            <span className="srcchip plain">38 engine tests · every guard mutation-checked</span>
          </div>
          <details className="more" style={{ marginTop: 16 }}>
            <summary>What v0 does not do yet</summary>
            <ul className="findings" style={{ marginTop: 12 }}>
              <li>Deployed capital is counted at cost. The covenant cannot see a position&apos;s market value; dawns reports marks separately.</li>
              <li>Which destination a return is credited to is the allocator&apos;s claim. It cannot take value out, but it can shift cap room.</li>
              <li>Capital already at a destination comes back only through that destination.</li>
              <li>Bridge destinations (Igra) need a payload rule first; v0 sends only to plain addresses.</li>
              <li>Bounded at 1M KAS per figure. Testnet only, not audited, no outside capital before a legal review.</li>
            </ul>
          </details>
        </div>
        <p className="muted" style={{ fontSize: 13, margin: 0 }}>Explorers do not index covenant transactions on testnet-10 yet, so the live check reads the vault&apos;s coin from the public TN10 REST API. The history is the operator tool&apos;s ledger, published with the site; the chain check above says whether it is current.</p>
      </div>
    </>
  );
}
