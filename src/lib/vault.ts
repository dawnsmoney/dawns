import "server-only";
import mandateDoc from "../../vault/deploy/mandate.json";
import ledgerDoc from "../../vault/deploy/vault.json";

/**
 * The Dawns mandate vault on testnet-10. Two sources, kept apart:
 * - the ledger (vault/deploy/vault.json + mandate.json): what the operator tool broadcast,
 *   committed to the repository after each run;
 * - the chain (the public TN10 REST API): what is actually there now.
 * The page shows both and says when they disagree.
 */
const API = "https://api-tn10.kaspa.org";
export const SOMPI = 1e8;

export interface Dest { label: string; address: string; capBps: number }
export interface Mandate {
  name: string; objective: string; network: string; standard: string;
  destinations: Dest[]; reserveFloorBps: number; maxPerMoveSompi: number; epochLimitSompi: number; epochLengthDaa: number; maxFeeSompi: number; notBeforeDaa: number;
  roles: { allocator: string; depositor: string; guardian: string };
}
export interface VState { deployed: number[]; epochIndex: number; epochSpent: number; principal: number }
export interface VMove { kind: string; txid: string; slot?: number | null; amount?: number; claimedDaa?: number | null; at: number; valueAfter: number; stateAfter?: VState | null; recovered?: boolean }
export interface VRefusal { kind: string; txid: string; slot?: number | null; amount?: number; at: number; error: string }
export interface Ledger {
  address: string; covenantId: string; createdAt: number; genesisTx: string; mandateHash: string; network: string;
  moves: VMove[]; refusals: VRefusal[]; state: VState; value: number; pending: unknown; closed?: { kind: string; txid: string; at: number };
}

export const mandate = mandateDoc as unknown as Mandate;
export const ledger = ledgerDoc as unknown as Ledger;

async function get<T>(path: string): Promise<T | null> {
  try {
    const r = await fetch(`${API}${path}`, { next: { revalidate: 60 }, signal: AbortSignal.timeout(8_000), headers: { accept: "application/json" } });
    return r.ok ? ((await r.json()) as T) : null;
  } catch { return null; }
}

export interface Live {
  ok: boolean;                              // the API answered
  vaultCoin: { amount: number; txid: string } | null; // the covenant coin at the ledger's current address
  matches: boolean;                         // that coin is exactly what the ledger says, created by its last move
  daa: number | null;
  strategies: (number | null)[];            // KAS in each destination wallet now
  asOf: number;
}

/** What the chain says now, read from the public TN10 API. */
export async function readLive(): Promise<Live> {
  const [utxos, dag, ...bals] = await Promise.all([
    get<{ outpoint: { transactionId: string }; utxoEntry: { amount: string } }[]>(`/addresses/${ledger.address}/utxos`),
    get<{ virtualDaaScore?: string }>(`/info/blockdag`),
    ...mandate.destinations.map((d) => get<{ balance: number }>(`/addresses/${d.address}/balance`)),
  ]);
  const coin = utxos?.[0] ? { amount: Number(utxos[0].utxoEntry.amount), txid: utxos[0].outpoint.transactionId } : null;
  const lastTx = ledger.moves.length ? ledger.moves[ledger.moves.length - 1].txid : ledger.genesisTx;
  return {
    ok: utxos != null,
    vaultCoin: coin,
    matches: !!coin && utxos!.length === 1 && coin.amount === ledger.value && coin.txid === lastTx,
    daa: dag?.virtualDaaScore ? Number(dag.virtualDaaScore) : null,
    strategies: bals.map((b) => (b ? b.balance / SOMPI : null)),
    asOf: Date.now(),
  };
}

/** Vault figures from the ledger, in KAS. Deployed capital is counted at cost. */
export function figures(l: Ledger = ledger, m: Mandate = mandate, daa: number | null = null) {
  const inVault = l.value / SOMPI;
  const deployed = l.state.deployed.slice(0, m.destinations.length).map((x) => x / SOMPI);
  const value = inVault + deployed.reduce((s, x) => s + x, 0);
  const epochNow = daa != null ? Math.floor((daa - m.notBeforeDaa) / m.epochLengthDaa) : l.state.epochIndex;
  const epochUsed = epochNow === l.state.epochIndex ? l.state.epochSpent / SOMPI : 0;
  return { inVault, deployed, value, principal: l.state.principal / SOMPI, epochNow, epochUsed, epochLimit: m.epochLimitSompi / SOMPI, liquidShare: value ? inVault / value : 1 };
}

export const explorerAddr = (a: string) => `https://tn10.kaspa.stream/addresses/${a}`;
export const apiAddr = (a: string) => `${API}/addresses/${a}/utxos`;
