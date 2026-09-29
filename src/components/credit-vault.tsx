import { Pill } from "./bits";
import { CopyId } from "./viz";
import { DAA_PER_SEC, type CreditMandateDoc, type LoanView } from "@/lib/vaults/credit";

export const LOAN_COLORS = ["#3987e5", "#d95926", "#199e70"];
export const LIQUID = "#9085e9";
export const kas = (x: number, d = 2) => `${x.toLocaleString("en-US", { maximumFractionDigits: d })} KAS`;

/** 3,600 s → "1 h", 5,400 → "1 h 30 min", 90,000 → "1 d 1 h" */
export function dur(sec: number) {
  const s = Math.max(0, Math.round(sec));
  const d = Math.floor(s / 86_400), h = Math.floor((s % 86_400) / 3_600), m = Math.floor((s % 3_600) / 60);
  if (d) return `${d} d${h ? ` ${h} h` : ""}`;
  if (h) return `${h} h${m ? ` ${m} min` : ""}`;
  return m ? `${m} min` : `${s} s`;
}

const STATUS: Record<LoanView["status"], [ "good" | "warn" | "crit" | "info", string]> = {
  free: ["info", "Free"], current: ["good", "Current"], grace: ["warn", "In grace"], late: ["crit", "Late · marked down"], zero: ["crit", "Marked to zero"],
};

/**
 * One loan's life on one line: the term, the grace, then the markdown steps
 * that nobody can stop, with "now" on it. Widths follow the DAA each phase
 * lasts, with a floor so a one-hour grace stays visible next to a 30-day term.
 */
function LoanTrack({ loan, m }: { loan: LoanView; m: CreditMandateDoc }) {
  const steps = Math.max(1, Math.ceil(10_000 / Math.max(1, m.markdownStepBps)));
  const T = loan.termDaa, G = m.graceDaa, P = m.markdownPeriodDaa * steps;
  const raw = [T, G, P];
  const tot = raw.reduce((a, x) => a + x, 0);
  const w = raw.map((x) => Math.max(0.16, x / tot));
  const sum = w.reduce((a, x) => a + x, 0);
  const [wt, wg, wm] = w.map((x) => x / sum);
  let pos: number | null = null;
  if (loan.principal > 0 && loan.due > 0) {
    if (loan.secondsToDue != null) pos = wt * Math.max(0, 1 - (loan.secondsToDue * DAA_PER_SEC) / T);
    else {
      const late = (loan.lateSeconds ?? 0) * DAA_PER_SEC;
      pos = late < G ? wt + wg * (late / G) : wt + wg + wm * Math.min(1, (late - G) / P);
    }
  }
  return (
    <div className="lt" aria-hidden>
      <div className="lt-bar">
        <span className="lt-term" style={{ flexBasis: `${wt * 100}%` }} />
        <span className="lt-grace" style={{ flexBasis: `${wg * 100}%` }} />
        <span className="lt-md" style={{ flexBasis: `${wm * 100}%` }}>
          {Array.from({ length: steps }, (_, k) => <i key={k} style={{ opacity: 0.35 + (0.65 * (k + 1)) / steps }} />)}
        </span>
      </div>
      <div className="lt-cap"><span>term {dur(T / DAA_PER_SEC)}</span><span>then {dur(G / DAA_PER_SEC)} grace · −{m.markdownStepBps / 100}% per {dur(m.markdownPeriodDaa / DAA_PER_SEC)}</span></div>
      {pos != null && <b className={`lt-now${pos < 0.1 ? " lft" : pos > 0.9 ? " rgt" : ""}`} style={{ left: `${pos * 100}%` }}><small>now</small></b>}
    </div>
  );
}

export function LoanCard({ loan, m, color }: { loan: LoanView; m: CreditMandateDoc; color: string }) {
  const [t, label] = STATUS[loan.status];
  const when = loan.status === "free" ? `Up to ${loan.capBps / 100}% of NAV · ${loan.interestBps / 100}% over ${dur(loan.termDaa / DAA_PER_SEC)}`
    : loan.status === "current" ? `Due in ${dur(loan.secondsToDue ?? 0)} · ${kas(loan.owedAtTerm, 4)} with interest`
    : loan.status === "grace" ? `${dur(loan.lateSeconds ?? 0)} late · counts in full until the grace ends in ${dur(m.graceDaa / DAA_PER_SEC - (loan.lateSeconds ?? 0))}`
    : loan.status === "late" ? `${dur(loan.lateSeconds ?? 0)} late · counts ${Math.round((loan.counts / Math.max(1e-9, loan.principal)) * 100)}% of principal${loan.nextCutIn != null ? `, ${kas(loan.nextCounts ?? 0)} in ${dur(loan.nextCutIn)}` : ""}`
    : "Counts nothing in NAV. The valuer may write it off; any later payment is a recovery.";
  return (
    <div className={`loan ${loan.status}`} style={{ ["--c" as string]: color }}>
      <div className="loan-h">
        <span className="loan-n"><i /><span><b>{loan.label}</b><small className="mono">{loan.address.slice(0, 16)}…{loan.address.slice(-6)}</small></span></span>
        <Pill t={t}>{label}</Pill>
      </div>
      {loan.status !== "free" ? (
        <div className="loan-fig">
          <span><small>Owed</small><b>{kas(loan.principal, 4)}</b></span>
          <span><small>Valuer&apos;s mark</small><b>{kas(loan.mark, 4)}</b></span>
          <span><small>Counts in NAV</small><b className={loan.counts < loan.mark ? "down" : undefined}>{kas(loan.counts, 4)}</b></span>
        </div>
      ) : null}
      <LoanTrack loan={loan} m={m} />
      <p className="loan-when">{when}</p>
      {loan.repay && loan.status !== "free" && (
        <details className="navp-alt"><summary>Repayment address</summary><div><CopyId text={loan.repay} /><small className="muted">Any wallet can pay it. The coin can only go into this vault (or back to the borrower until it is swept); no key can redirect it.</small></div></details>
      )}
    </div>
  );
}

export const CREDIT_STEPS: [string, string][] = [
  ["You deposit KAS", "to your personal deposit address, from any wallet. The vault mints shares at NAV."],
  ["The allocator lends", "only to a slot's registered borrower, within its cap of NAV and the reserve floor. One loan per slot."],
  ["The borrower repays", "to the slot's repayment address. It can only flow into the vault; anyone can sweep it in."],
  ["If it is late", "after the grace the loan counts less every period, on a schedule anyone can write in. Deposits and withdrawals always use it."],
];
