import "server-only";
import navDoc from "../../../vault/deploy/nav.json";
import navMandateDoc from "../../../vault/deploy/nav-mandate.json";
import { accountAddress, ownerOf, fromHex, type AccountTemplate } from "./account";
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

const raw = navDoc as unknown as Partial<NavLedger>;
export const navLive = raw.status !== "planned" && !!raw.covenantId;
export const navLedger = (navLive ? raw : null) as NavLedger | null;
export const navMandate = ((navMandateDoc as unknown as { standard?: string }).standard ? navMandateDoc : null) as NavMandateDoc | null;

/**
 * The newest ledger: the one in git, or a newer one the keeper published
 * (signed by the allocator key, checked in /api/vaults/ledger). Same vault,
 * same mandate, never fewer moves. The chain check on the page still decides
 * whether it is current.
 */
export async function getNav(): Promise<{ l: NavLedger | null; m: NavMandateDoc | null }> {
  if (!navLedger || !navMandate || !hasDb()) return { l: navLedger, m: navMandate };
  try {
    await ensureSchema();
    const r = (await sql().query("select doc from vault_ledgers where vault = $1", [navLedger.covenantId])) as { doc: NavLedger }[];
    const d = r[0]?.doc;
    if (d && d.covenantId === navLedger.covenantId && d.mandateHash === navLedger.mandateHash && Array.isArray(d.moves) && d.moves.length >= navLedger.moves.length) return { l: d, m: navMandate };
  } catch { /* fall back to git */ }
  return { l: navLedger, m: navMandate };
}

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
  const { owner } = ownerOf(address);
  const cov = fromHex(l.covenantId);
  const deposit = accountAddress(l.accountTemplate, owner, cov, 0);
  const redeem = accountAddress(l.accountTemplate, owner, cov, 1);
  const [db, rb] = await Promise.all([get<{ balance: number }>(`/addresses/${deposit}/balance`), get<{ balance: number }>(`/addresses/${redeem}/balance`)]);
  const f = navFigures(l, m);
  const notes = l.notes.filter((n) => n.owner === address);
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
