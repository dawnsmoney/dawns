import { BORROWER, type StrategyDoc } from "./model";
import { decodeKaspaAddress } from "../auth/kaspa";

/**
 * A strategy made only of private-credit legs, as the mandate of a credit vault
 * (vault/credit/dawns_credit.sil). Pure and client-safe. What maps one to one
 * maps; what the covenant cannot carry is said, never silently dropped.
 *
 *   loan leg    → a borrower slot: address, cap of NAV, term, contract interest
 *   grace, markdown → one schedule for all loans (the covenant has one): the strictest
 *   reserve     → the reserve floor every loan must leave
 *   exit fee    → the exit fee, kept for the holders who stay
 *   fixed term  → maturity and deposit window, counted from launch
 */
export const DAA_PER_DAY = 864_000; // 10 blocks a second
export const CREDIT_SLOTS = 3;

export type Issue = { t: "crit" | "warn" | "info"; text: string };
export interface Mapped { term: string; from: string; to: string; how: "network" | "operator" | "off-chain" | "dropped" }
export interface Roles { allocator: string; valuer: string; guardian: string }

export interface CreditDraft {
  eligible: boolean;
  issues: Issue[];
  map: Mapped[];
  loans: { label: string; capBps: number; termDays: number; rateBps: number; interestBps: number }[];
  mandate: Record<string, unknown> | null;   // null until every address is in and valid
}

/** A plain (Schnorr P2PK) address on the vault's network, or why not. */
export function checkAddress(a: string, prefix: "kaspatest" | "kaspa"): string | null {
  const v = a.trim().toLowerCase();
  if (!v) return "missing";
  try {
    const d = decodeKaspaAddress(v);
    if (d.prefix !== prefix) return `use a ${prefix}: address`;
    if (d.version !== 0 || d.payload.length !== 32) return "must be a plain wallet address (not a script)";
    return null;
  } catch { return "not a Kaspa address"; }
}

const pctB = (b: number) => `${+(b / 100).toFixed(2)}%`;

export function creditDraft(doc: StrategyDoc, ref: { id: string; version: number; hash: string; strategist: string }, borrowers: string[], roles: Roles | null, prefix: "kaspatest" | "kaspa" = "kaspatest"): CreditDraft {
  const issues: Issue[] = [];
  const credit = doc.legs.filter((l) => l.credit);
  const market = doc.legs.filter((l) => !l.credit);
  if (!credit.length) issues.push({ t: "crit", text: "No private-credit legs: a credit vault lends to named borrowers. Market legs belong in a NAV vault." });
  if (market.length) issues.push({ t: "crit", text: `${market.length} market leg${market.length > 1 ? "s" : ""} (${market.map((l) => l.opp).join(", ")}): a credit vault holds loans only. Make a strategy of just the loans, or run the markets in a NAV vault.` });
  if (credit.length > CREDIT_SLOTS) issues.push({ t: "crit", text: `${credit.length} loans: the covenant has ${CREDIT_SLOTS} borrower slots.` });
  if (doc.vault.type === "fixed" && credit.some((l) => l.credit!.termDays > doc.vault.termDays)) issues.push({ t: "crit", text: `A loan runs longer than the vault's ${doc.vault.termDays}-day term: every loan must fall due before maturity.` });

  const loans = credit.map((l) => {
    const c = l.credit!;
    return { label: `${c.borrower} · ${BORROWER[c.kind]}`, capBps: l.cap, termDays: c.termDays, rateBps: c.rateBps, interestBps: Math.round((c.rateBps * c.termDays) / 365) };
  });
  const graces = credit.map((l) => l.credit!.graceDays), steps = credit.map((l) => l.credit!.markdownBps);
  const grace = graces.length ? Math.min(...graces) : 0, step = steps.length ? Math.max(...steps) : 0;
  if (new Set(graces).size > 1 || new Set(steps).size > 1) issues.push({ t: "warn", text: `The loans have different grace or markdown terms; the covenant has one schedule for all, so the strictest applies: ${grace} days of grace, then −${pctB(step)} of principal every 30 days.` });
  if (step === 0 && credit.length) issues.push({ t: "warn", text: "Markdown \"never\": a late loan would keep counting at full value. The covenant allows it; depositors would carry the risk unseen." });
  if (doc.fees.performanceBps || doc.fees.managementBps) issues.push({ t: "warn", text: `Fees (${pctB(doc.fees.performanceBps)} of yield${doc.fees.managementBps ? `, ${pctB(doc.fees.managementBps)} a year` : ""}): the credit covenant has no fee path yet, so the vault launches without them.` });
  if (doc.vault.access !== "permissionless") issues.push({ t: "warn", text: `Access "${doc.vault.access}": the covenant cannot restrict who deposits yet; anyone with the address can.` });
  if (credit.some((l) => l.credit!.collateral === "secured")) issues.push({ t: "info", text: "Collateral is held off-chain under the loan agreement; the vault cannot see or seize it." });
  if (credit.some((l) => l.credit!.reporting === "self")) issues.push({ t: "info", text: "Loan standing is reported by the borrower. The valuer marks loans; the schedule still marks late ones down whatever anyone reports." });

  const map: Mapped[] = [
    ...loans.map((x, i): Mapped => ({ term: `Loan ${i + 1}: ${x.label}`, from: `${pctB(credit[i].target)} target, ${pctB(x.capBps)} hard cap`, to: `slot ${i}: at most ${pctB(x.capBps)} of NAV, one loan at a time`, how: "network" })),
    ...loans.map((x, i): Mapped => ({ term: `Loan ${i + 1} terms`, from: `${pctB(x.rateBps)} a year for ${x.termDays} days`, to: `due ${x.termDays} days after lending; marks capped at principal + ${pctB(x.interestBps)}`, how: "network" })),
    { term: "If late", from: `${grace} days grace, then −${pctB(step)} / 30 days`, to: step ? `after ${grace} days, ${pctB(step)} of principal less for every 30 days late, written in by anyone; deposits and withdrawals always price it` : "never marked down by rule", how: "network" },
    { term: "Repayment", from: "the borrower's promise, under the loan agreement", to: "whether it comes is off-chain; when it does, a keyless account can only pay it into the vault", how: "off-chain" },
    { term: "Reserve", from: pctB(doc.reserveBps), to: `reserve floor ${pctB(doc.reserveBps)}: no loan may leave less`, how: "network" },
    { term: "Exit fee", from: pctB(doc.vault.exitFeeBps), to: `${pctB(doc.vault.exitFeeBps)} of each payout stays with holders`, how: "network" },
    { term: "Term", from: doc.vault.type === "fixed" ? `fixed, ${doc.vault.termDays} days; deposits ${doc.vault.depositDays} days` : "open", to: doc.vault.type === "fixed" ? `maturity and deposit window counted from launch` : "redeem any time, from liquid KAS", how: "network" },
    { term: "Capacity", from: `${doc.vault.capacityKas.toLocaleString("en-US")} KAS`, to: `lending limited to ${doc.vault.capacityKas.toLocaleString("en-US")} KAS a day; deposits are not capped on-chain`, how: "operator" },
    ...(doc.fees.performanceBps || doc.fees.managementBps ? [{ term: "Fees", from: `${pctB(doc.fees.performanceBps)} of yield`, to: "not charged (no fee path in the covenant yet)", how: "dropped" } as Mapped] : []),
  ];

  const addrErr = loans.map((_, i) => checkAddress(borrowers[i] ?? "", prefix));
  const roleErr = roles ? (["allocator", "valuer", "guardian"] as const).map((k) => checkAddress(roles[k], prefix)) : ["missing"];
  const addrs = borrowers.slice(0, loans.length).map((a) => a.trim().toLowerCase());
  const keys = roles ? [roles.allocator, roles.valuer, roles.guardian].map((a) => a.trim().toLowerCase()) : [];
  const distinct = new Set([...addrs, ...keys]).size === addrs.length + keys.length;
  const eligible = !issues.some((x) => x.t === "crit");
  const ready = eligible && addrErr.every((e) => !e) && roleErr.every((e) => !e) && distinct;

  const mandate = ready ? {
    standard: "dawns-credit/0",
    network: prefix === "kaspatest" ? "testnet-10" : "mainnet",
    name: doc.name,
    objective: doc.thesis,
    manager: ref.strategist,
    strategy: { id: ref.id, version: ref.version, hash: ref.hash },
    roles: { allocator: keys[0], valuer: keys[1], guardian: keys[2] },
    borrowers: loans.map((x, i) => ({ label: x.label, address: addrs[i], capBps: x.capBps, termDaa: x.termDays * DAA_PER_DAY, interestBps: x.interestBps })),
    graceDaa: grace * DAA_PER_DAY, markdownStepBps: step, markdownPeriodDaa: 30 * DAA_PER_DAY,
    reserveFloorBps: doc.reserveBps,
    maxPerMoveSompi: Math.round(doc.vault.capacityKas * (Math.max(...loans.map((x) => x.capBps)) / 10_000)) * 1e8,
    epochLimitSompi: doc.vault.capacityKas * 1e8, epochLengthDaa: DAA_PER_DAY,
    maxFeeSompi: 10_000_000, notBeforeDaa: 0,
    maturityDaa: 0, depositUntilDaa: 0,
    ...(doc.vault.type === "fixed" ? { maturityDays: doc.vault.termDays, depositDays: doc.vault.depositDays } : {}),
    minDepositSompi: 5 * 1e8, maxMarkStepBps: 500, noteValueSompi: 1e8, minKeepSompi: 1e8, exitFeeBps: doc.vault.exitFeeBps,
  } : null;
  if (eligible && !distinct && addrs.every(Boolean) && keys.every(Boolean)) issues.push({ t: "crit", text: "Every borrower and every key needs its own address: no key does two jobs." });
  return { eligible, issues, map, loans, mandate };
}
