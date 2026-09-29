import Link from "next/link";
import { Banner } from "@/components/Banner";
import { Pill } from "@/components/bits";
import { SplitBar, Ring, CopyId } from "@/components/viz";
import { NavPanel } from "@/components/nav-panel";
import { SharePriceChart } from "@/components/share-chart";
import { BalanceSheet } from "@/components/balance-sheet";
import { Basis, TokenFamily, type Stamp } from "@/components/research";
import { VaultProof } from "@/components/vault-proof";
import { sharePoints } from "@/lib/vaults/share-history";
import { LoanCard, LOAN_COLORS, LIQUID, CREDIT_STEPS, kas, dur } from "@/components/credit-vault";
import { creditFigures, readCreditLive, SOMPI, FIRST_PRICE, DAA_PER_SEC, type CreditLedger, type CreditMandateDoc } from "@/lib/vaults/credit";


const short = (s: string) => (s.length > 22 ? `${s.slice(0, 14)}…${s.slice(-6)}` : s);
const when = (sec: number) => new Date(sec * 1000).toISOString().slice(0, 16).replace("T", " ") + " UTC";
const pct = (x: number, d = 0) => `${(x * 100).toFixed(d)}%`;

/** One credit vault, desktop: the reference vault or one launched from a strategy. */
export async function CreditVaultDesktop({ l, m, reference }: { l: CreditLedger; m: CreditMandateDoc; reference: boolean }) {
  const live = await readCreditLive(l);
  const f = creditFigures(l, m, live.daa);
  const maturityOpen = m.maturityDaa === 0 || f.at >= m.maturityDaa;
  const since = f.price / (FIRST_PRICE / SOMPI) - 1;
  const lastAt = (l.moves[l.moves.length - 1]?.at ?? l.createdAt) * 1000;
  const vs: Stamp = live.matches ? { kind: "onchain", by: "the vault's coin matches this ledger", at: lastAt } : { kind: "reported", by: "the operator's ledger", at: lastAt };
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

  const firstDep = l.moves.findIndex((x) => x.kind === "deposit");
  const seedJump = firstDep >= 0 && l.moves[firstDep].sharesAfter > 0 && l.moves[firstDep].navAfter / l.moves[firstDep].sharesAfter > FIRST_PRICE * 1.005;
  const history = sharePoints(l.createdAt, l.moves, FIRST_PRICE / SOMPI, f.price, (x) => { const e = log.find((y) => y.key === x.txid); return { title: e?.title ?? x.kind, amt: e?.amt || undefined }; });
  return (
    <>
      <Banner short crumb={[{ href: "/vaults", label: "Vaults" }, { label: reference ? "Credit · testnet-10" : `${m.name} · testnet-10` }]} title={reference ? "Credit vault" : m.name}
        lede={reference ? "Deposit KAS for shares at NAV. The vault lends to named borrowers; repayments can only come back into it, and a late loan loses value on a schedule nobody can stop." : m.objective || "A credit vault: loans to named borrowers, repayments only back into the vault, late loans marked down on schedule."} />
      <div className="wrap" style={{ paddingTop: 40, display: "grid", gap: 28 }}>
        {m.strategy && (
          <div className="card st-vcard current">
            <b>Launched from a strategy</b>
            <small className="muted">This vault runs <Link href={`/strategies/${m.strategy.id}`}>v{m.strategy.version} of its strategy</Link>, committed by hash in the mandate ({m.strategy.hash.slice(0, 12)}…): its terms cannot change under depositors. Anyone can launch one; dawns lists it because the checks below pass, not because it knows who runs it.</small>
          </div>
        )}
        <div className="card vault-hero">
          <div className="vault-top">
            <h2>{m.name}</h2>
            <div className="vault-tags"><Pill t="info">testnet-10</Pill><Pill t="warn">Not audited</Pill>{l.state.halted ? <Pill t="crit">Halted</Pill> : <Pill t="good">Open</Pill>}</div>
          </div>
          <VaultProof kind="credit" l={l} m={m} />
          <div className="depth-top depth-4" style={{ margin: 0 }}>
            <div><span className="eyebrow muted">NAV</span><b>{kas(f.nav)}</b><small>{kas(f.liquid)} liquid · {kas(f.lent)} in loans</small>
              <Basis stamp={vs} text={`KAS held by the vault's coin, less its ${kas(f.keep)} seed, plus each loan at the lower of the valuer's mark and the covenant's schedule. The same formula prices every deposit and withdrawal, inside the covenant.`} /></div>
            <div><span className="eyebrow muted">Per share</span><b>{f.price.toFixed(6)}</b><small>{f.shares ? `${since >= 0 ? "+" : "−"}${pct(Math.abs(since), 2)} since launch at ${(FIRST_PRICE / SOMPI).toFixed(2)}` : "launch price"}</small><Basis stamp={vs} text={`NAV ÷ ${f.shares.toLocaleString("en-US")} shares. Deposits mint at this price rounded up; withdrawals pay it rounded down, less the ${m.exitFeeBps / 100}% exit fee that stays with holders.`} /></div>
            <div><span className="eyebrow muted">Loans</span><b>{f.loans.filter((x) => x.status !== "free").length} of {f.loans.length}</b><small>{kas(f.lentTotal, 0)} lent · {kas(f.repaidTotal, 2)} repaid</small><Basis stamp={vs} text="Principal, due date and mark per slot, from the vault's state, which the covenant rewrites on every lend, repayment, markdown and mark. Whether a borrower will repay is the one figure no chain can give." /></div>
            <div><span className="eyebrow muted">Holders</span><b>{f.holders}</b><small>{f.shares.toLocaleString("en-US")} shares · {kas(f.deposited, 0)} deposited</small><Basis stamp={vs} text="Owners of live share notes: each deposit mints one KCC-20 note to its owner's personal withdrawal account, and each withdrawal burns a whole note." /></div>
          </div>
          <div>
            <div className="eyebrow muted" style={{ marginBottom: 10 }}>Where the NAV is</div>
            <SplitBar label="NAV by place" parts={[...f.loans.filter((x) => x.counts > 0).map((x) => ({ key: `l${x.slot}`, label: x.label, color: LOAN_COLORS[x.slot], share: x.counts, note: x.status === "free" ? "free" : `${kas(x.counts, 4)} counted · ${kas(x.principal, 4)} owed` })),
              { key: "liquid", label: "Liquid in the vault", color: LIQUID, share: Math.max(0, f.liquid), note: kas(f.liquid) }]} />
          </div>
        </div>

        <div className="card">
          <div className="c-head"><h3>Balance sheet</h3><span className="tag">{live.matches ? "the chain agrees" : "operator's ledger"}</span></div>
          <BalanceSheet fmt={(x) => kas(x)}
            assets={[{ key: "liquid", label: "KAS in the vault", value: f.held, color: LIQUID, note: `pays withdrawals now; includes the ${kas(f.keep)} seed` },
              ...f.loans.filter((x) => x.principal > 0).map((x) => ({ key: `l${x.slot}`, label: `Loan · ${x.label}`, value: x.counts, color: LOAN_COLORS[x.slot], note: x.counts < x.principal ? `${kas(x.principal)} owed; counted lower (${x.status === "zero" ? "marked to zero" : "late"})` : `${kas(x.principal)} owed` }))]}
            claims={[{ key: "holders", label: "Shareholders", value: f.nav, color: "#3987e5", note: `${f.shares.toLocaleString("en-US")} shares at ${f.price.toFixed(6)} KAS` }]}
            below={{ label: "The vault's own seed", value: f.keep, note: "never shares; kept so the vault can always price and pay" }}
            assetsTag="liquid + loans at their counted value" claimsTag="redeemable at NAV" ratioLabel="Assets ÷ claims"
            basis={<>Loans count at the lower of the valuer&apos;s mark and the covenant&apos;s schedule, exactly as every deposit and withdrawal prices them, so claims equal assets less the seed by construction. What this cannot show is whether borrowers will repay: that is the off-chain part.</>} />
        </div>

        <div className="card">
          <div className="c-head"><h3>Tokens and coins</h3><span className="tag">everything this vault is made of</span></div>
          <TokenFamily caption="Outstanding claims and the coins behind them" rows={[
            { letter: "S", color: "#3987e5", name: "Share token", role: `KCC-20 bound to the vault · ${f.shares.toLocaleString("en-US")} shares in ${f.liveNotes} note${f.liveNotes === 1 ? "" : "s"} · at ${f.price.toFixed(6)} KAS`, amount: kas(f.nav), id: l.shareCovid, main: true },
            { letter: "V", color: LIQUID, name: "Vault coin", role: "the covenant itself: one coin, its state in its script, moved only by its rules", amount: kas(f.held), id: l.address, href: `https://tn10.kaspa.stream/addresses/${l.address}` },
            { letter: "K", color: "#6E6788", name: "Seed", role: "the vault's own, inside the vault coin: never shares, kept so it can always price and pay", amount: kas(f.keep) },
            { letter: "N", color: "#9085e9", name: "Note deposits", role: `${kas(m.noteValueSompi / SOMPI)} held with each share note, returned with its withdrawal`, amount: kas((f.liveNotes * m.noteValueSompi) / SOMPI) },
            ...f.loans.filter((x) => x.repay).map((x) => ({ letter: "R", color: LOAN_COLORS[x.slot], name: `Repayment account · ${x.label}`, role: x.principal > 0 ? `${kas(x.principal)} owed; pays only into this vault` : "no loan open; a payment here would be a recovery", amount: x.principal > 0 ? kas(x.principal) : "—", id: x.repay, href: `https://tn10.kaspa.stream/addresses/${x.repay}` })),
          ]} />
        </div>

        <div className="card">
          <div className="c-head"><h3>Share price since launch</h3><span className="tag">after every move · KAS</span></div>
          <SharePriceChart points={history} launch={FIRST_PRICE / SOMPI} label="Share price since launch" />
          <p className="foot" style={{ marginBottom: 0 }}>The price moves only when value changes for everyone already in: interest, marks, markdowns and exit fees. Deposits and withdrawals happen at NAV and leave it where it is{seedJump ? <>, except the first deposit: shares were minted at the launch price while the vault&apos;s opening seed already counted in NAV, so the first holders received it</> : null}.</p>
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
        <p className="muted" style={{ fontSize: 13, margin: 0 }}>Testnet only, not audited, no outside capital. {reference ? "The borrowers are dawns-held test keys standing in for real institutions." : `Manager: ${m.manager ?? "—"}.`}</p>
      </div>
    </>
  );
}
