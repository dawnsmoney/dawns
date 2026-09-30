import "server-only";
import navDoc from "../../../vault/deploy/nav.json";
import navMandateDoc from "../../../vault/deploy/nav-mandate.json";
import fixedDoc from "../../../vault/deploy/fixed/nav.json";
import fixedMandateDoc from "../../../vault/deploy/fixed/nav-mandate.json";
import navStrategyDoc from "../../../vault/deploy/strategy.json";
import fixedStrategyDoc from "../../../vault/deploy/fixed/strategy.json";
import demoDoc from "../../../vault/deploy/demo/nav.json";
import demoMandateDoc from "../../../vault/deploy/demo/nav-mandate.json";
import demoStrategyDoc from "../../../vault/deploy/demo/strategy.json";
import { accountAddress, ownerOf, fromHex, toHex, type AccountTemplate } from "./account";
import { sql, hasDb, ensureSchema } from "@/lib/db";

/**
 * The NAV vault on testnet-10. As for the mandate vault: the ledger (nav.json,
 * written by vault/deploy before every broadcast and committed after a run) and
 * the chain (the public TN10 REST API, read only) are kept apart, and the page
 * says when they disagree.
 */
const API = "https://api-tn10.kaspa.org";
export const SOMPI = 1e8;
export const FIRST_PRICE = 1_000_000; // sompi per share at launch: 1 share = 0.01 KAS

export interface NavState { shareCovid: string; shares: number; deployed: number[]; marks: number[]; epochIndex: number; epochSpent: number; markEpoch: number; halted: boolean }
export interface NavNote { owner: string; shares: number; txid: string; index: number; value: number; at: number; price: number; redeemed?: { txid: string; at: number; payout: number; price: number } | null }
export interface NavMove { kind: string; txid: string; at: number; valueAfter: number; sharesAfter: number; navAfter: number; owner?: string; paid?: number; shares?: number; price?: number; payout?: number; slot?: number; amount?: number; marks?: number[] }
export interface NavLedger {
  status?: "planned";
  name?: string; manager?: string; standard?: string; network?: string;
  /** the covenant version the vault runs ("dawns-nav/1", "/1.1", "/1.2"); absent on the first TN10 vault (v1) */
  covenant?: string;
  covenantId: string; shareCovid: string | null; mandateHash: string; genesisTx: string; tokenTx: string | null; createdAt: number; seed: number;
  state: NavState; address: string; value: number; accountTemplate: AccountTemplate; notes: NavNote[]; moves: NavMove[];
}
export interface NavMandateDoc {
  name: string; objective: string; manager?: string; network: string; standard: string;
  roles: { allocator: string; valuer: string; guardian: string };
  destinations: { label: string; address: string; capBps: number }[];
  reserveFloorBps: number; maxPerMoveSompi: number; epochLimitSompi: number; epochLengthDaa: number; maxFeeSompi: number; notBeforeDaa: number;
  maturityDaa: number; depositUntilDaa: number; minDepositSompi: number; maxMarkStepBps: number; noteValueSompi: number; minKeepSompi: number; exitFeeBps: number;
}

const ledgerOf = (d: unknown) => { const r = d as Partial<NavLedger>; return (r.status !== "planned" && r.covenantId ? r : null) as NavLedger | null; };
const mandateOf = (d: unknown) => ((d as { standard?: string }).standard ? d : null) as NavMandateDoc | null;

/**
 * Every vault that runs the NAV covenant. A fixed-term vault is the same covenant with
 * a maturity and a deposit window in its mandate; each lives in its own directory of
 * vault/deploy (one vault per directory), its ledger and mandate committed there.
 */
export type NavSlug = "nav-tn10" | "fixed-tn10" | "demo-tn10";
/** The strategy the keeper runs inside the mandate (vault/deploy/…/strategy.json). */
export interface NavStrategy { targetsBps: number[]; liquidBps: number; minMoveKas: string; credit?: { slot: number } }
export interface NavVaultDef { slug: NavSlug; kind: "nav" | "fixed"; ledger: NavLedger | null; mandate: NavMandateDoc | null; strategy: NavStrategy | null }
export const NAV_VAULTS: NavVaultDef[] = [
  { slug: "nav-tn10", kind: "nav", ledger: ledgerOf(navDoc), mandate: mandateOf(navMandateDoc), strategy: navStrategyDoc as NavStrategy },
  { slug: "fixed-tn10", kind: "fixed", ledger: ledgerOf(fixedDoc), mandate: mandateOf(fixedMandateDoc), strategy: fixedStrategyDoc as NavStrategy },
  // the demo pair's NAV vault: an accelerated clock, 60% lending through the demo credit vault
  { slug: "demo-tn10", kind: "nav", ledger: ledgerOf(demoDoc), mandate: mandateOf(demoMandateDoc), strategy: demoStrategyDoc as NavStrategy },
];
export const navVault = (slug: NavSlug) => NAV_VAULTS.find((v) => v.slug === slug)!;
export const navByCovenant = (id: string | null | undefined) => (id ? NAV_VAULTS.find((v) => v.ledger?.covenantId === id) ?? null : null);

// the first NAV vault, as before
export const navLive = !!NAV_VAULTS[0].ledger;
export const navLedger = NAV_VAULTS[0].ledger;
export const navMandate = NAV_VAULTS[0].mandate;

/** TN10 runs at 10 blocks a second: DAA score to a time, from a current reading. */
export const DAA_PER_SEC = 10;
export const daaToTime = (target: number, daaNow: number, nowMs = Date.now()) => nowMs + ((target - daaNow) / DAA_PER_SEC) * 1000;

/** A term's dates as times, where "now" falls on it (0–100), and how long until each. */
export function termView(m: { maturityDaa: number; depositUntilDaa: number }, daa: number | null, createdAtSec: number) {
  const now = Date.now();
  const at = (x: number) => (x && daa != null ? daaToTime(x, daa, now) : null);
  const winEnd = at(m.depositUntilDaa), mat = at(m.maturityDaa);
  const start = createdAtSec * 1000, end = Math.max(mat ?? 0, winEnd ?? 0, start + 1);
  const pos = (t: number | null) => (t == null ? 0 : Math.max(0, Math.min(100, ((t - start) / (end - start)) * 100)));
  const left = (t: number | null) => { if (t == null) return ""; const h = (t - now) / 3600_000; return h <= 0 ? "" : h < 48 ? ` · in ${Math.max(1, Math.round(h))} h` : ` · in ${Math.round(h / 24)} days`; };
  return { winEnd, mat, posWin: pos(winEnd), posMat: pos(mat), posNow: pos(now), leftWin: left(winEnd), leftMat: left(mat) };
}

/**
 * The newest ledger: the one in git, or a newer one the keeper published
 * (signed by the allocator key, checked in /api/vaults/ledger). Same vault,
 * same mandate, never fewer moves. The chain check on the page still decides
 * whether it is current.
 */
export async function getNav(slug: NavSlug = "nav-tn10"): Promise<{ l: NavLedger | null; m: NavMandateDoc | null }> {
  const { ledger, mandate } = navVault(slug);
  if (!ledger || !mandate || !hasDb()) return { l: ledger, m: mandate };
  try {
    await ensureSchema();
    const r = (await sql().query("select doc from vault_ledgers where vault = $1", [ledger.covenantId])) as { doc: NavLedger }[];
    const d = r[0]?.doc;
    if (d && d.covenantId === ledger.covenantId && d.mandateHash === ledger.mandateHash && Array.isArray(d.moves) && d.moves.length >= ledger.moves.length) return { l: d, m: mandate };
  } catch { /* fall back to git */ }
  return { l: ledger, m: mandate };
}

/** Every NAV-covenant vault with its newest ledger. */
export const getNavAll = () => Promise.all(NAV_VAULTS.map(async (v) => ({ ...v, ...(await getNav(v.slug)) })));

async function get<T>(path: string): Promise<T | null> {
  try {
    const r = await fetch(`${API}${path}`, { next: { revalidate: 30 }, signal: AbortSignal.timeout(8_000), headers: { accept: "application/json" } });
    return r.ok ? ((await r.json()) as T) : null;
  } catch { return null; }
}

/** Ledger figures in KAS. NAV excludes the vault's own seed (minKeep). */
export function navFigures(l: NavLedger, m: NavMandateDoc) {
  const held = l.value / SOMPI;
  const keep = m.minKeepSompi / SOMPI;
  const marks = l.state.marks.map((x) => x / SOMPI);
  const cost = l.state.deployed.map((x) => x / SOMPI);
  const nav = held - keep + marks.reduce((s, x) => s + x, 0);
  const price = l.state.shares > 0 ? (nav * SOMPI) / l.state.shares / SOMPI : FIRST_PRICE / SOMPI; // KAS per share
  const live = l.notes.filter((n) => !n.redeemed);
  const holders = new Set(live.map((n) => n.owner)).size;
  const deposited = l.moves.filter((x) => x.kind === "deposit").reduce((s, x) => s + (x.paid ?? 0), 0) / SOMPI;
  const paidOut = l.moves.filter((x) => x.kind === "redeem").reduce((s, x) => s + (x.payout ?? 0), 0) / SOMPI;
  return { held, keep, marks, cost, nav, price, shares: l.state.shares, holders, liveNotes: live.length, deposited, paidOut, liquid: held - keep };
}

export interface NavLive { ok: boolean; matches: boolean; coin: { amount: number; txid: string } | null; daa: number | null }
export async function readNavLive(l: NavLedger): Promise<NavLive> {
  const [utxos, dag] = await Promise.all([
    get<{ outpoint: { transactionId: string }; utxoEntry: { amount: string } }[]>(`/addresses/${l.address}/utxos`),
    get<{ virtualDaaScore?: string }>(`/info/blockdag`),
  ]);
  const coin = utxos?.[0] ? { amount: Number(utxos[0].utxoEntry.amount), txid: utxos[0].outpoint.transactionId } : null;
  const last = l.moves.length ? l.moves[l.moves.length - 1].txid : l.genesisTx;
  return { ok: utxos != null, matches: !!coin && utxos!.length === 1 && coin.amount === l.value && coin.txid === last, coin, daa: dag?.virtualDaaScore ? Number(dag.virtualDaaScore) : null };
}

/** One person's position: their two account addresses, what sits in them now, their notes. */
export async function positionOf(l: NavLedger, m: NavMandateDoc, address: string) {
  return positionAt(l, navFigures(l, m).price, address);
}
/** The same for any vault that uses these accounts and notes (the credit vault), at a given share price. */
export async function positionAt(l: { covenantId: string; accountTemplate: AccountTemplate; notes: NavNote[] }, price: number, address: string) {
  const { owner } = ownerOf(address);
  const cov = fromHex(l.covenantId);
  const deposit = accountAddress(l.accountTemplate, owner, cov, 0);
  const redeem = accountAddress(l.accountTemplate, owner, cov, 1);
  const [db, rb] = await Promise.all([get<{ balance: number }>(`/addresses/${deposit}/balance`), get<{ balance: number }>(`/addresses/${redeem}/balance`)]);
  const f = { price };
  const key = toHex(owner);
  const notes = l.notes.filter((n) => { try { return toHex(ownerOf(n.owner).owner) === key; } catch { return n.owner === address; } });
  const liveShares = notes.filter((n) => !n.redeemed).reduce((s, n) => s + n.shares, 0);
  return {
    address, deposit, redeem,
    pendingDeposit: db ? db.balance / SOMPI : null,
    pendingRedeem: rb ? rb.balance / SOMPI : null,
    shares: liveShares, value: liveShares * f.price,
    notes: notes.map((n) => ({ shares: n.shares, at: n.at, txid: n.txid, price: n.price / SOMPI, redeemed: n.redeemed ? { at: n.redeemed.at, payout: n.redeemed.payout / SOMPI, txid: n.redeemed.txid } : null })),
  };
}
export type Position = Awaited<ReturnType<typeof positionOf>>;
