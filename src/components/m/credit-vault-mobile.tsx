import { creditFigures, readCreditLive, SOMPI, FIRST_PRICE, type CreditLedger, type CreditMandateDoc } from "@/lib/vaults/credit";
import { VaultProof } from "@/components/vault-proof";
import { MCard, MFlags, MHead, MHero, MKv, MList, MNote, MRow, MStats } from "@/components/m/kit";
import { MMore, MTabs } from "@/components/m/tabs";
import { NavPanel } from "@/components/nav-panel";
import { SharePriceChart } from "@/components/share-chart";
import { sharePoints } from "@/lib/vaults/share-history";
import { CopyId, SplitBar } from "@/components/viz";
import { Pill } from "@/components/bits";
import { LoanCard, LOAN_COLORS, LIQUID, kas } from "@/components/credit-vault";
import { BalanceSheet } from "@/components/balance-sheet";
import { TokenFamily } from "@/components/research";


const pct = (x: number, d = 0) => `${(x * 100).toFixed(d)}%`;
const short = (s: string) => (s.length > 22 ? `${s.slice(0, 12)}…${s.slice(-6)}` : s);
const when = (sec: number) => new Date(sec * 1000).toISOString().slice(0, 16).replace("T", " ");

/** One credit vault, phone. */
export async function CreditVaultMobile({ l, m }: { l: CreditLedger; m: CreditMandateDoc }) {
  const live = await readCreditLive(l);
  const f = creditFigures(l, m, live.daa);
  const maturityOpen = m.maturityDaa === 0 || f.at >= m.maturityDaa;
  const since = f.price / (FIRST_PRICE / SOMPI) - 1;
  const payable = f.nav > 0 ? Math.min(1, Math.max(0, f.liquid / f.nav)) : 1;
  const name = (i: number | undefined) => (i != null ? f.loans[i]?.label ?? "" : "");
  const log = [...l.moves].reverse().map((x) => ({
    key: x.txid, at: x.at,
    title: x.kind === "deposit" ? "Deposit" : x.kind === "redeem" ? "Withdrawal" : x.kind === "lend" ? `Lent to ${name(x.slot)}` : x.kind === "repay" ? `Repaid by ${name(x.slot)}` : x.kind === "markdown" ? `${name(x.slot)} marked down` : x.kind === "writeoff" ? `${name(x.slot)} written off` : x.kind === "mark" ? "Loans marked" : x.kind === "halt" ? "Guardian halted the vault" : x.kind === "token" ? "Share token created" : x.kind,
    amt: x.kind === "deposit" ? `+${kas((x.paid ?? 0) / SOMPI)}` : x.kind === "redeem" ? `−${kas((x.payout ?? 0) / SOMPI)}` : x.kind === "lend" ? `−${kas((x.amount ?? 0) / SOMPI)}` : x.kind === "repay" ? `+${kas((x.amount ?? 0) / SOMPI, 4)}` : x.kind === "markdown" ? `→ ${kas((x.to ?? 0) / SOMPI)}` : "",
  }));
  const history = sharePoints(l.createdAt, l.moves, FIRST_PRICE / SOMPI, f.price, (x) => { const e = log.find((y) => y.key === x.txid); return { title: e?.title ?? x.kind, amt: e?.amt || undefined }; });
  return (
    <>
      <MHead back={{ href: "/vaults", label: "Vaults" }} eyebrow="Credit · testnet-10 · not audited" title={m.name}
        right={l.state.halted ? <Pill t="crit">Halted</Pill> : <Pill t="good">Open</Pill>} />
      <div className="m-screen">
        <VaultProof kind="credit" l={l} m={m} compact />
        <MHero label="NAV" value={kas(f.nav)} sub={`${kas(f.liquid)} liquid · ${kas(f.lent)} in loans`} />
        <MStats items={[
          { label: "Per share", value: f.price.toFixed(6), sub: f.shares ? `${since >= 0 ? "+" : "−"}${pct(Math.abs(since), 2)} since launch` : "launch price" },
          { label: "Loans", value: `${f.loans.filter((x) => x.status !== "free").length} of ${f.loans.length}`, sub: `${kas(f.repaidTotal, 2)} repaid` },
          { label: "Payable now", value: pct(payable), sub: "of NAV held liquid" },
          { label: "Holders", value: String(f.holders), sub: `${f.shares.toLocaleString("en-US")} shares` },
        ]} />
        <MCard title="Share price since launch"><SharePriceChart points={history} launch={FIRST_PRICE / SOMPI} label="Share price since launch" /></MCard>
        <MTabs tabs={[{ key: "y", label: "Deposit & withdraw" }, { key: "o", label: "Loans" }, { key: "l", label: "History", badge: l.moves.length }, { key: "r", label: "Rules" }]}>
          <div className="m-panel">
            <MCard><NavPanel vault={l.covenantId} template={l.accountTemplate} price={f.price} minDeposit={m.minDepositSompi / SOMPI} noteValue={m.noteValueSompi / SOMPI} maxFee={m.maxFeeSompi / SOMPI} exitFeeBps={m.exitFeeBps} halted={l.state.halted} maturityOpen={maturityOpen} /></MCard>
            <MNote>Testnet KAS only. Loaned KAS is back only when borrowers repay: a large withdrawal can wait for repayments.</MNote>
          </div>
          <div className="m-panel">
            <MCard title="Where the NAV is">
              <SplitBar label="NAV by place" height={18} parts={[...f.loans.filter((x) => x.counts > 0).map((x) => ({ key: `l${x.slot}`, label: x.label, color: LOAN_COLORS[x.slot], share: x.counts })), { key: "liquid", label: "Liquid in the vault", color: LIQUID, share: Math.max(0, f.liquid) }]} />
            </MCard>
            <MCard title="Balance sheet">
              <BalanceSheet fmt={(x) => kas(x)}
                assets={[{ key: "liquid", label: "KAS in the vault", value: f.held, color: LIQUID, note: `incl. the ${kas(f.keep)} seed` }, ...f.loans.filter((x) => x.principal > 0).map((x) => ({ key: `l${x.slot}`, label: `Loan · ${x.label}`, value: x.counts, color: LOAN_COLORS[x.slot], note: `${kas(x.principal)} owed` }))]}
                claims={[{ key: "holders", label: "Shareholders", value: f.nav, color: "#3987e5" }]}
                below={{ label: "The vault's own seed", value: f.keep, note: "never shares" }} ratioLabel="Assets ÷ claims" />
            </MCard>
            <div className="loans">{f.loans.map((x) => <LoanCard key={x.slot} loan={x} m={m} color={LOAN_COLORS[x.slot]} />)}</div>
          </div>
          <div className="m-panel">
            <MCard flush>
              <MList>
                <MMore first={10} label="All moves">
                  {log.map((x) => <MRow key={x.key} href={`https://tn10.kaspa.stream/transactions/${x.key}`} ext title={x.title} sub={when(x.at)} value={x.amt} />)}
                </MMore>
              </MList>
            </MCard>
          </div>
          <div className="m-panel">
            <MCard title="Enforced and trusted">
              <MFlags flags={[
                ["good", "Loans leave only to the slot's registered borrower, within its cap and the reserve."],
                ["good", "Repayments can only return into the vault; no key can redirect them."],
                ["good", "Late loans lose value on a schedule anyone can write in; NAV always applies it."],
                ["warn", "That a borrower repays at all is a loan agreement off-chain."],
              ]} />
            </MCard>
            <MCard title="Tokens and coins">
              <TokenFamily caption="Claims and the coins behind them" rows={[
                { letter: "S", color: "#3987e5", name: "Share token", role: `${f.shares.toLocaleString("en-US")} shares in ${f.liveNotes} notes`, amount: kas(f.nav), id: l.shareCovid, main: true },
                { letter: "V", color: LIQUID, name: "Vault coin", role: "the covenant itself", amount: kas(f.held), id: l.address, href: `https://tn10.kaspa.stream/addresses/${l.address}` },
                { letter: "K", color: "#6E6788", name: "Seed", role: "the vault's own, never shares", amount: kas(f.keep) },
                ...f.loans.filter((x) => x.repay && x.principal > 0).map((x) => ({ letter: "R", color: LOAN_COLORS[x.slot], name: `Repayment · ${x.label}`, role: "pays only into this vault", amount: kas(x.principal), id: x.repay, href: `https://tn10.kaspa.stream/addresses/${x.repay}` })),
              ]} />
            </MCard>
            <MCard title="The mandate">
              <MKv rows={[["Minimum deposit", kas(m.minDepositSompi / SOMPI)], ["Reserve floor", pct(m.reserveFloorBps / 1e4)], ["Markdown", `${m.markdownStepBps / 100}% per period late`], ["Vault address", short(l.address)]]} />
              <CopyId text={l.mandateHash} />
            </MCard>
          </div>
        </MTabs>
      </div>
    </>
  );
}
