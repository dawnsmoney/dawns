import type { Metadata } from "next";
import Link from "next/link";
import { Banner } from "@/components/Banner";
import { Pill } from "@/components/bits";
import { SplitBar, Ring, CapBars, CopyId } from "@/components/viz";
import { NavPanel } from "@/components/nav-panel";
import { navLedger as l, navMandate as m, navFigures, readNavLive, SOMPI, FIRST_PRICE } from "@/lib/vaults/nav";

export const metadata: Metadata = { title: "NAV vault", description: "Deposit KAS from any wallet, get shares at NAV, redeem at NAV. Rules enforced by the Kaspa network. Testnet-10." };
export const revalidate = 30;

const COLORS = ["#3987e5", "#d95926", "#199e70", "#c98500"];
const LIQUID = "#9085e9";
const kas = (x: number, d = 2) => `${x.toLocaleString("en-US", { maximumFractionDigits: d })} KAS`;
const short = (s: string) => (s.length > 22 ? `${s.slice(0, 14)}…${s.slice(-6)}` : s);
const when = (sec: number) => new Date(sec * 1000).toISOString().slice(0, 16).replace("T", " ") + " UTC";
const pct = (x: number, d = 0) => `${(x * 100).toFixed(d)}%`;

const STEPS: [string, string][] = [
  ["You send KAS", "to your personal deposit address, from any wallet. Only the vault or you can move that coin."],
  ["The vault mints shares", "at NAV, rounded up so no deposit dilutes existing holders. Your shares are a KCC-20 token note."],
  ["The manager allocates", "only to approved destinations, within caps and a reserve. A valuer marks what positions are worth."],
  ["You redeem", "by sending 1 KAS to your withdrawal address. The vault burns your note and pays NAV to your own address."],
];

function HowItWorks() {
  return (
    <div className="card">
      <div className="c-head"><h3>How your KAS moves</h3><span className="tag">every step checked by the network</span></div>
      <div className="flow">{STEPS.map(([h, p], i) => <div key={h} className="flow-step"><span>{i + 1}</span><b>{h}</b><small>{p}</small></div>)}</div>
    </div>
  );
}

function Keys({ roles }: { roles: { allocator: string; valuer: string; guardian: string } | null }) {
  const K: [string, string, string[], string[], string | null][] = [
    ["Allocator", "#3987e5", ["Moves capital to approved destinations", "Brings it back"], ["Cannot pay anyone else", "Cannot touch shares"], roles?.allocator ?? null],
    ["Valuer", "#c98500", ["Marks each position once per period", "Within a fixed step"], ["Cannot move a single sompi"], roles?.valuer ?? null],
    ["Guardian", "#e66767", ["Creates the share token", "Halts the vault for good"], ["Cannot take capital", "Cannot stop withdrawals"], roles?.guardian ?? null],
    ["Anyone", "#199e70", ["Runs deposits and withdrawals", "The outcome is fixed by the rules"], ["Cannot choose who gets shares or payouts"], null],
  ];
  return (
    <div className="card">
      <div className="c-head"><h3>Who can do what</h3><span className="tag">four roles, no key does two jobs</span></div>
      <div className="keys3 keys4">
        {K.map(([n, c, yes, no, a]) => (
          <div key={n} className="key3" style={{ ["--c" as string]: c }}>
            <h4><i />{n}</h4>
            <ul>{yes.map((y) => <li key={y}>{y}</li>)}{no.map((x) => <li key={x} className="no">{x}</li>)}</ul>
            {a && <small className="mono">{short(a)}</small>}
          </div>
        ))}
      </div>
    </div>
  );
}

export default async function NavVaultPage() {
  if (!l || !m) {
    return (
      <>
        <Banner short crumb={[{ href: "/vaults", label: "Vaults" }, { label: "NAV · testnet-10" }]} title="NAV vault"
          lede="Open to anyone: send KAS from your wallet, get shares at NAV, redeem at NAV. The covenant is written and tested against the Kaspa node's own script engine; it launches on testnet-10 next." />
        <div className="wrap" style={{ paddingTop: 40, display: "grid", gap: 28 }}>
          <HowItWorks />
          <Keys roles={null} />
          <div className="card">
            <div className="c-head"><h3>What the covenant guarantees</h3><Pill t="info">Launching</Pill></div>
            <ul className="findings">
              <li>Shares are minted only against KAS that arrived, at NAV rounded up: a deposit never dilutes holders.</li>
              <li>A share note is burned only when its owner&apos;s own withdrawal account is spent, and the payout goes to the owner&apos;s address and nowhere else.</li>
              <li>An exit fee stays in the vault for the holders who remain.</li>
              <li>The allocator is bound by the same destinations, caps, reserve and limits as the mandate vault.</li>
              <li>Marks move at most a fixed step per period, set by a valuer key the allocator does not hold.</li>
              <li>A halt stops new allocations and deposits; recalls and withdrawals continue, so every holder can leave.</li>
            </ul>
            <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>Launch share price: {(FIRST_PRICE / SOMPI).toFixed(2)} KAS. Testnet only, not audited. <Link href="/vaults/mandate-tn10">See the mandate vault running now</Link>.</p>
          </div>
        </div>
      </>
    );
  }

  const live = await readNavLive(l);
  const f = navFigures(l, m);
  const daa = live.daa;
  const maturityOpen = m.maturityDaa === 0 || (daa != null && daa - 100 >= m.maturityDaa);
  const valueTotal = f.liquid + f.marks.reduce((s, x) => s + x, 0);
  const since = f.price / (FIRST_PRICE / SOMPI) - 1;
  const payable = f.nav > 0 ? Math.min(1, Math.max(0, f.liquid / f.nav)) : 1;
  const dests = m.destinations;
  const name = (i: number | undefined) => (i != null ? dests[i]?.label.replace(" (test wallet)", "") ?? "" : "");
  const log = [...l.moves].reverse().map((x) => {
    const t = x.kind === "deposit" ? { c: "#199e70", title: `Deposit · ${(x.shares ?? 0).toLocaleString("en-US")} shares minted`, amt: `+${kas((x.paid ?? 0) / SOMPI)}` }
      : x.kind === "redeem" ? { c: "#e66767", title: `Withdrawal · ${(x.shares ?? 0).toLocaleString("en-US")} shares burned`, amt: `−${kas((x.payout ?? 0) / SOMPI)}` }
      : x.kind === "allocate" ? { c: COLORS[x.slot ?? 0], title: `Sent to ${name(x.slot)}`, amt: `−${kas((x.amount ?? 0) / SOMPI)}` }
      : x.kind === "recall" ? { c: COLORS[x.slot ?? 0], title: `Returned from ${name(x.slot)}`, amt: `+${kas((x.amount ?? 0) / SOMPI)}` }
      : x.kind === "mark" ? { c: "#c98500", title: "Positions marked", amt: "" }
      : x.kind === "halt" ? { c: "#e66767", title: "Guardian halted the vault", amt: "" }
      : x.kind === "token" ? { c: LIQUID, title: "Share token created", amt: "" }
      : { c: LIQUID, title: x.kind, amt: "" };
    return { ...t, key: x.txid, at: x.at, sub: `${x.txid.slice(0, 16)}… · NAV ${kas(x.navAfter / SOMPI)} after${x.owner ? ` · ${short(x.owner)}` : ""}` };
  });

  return (
    <>
      <Banner short crumb={[{ href: "/vaults", label: "Vaults" }, { label: "NAV · testnet-10" }]} title="NAV vault"
        lede="Open to anyone on testnet-10: send KAS from your wallet, get shares at NAV, redeem at NAV. The Kaspa network enforces the rules." />
      <div className="wrap" style={{ paddingTop: 40, display: "grid", gap: 28 }}>
        <div className="card vault-hero">
          <div className="vault-top">
            <h2>{m.name}</h2>
            <div className="vault-tags"><Pill t="info">testnet-10</Pill><Pill t="warn">Not audited</Pill>{l.state.halted ? <Pill t="crit">Halted</Pill> : <Pill t="good">Open</Pill>}</div>
          </div>
          <div className={`proof ${live.matches ? "" : "off"}`}>
            <span className="dot" />
            <span>{live.matches ? <><b>The chain agrees.</b> The vault&apos;s coin at <span className="mono">{short(l.address)}</span> holds {kas(live.coin!.amount / SOMPI)}, created by its last recorded move.</>
              : !live.ok ? <><b>Chain check unavailable.</b> Figures below are the operator&apos;s ledger.</>
              : <><b>The ledger is behind the chain.</b> The vault has moved since this page&apos;s ledger was published.</>}</span>
          </div>
          <div className="depth-top depth-4" style={{ margin: 0 }}>
            <div><span className="eyebrow muted">NAV</span><b>{kas(f.nav)}</b><small>{kas(f.liquid)} liquid · {kas(f.marks.reduce((s, x) => s + x, 0))} in positions</small></div>
            <div><span className="eyebrow muted">Per share</span><b>{f.price.toFixed(6)}</b><small>{f.shares ? `${since >= 0 ? "+" : "−"}${pct(Math.abs(since), 2)} since launch at ${(FIRST_PRICE / SOMPI).toFixed(2)}` : "launch price"}</small></div>
            <div><span className="eyebrow muted">Holders</span><b>{f.holders}</b><small>{f.shares.toLocaleString("en-US")} shares in {f.liveNotes} notes</small></div>
            <div><span className="eyebrow muted">In / out</span><b>{kas(f.deposited, 0)}</b><small>deposited · {kas(f.paidOut, 0)} paid out</small></div>
          </div>
          <div>
            <div className="eyebrow muted" style={{ marginBottom: 10 }}>Where the NAV is</div>
            <SplitBar label="NAV by place" parts={[...m.destinations.map((d, i) => ({ key: `d${i}`, label: d.label.replace(" (test wallet)", ""), color: COLORS[i], share: f.marks[i] ?? 0, note: `${kas(f.marks[i] ?? 0)} marked · ${kas(f.cost[i] ?? 0)} cost` })),
              { key: "liquid", label: "Liquid in the vault", color: LIQUID, share: Math.max(0, f.liquid), note: kas(f.liquid) }]} />
          </div>
        </div>

        <div className="card">
          <div className="c-head"><h3>Your position</h3><span className="tag">testnet KAS only</span></div>
          <NavPanel vault={l.covenantId} template={l.accountTemplate} price={f.price} minDeposit={m.minDepositSompi / SOMPI} noteValue={m.noteValueSompi / SOMPI} maxFee={m.maxFeeSompi / SOMPI} exitFeeBps={m.exitFeeBps} halted={l.state.halted} maturityOpen={maturityOpen} />
        </div>

        <div className="grid gA">
          <div className="card">
            <div className="c-head"><h3>Caps per destination</h3><span className="tag">at cost, share of NAV</span></div>
            <CapBars rows={m.destinations.map((d, i) => ({ key: d.address, label: d.label.replace(" (test wallet)", ""), sub: short(d.address), share: valueTotal ? (f.cost[i] ?? 0) / valueTotal : 0, cap: d.capBps / 1e4, display: `${pct(valueTotal ? (f.cost[i] ?? 0) / valueTotal : 0, 1)} / ${pct(d.capBps / 1e4)}`, color: COLORS[i] }))} />
          </div>
          <div className="card">
            <div className="c-head"><h3>Liquidity</h3><span className="tag">what can leave now</span></div>
            <div className="rings">
              <Ring value={payable} label="Payable now" sub="share of NAV held liquid" color={LIQUID} />
              <Ring value={m.reserveFloorBps / 1e4} label="Reserve floor" sub="the allocator can't go below" color="#199e70" />
            </div>
            <dl className="kv" style={{ marginTop: 14 }}>
              <dt>Exit fee</dt><dd>{m.exitFeeBps / 100}% of the payout, kept for remaining holders</dd>
              <dt>Minimum deposit</dt><dd>{kas(m.minDepositSompi / SOMPI)} after the note&apos;s {kas(m.noteValueSompi / SOMPI)} and the fee</dd>
              <dt>Mark step</dt><dd>at most {m.maxMarkStepBps / 100}% per position per period</dd>
              {m.maturityDaa > 0 && <><dt>Maturity</dt><dd>withdrawals from DAA {m.maturityDaa.toLocaleString("en-US")}</dd></>}
            </dl>
          </div>
        </div>

        <HowItWorks />
        <Keys roles={m.roles} />

        <div className="card">
          <div className="c-head"><h3>History</h3><span className="tag">{l.moves.length} moves</span></div>
          <div className="vlog">
            {log.map((x) => (
              <div key={x.key} className="vlog-row" style={{ ["--c" as string]: x.c }}>
                <i /><div><b>{x.title}</b><small>{when(x.at)} · {x.sub}</small></div><span className="amt">{x.amt}</span>
              </div>
            ))}
            <div className="vlog-row" style={{ ["--c" as string]: LIQUID }}><i /><div><b>Vault opened</b><small>{when(l.createdAt)} · {l.genesisTx.slice(0, 16)}… · seed {kas(l.seed / SOMPI)} (the vault&apos;s own, never shares)</small></div><span className="amt" /></div>
          </div>
        </div>

        <div className="card">
          <div className="c-head"><h3>The mandate</h3><span className="tag">{m.standard}</span></div>
          <p style={{ marginTop: 0, color: "var(--ink-2)" }}>{m.objective}</p>
          <dl className="kv">
            <dt>Mandate hash</dt><dd><CopyId text={l.mandateHash} /></dd>
            <dt>Vault covenant</dt><dd><CopyId text={l.covenantId} /></dd>
            <dt>Share token</dt><dd>{l.shareCovid ? <CopyId text={l.shareCovid} /> : "not created yet"}</dd>
            <dt>Vault address now</dt><dd><CopyId text={l.address} /></dd>
          </dl>
        </div>
        <p className="muted" style={{ fontSize: 13, margin: 0 }}>Testnet only, not audited, no outside capital. Share notes are KCC-20 tokens owned by your personal withdrawal account; a deposit makes one note, a withdrawal burns one whole note.</p>
      </div>
    </>
  );
}
