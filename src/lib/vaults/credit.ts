import "server-only";
import creditDoc from "../../../vault/deploy/credit.json";
import creditMandateDoc from "../../../vault/deploy/credit-mandate.json";
import { sql, hasDb, ensureSchema } from "@/lib/db";
import { readNavLive, SOMPI, FIRST_PRICE, type NavNote, type NavLive } from "./nav";
import type { AccountTemplate } from "./account";

/**
 * The credit vault on testnet-10 (vault/credit/dawns_credit.sil). Shares,
 * personal accounts and notes are the NAV vault's, so deposit, withdraw and
 * portfolio code read it unchanged; its three slots are loans to named
 * borrowers. NAV counts a late loan at most at its markdown schedule's cap,
 * exactly as the covenant does.
 */
export { SOMPI, FIRST_PRICE };
/** testnet-10 runs 10 blocks a second */
export const DAA_PER_SEC = 10;

export interface CreditState { shareCovid: string; shares: number; principal: number[]; due: number[]; marks: number[]; epochIndex: number; epochSpent: number; markEpoch: number; halted: boolean }
export interface CreditMove { kind: string; txid: string; at: number; daa?: number; valueAfter: number; sharesAfter: number; navAfter: number; owner?: string; paid?: number; shares?: number; price?: number; payout?: number; slot?: number; amount?: number; due?: number; from?: number; to?: number; marks?: number[]; principal?: number }
export interface CreditLedger {
  status?: "planned";
  name?: string; manager?: string; standard?: string; network?: string;
  covenantId: string; shareCovid: string | null; mandateHash: string; genesisTx: string; tokenTx: string | null; createdAt: number; seed: number;
  state: CreditState; address: string; value: number; accountTemplate: AccountTemplate; repayAddresses: string[];
  notes: NavNote[]; moves: CreditMove[];
}
export interface CreditMandateDoc {
  name: string; objective: string; manager?: string; network: string; standard: string;
  roles: { allocator: string; valuer: string; guardian: string };
  borrowers: { label: string; address: string; capBps: number; termDaa: number; interestBps: number }[];
  graceDaa: number; markdownStepBps: number; markdownPeriodDaa: number;
  reserveFloorBps: number; maxPerMoveSompi: number; epochLimitSompi: number; epochLengthDaa: number; maxFeeSompi: number; notBeforeDaa: number;
  maturityDaa: number; depositUntilDaa: number; minDepositSompi: number; maxMarkStepBps: number; noteValueSompi: number; minKeepSompi: number; exitFeeBps: number;
}

const raw = creditDoc as unknown as Partial<CreditLedger>;
export const creditLedger = (raw.status !== "planned" && raw.covenantId ? raw : null) as CreditLedger | null;
export const creditMandate = ((creditMandateDoc as unknown as { standard?: string }).standard === "dawns-credit/0" ? creditMandateDoc : null) as CreditMandateDoc | null;

/** The git ledger, or a newer one the keeper published (same vault, mandate, never fewer moves). */
export async function getCredit(): Promise<{ l: CreditLedger | null; m: CreditMandateDoc | null }> {
  if (!creditLedger || !creditMandate || !hasDb()) return { l: creditLedger, m: creditMandate };
  try {
    await ensureSchema();
    const r = (await sql().query("select doc from vault_ledgers where vault = $1", [creditLedger.covenantId])) as { doc: CreditLedger }[];
    const d = r[0]?.doc;
    if (d && d.covenantId === creditLedger.covenantId && d.mandateHash === creditLedger.mandateHash && Array.isArray(d.moves) && d.moves.length >= creditLedger.moves.length) return { l: d, m: creditMandate };
  } catch { /* fall back to git */ }
  return { l: creditLedger, m: creditMandate };
}

export const readCreditLive = (l: CreditLedger): Promise<NavLive> => readNavLive(l as never);

/** The most a loan may count for at `at` (sompi), as limitOf in the covenant. */
export function limitOf(m: CreditMandateDoc, i: number, s: CreditState, at: number) {
  const p = s.principal[i] ?? 0;
  const interest = m.borrowers[i]?.interestBps ?? 0;
  let top = Math.floor((p * (10_000 + interest)) / 10_000);
  const due = s.due[i] ?? 0;
  if (due > 0 && at - due - m.graceDaa >= 0) {
    const cut = Math.min(10_000, (Math.floor((at - due - m.graceDaa) / m.markdownPeriodDaa) + 1) * m.markdownStepBps);
    top = Math.floor((p * (10_000 - cut)) / 10_000);
  }
  return top;
}

export type LoanStatus = "free" | "current" | "grace" | "late" | "zero";
export interface LoanView {
  slot: number; label: string; address: string; repay: string | null;
  capBps: number; termDaa: number; interestBps: number;
  principal: number; mark: number; counts: number; owedAtTerm: number; // KAS
  due: number; status: LoanStatus; secondsToDue: number | null; lateSeconds: number | null;
  /** the schedule's next step down, while late */
  nextCutIn: number | null; nextCounts: number | null;
}

/** Ledger figures in KAS at chain DAA `at` (falls back to the last recorded move's DAA). */
export function creditFigures(l: CreditLedger, m: CreditMandateDoc, daa: number | null) {
  // without a live read, project the DAA from the last recorded move at 10 a second
  const last = [...l.moves].reverse().find((x) => x.daa);
  const est = last?.daa ? last.daa + Math.max(0, Math.floor(Date.now() / 1000) - last.at) * DAA_PER_SEC : m.notBeforeDaa;
  const at = (daa ?? est) - 100;
  const s = l.state;
  const held = l.value / SOMPI;
  const keep = m.minKeepSompi / SOMPI;
  const loans: LoanView[] = m.borrowers.map((b, i) => {
    const p = s.principal[i] ?? 0, due = s.due[i] ?? 0, mark = s.marks[i] ?? 0;
    const cap = limitOf(m, i, s, at);
    const counts = Math.min(mark, cap);
    const late = due > 0 ? at - due : null;
    const status: LoanStatus = p === 0 ? "free" : counts === 0 ? "zero" : late == null || late < 0 ? "current" : late < m.graceDaa ? "grace" : "late";
    let nextCutIn: number | null = null, nextCounts: number | null = null;
    if (p > 0 && due > 0 && counts > 0) {
      const start = due + m.graceDaa;
      const nextAt = at < start ? start : start + (Math.floor((at - start) / m.markdownPeriodDaa) + 1) * m.markdownPeriodDaa;
      nextCutIn = (nextAt - at) / DAA_PER_SEC;
      nextCounts = Math.min(mark, limitOf(m, i, s, nextAt)) / SOMPI;
    }
    return {
      slot: i, label: b.label.replace(" (test key)", ""), address: b.address, repay: l.repayAddresses?.[i] ?? null,
      capBps: b.capBps, termDaa: b.termDaa, interestBps: b.interestBps,
      principal: p / SOMPI, mark: mark / SOMPI, counts: counts / SOMPI, owedAtTerm: Math.floor((p * (10_000 + b.interestBps)) / 10_000) / SOMPI,
      due, status, secondsToDue: late != null && late < 0 ? -late / DAA_PER_SEC : null, lateSeconds: late != null && late >= 0 ? late / DAA_PER_SEC : null,
      nextCutIn, nextCounts,
    };
  });
  const lent = loans.reduce((a, x) => a + x.counts, 0);
  const nav = held - keep + lent;
  const price = s.shares > 0 ? nav / s.shares : FIRST_PRICE / SOMPI;
  const live = l.notes.filter((n) => !n.redeemed);
  const sum = (k: string, f: (x: CreditMove) => number) => l.moves.filter((x) => x.kind === k).reduce((a, x) => a + f(x), 0) / SOMPI;
  return {
    at, held, keep, liquid: held - keep, lent, nav, price, loans,
    shares: s.shares, holders: new Set(live.map((n) => n.owner)).size, liveNotes: live.length,
    deposited: sum("deposit", (x) => x.paid ?? 0), paidOut: sum("redeem", (x) => x.payout ?? 0),
    lentTotal: sum("lend", (x) => x.amount ?? 0), repaidTotal: sum("repay", (x) => x.amount ?? 0),
    markedDown: sum("markdown", (x) => (x.from ?? 0) - (x.to ?? 0)), writtenOff: sum("writeoff", (x) => x.principal ?? 0),
  };
}
export type CreditFigures = ReturnType<typeof creditFigures>;
