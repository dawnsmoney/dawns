import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Banner } from "@/components/Banner";
import { Pill } from "@/components/bits";
import { SplitBar, Ring, CopyId } from "@/components/viz";
import { NavPanel } from "@/components/nav-panel";
import { LoanCard, LOAN_COLORS, LIQUID, CREDIT_STEPS, kas, dur } from "@/components/credit-vault";
import { getCredit, creditFigures, readCreditLive, SOMPI, FIRST_PRICE, DAA_PER_SEC } from "@/lib/vaults/credit";

export const metadata: Metadata = { title: "Credit vault", description: "Loans to named borrowers with repayments that can only return to the vault and late loans marked down on a schedule anyone can enforce. Testnet-10." };
export const revalidate = 30;

const short = (s: string) => (s.length > 22 ? `${s.slice(0, 14)}…${s.slice(-6)}` : s);
const when = (sec: number) => new Date(sec * 1000).toISOString().slice(0, 16).replace("T", " ") + " UTC";
const pct = (x: number, d = 0) => `${(x * 100).toFixed(d)}%`;

export default async function CreditVaultPage() {
  const { l, m } = await getCredit();
  if (!l || !m) notFound();
  const live = await readCreditLive(l);
  const f = creditFigures(l, m, live.daa);
  const maturityOpen = m.maturityDaa === 0 || f.at >= m.maturityDaa;
  const since = f.price / (FIRST_PRICE / SOMPI) - 1;
  const payable = f.nav > 0 ? Math.min(1, Math.max(0, f.liquid / f.nav)) : 1;
  const name = (i: number | undefined) => (i != null ? f.loans[i]?.label ?? "" : "");
  const log = [...l.moves].reverse().map((x) => {
    const t = x.kind === "deposit" ? { c: "#199e70", title: `Deposit · ${(x.shares ?? 0).toLocaleString("en-US")} shares minted`, amt: `+${kas((x.paid ?? 0) / SOMPI)}` }
      : x.kind === "redeem" ? { c: "#e66767", title: `Withdrawal · ${(x.shares ?? 0).toLocaleString("en-US")} shares burned`, amt: `−${kas((x.payout ?? 0) / SOMPI)}` }
      : x.kind === "lend" ? { c: LOAN_COLORS[x.slot ?? 0], title: `Lent to ${name(x.slot)}`, amt: `−${kas((x.amount ?? 0) / SOMPI)}` }
      : x.kind === "repay" ? { c: LOAN_COLORS[x.slot ?? 0], title: `Repaid by ${name(x.slot)} · swept in with no key`, amt: `+${kas((x.amount ?? 0) / SOMPI, 4)}` }
      : x.kind === "markdown" ? { c: "#e66767", title: `${name(x.slot)} late · marked down on schedule`, amt: `${kas((x.from ?? 0) / SOMPI)} → ${kas((x.to ?? 0) / SOMPI)}` }
      : x.kind === "writeoff" ? { c: "#e66767", title: `${name(x.slot)} written off`, amt: `${kas((x.principal ?? 0) / SOMPI)}` }
      : x.kind === "mark" ? { c: "#c98500", title: "Loans marked by the valuer", amt: "" }
      : x.kind === "halt" ? { c: "#e66767", title: "Guardian halted the vault", amt: "" }
      : x.kind === "token" ? { c: LIQUID, title: "Share token created", amt: "" }
      : { c: LIQUID, title: x.kind, amt: "" };
    return { ...t, key: x.txid, at: x.at, sub: `${x.txid.slice(0, 16)}… · NAV ${kas(x.navAfter / SOMPI)} after${x.owner ? ` · ${short(x.owner)}` : ""}` };
  });

  return (
    <>
      <Banner short crumb={[{ href: "/vaults", label: "Vaults" }, { label: "Credit · testnet-10" }]} title="Credit vault"
        lede="Deposit KAS for shares at NAV. The vault lends to named borrowers; repayments can only come back into it, and a late loan loses value on a schedule nobody can stop." />
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
            <div><span className="eyebrow muted">NAV</span><b>{kas(f.nav)}</b><small>{kas(f.liquid)} liquid · {kas(f.lent)} in loans</small></div>
            <div><span className="eyebrow muted">Per share</span><b>{f.price.toFixed(6)}</b><small>{f.shares ? `${since >= 0 ? "+" : "−"}${pct(Math.abs(since), 2)} since launch at ${(FIRST_PRICE / SOMPI).toFixed(2)}` : "launch price"}</small></div>
            <div><span className="eyebrow muted">Loans</span><b>{f.loans.filter((x) => x.status !== "free").length} of {f.loans.length}</b><small>{kas(f.lentTotal, 0)} lent · {kas(f.repaidTotal, 2)} repaid</small></div>
            <div><span className="eyebrow muted">Holders</span><b>{f.holders}</b><small>{f.shares.toLocaleString("en-US")} shares · {kas(f.deposited, 0)} deposited</small></div>
          </div>
          <div>
            <div className="eyebrow muted" style={{ marginBottom: 10 }}>Where the NAV is</div>
            <SplitBar label="NAV by place" parts={[...f.loans.filter((x) => x.counts > 0).map((x) => ({ key: `l${x.slot}`, label: x.label, color: LOAN_COLORS[x.slot], share: x.counts, note: x.status === "free" ? "free" : `${kas(x.counts, 4)} counted · ${kas(x.principal, 4)} owed` })),
              { key: "liquid", label: "Liquid in the vault", color: LIQUID, share: Math.max(0, f.liquid), note: kas(f.liquid) }]} />
          </div>
        </div>

        <div className="card">
          <div className="c-head"><h3>Loans</h3><span className="tag">one per slot · read at DAA {f.at.toLocaleString("en-US")}</span></div>
          <div className="loans">{f.loans.map((x) => <LoanCard key={x.slot} loan={x} m={m} color={LOAN_COLORS[x.slot]} />)}</div>
          <p className="foot" style={{ marginBottom: 0 }}>A loan counts at the lower of the valuer&apos;s mark and the schedule: principal plus the contract interest while current; after {dur(m.graceDaa / DAA_PER_SEC)} of grace, {m.markdownStepBps / 100}% of principal less for every {dur(m.markdownPeriodDaa / DAA_PER_SEC)} late. Every deposit and withdrawal is priced this way by the covenant itself.</p>
        </div>

        <div className="card" id="position">
          <div className="c-head"><h3>Your position</h3><span className="tag">testnet KAS only</span></div>
          <NavPanel vault={l.covenantId} template={l.accountTemplate} price={f.price} minDeposit={m.minDepositSompi / SOMPI} noteValue={m.noteValueSompi / SOMPI} maxFee={m.maxFeeSompi / SOMPI} exitFeeBps={m.exitFeeBps} halted={l.state.halted} maturityOpen={maturityOpen} />
        </div>

        <div className="grid gA">
          <div className="card">
            <div className="c-head"><h3>Liquidity</h3><span className="tag">what can leave now</span></div>
            <div className="rings">
              <Ring value={payable} label="Payable now" sub="share of NAV held liquid" color={LIQUID} />
              <Ring value={m.reserveFloorBps / 1e4} label="Reserve floor" sub="no loan may go below it" color="#199e70" />
            </div>
            <p className="foot" style={{ marginBottom: 0 }}>Loaned KAS is back only when borrowers repay. A withdrawal larger than the liquid part waits for repayments.</p>
          </div>
          <div className="card">
            <div className="c-head"><h3>What is enforced, what is trusted</h3></div>
            <ul className="findings">
              <li>Loans leave only to the slot&apos;s registered borrower, within {m.borrowers.map((b) => `${b.capBps / 100}%`).join(" / ")} of NAV and a {m.reserveFloorBps / 100}% reserve.</li>
              <li>Repayments can only return into the vault; no key is needed to sweep them, and none can redirect them.</li>
              <li>Late loans lose value on the schedule above; anyone may write it in, and NAV always applies it.</li>
              <li>The valuer can raise a mark by at most {m.maxMarkStepBps / 100}% a period, never above principal plus interest.</li>
              <li className="no">That a borrower repays at all is a loan agreement off-chain: this is the one thing the network cannot enforce.</li>
            </ul>
          </div>
        </div>

        <div className="card">
          <div className="c-head"><h3>How your KAS moves</h3><span className="tag">every step checked by the network</span></div>
          <div className="flow">{CREDIT_STEPS.map(([h, p], i) => <div key={h} className="flow-step"><span>{i + 1}</span><b>{h}</b><small>{p}</small></div>)}</div>
        </div>

        <div className="card">
          <div className="c-head"><h3>Who can do what</h3><span className="tag">no key does two jobs</span></div>
          <div className="keys3 keys4">
            {([
              ["Allocator", "#3987e5", ["Lends to a slot's borrower", "Within caps and the reserve"], ["Cannot pay anyone else", "Cannot touch repayments"], m.roles.allocator],
              ["Valuer", "#c98500", ["Marks loans, a step per period", "Writes off a loan at zero"], ["Cannot move a single sompi", "Cannot hold a late loan up"], m.roles.valuer],
              ["Guardian", "#e66767", ["Created the share token", "Halts new loans and deposits"], ["Cannot take capital", "Cannot stop withdrawals"], m.roles.guardian],
              ["Anyone", "#199e70", ["Sweeps repayments, deposits, withdrawals", "Writes in overdue markdowns"], ["Cannot choose the outcome"], null],
            ] as [string, string, string[], string[], string | null][]).map(([n, c, yes, no, a]) => (
              <div key={n} className="key3" style={{ ["--c" as string]: c }}>
                <h4><i />{n}</h4>
                <ul>{yes.map((y) => <li key={y}>{y}</li>)}{no.map((x) => <li key={x} className="no">{x}</li>)}</ul>
                {a && <small className="mono">{short(a)}</small>}
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="c-head"><h3>History</h3><span className="tag">{l.moves.length} moves</span></div>
          <div className="vlog">
            {log.map((x) => (
              <a key={x.key} className="vlog-row" style={{ ["--c" as string]: x.c }} href={`https://tn10.kaspa.stream/transactions/${x.key}`} target="_blank" rel="noopener noreferrer">
                <i /><div><b>{x.title}</b><small>{when(x.at)} · {x.sub}</small></div><span className="amt">{x.amt}</span>
              </a>
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
        <p className="muted" style={{ fontSize: 13, margin: 0 }}>Testnet only, not audited, no outside capital. The borrowers are dawns-held test keys standing in for real institutions.</p>
      </div>
    </>
  );
}
