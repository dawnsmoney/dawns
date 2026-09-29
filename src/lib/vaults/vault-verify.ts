import "server-only";
import { unstable_cache } from "next/cache";
import { checkCreditAddress, CREDIT_VERSIONS, type CreditStateDoc } from "./verify-credit";
import { checkNavAddress, NAV_VERSIONS, type NavStateDoc } from "./verify-nav";
import type { CodeCheck } from "./verify-vault";
import type { CreditLedger, CreditMandateDoc } from "./credit";
import type { NavLedger, NavMandateDoc } from "./nav";

/**
 * A vault (credit or NAV), checked two ways, by anyone, with no key:
 *
 *   code   the vault's address is the hash of its covenant compiled with this
 *          mandate and this state: rebuilt here from the published mandate
 *   chain  a testnet-10 node shows a coin at that address carrying the ledger's
 *          covenant id: the vault is live at the state the ledger says
 *
 * A vault that passes the code check is listed whoever launched it; the chain check
 * says whether the published ledger is current.
 */

/** Public testnet-10 nodes that answer wRPC in JSON. */
const NODES = [
  "wss://neutrino-10.kaspa.stream/kaspa/testnet-10/wrpc/json",
  "wss://vector-10.kaspa.green/kaspa/testnet-10/wrpc/json",
];

export type Coin = { covenantId: string | null; amount: number; txid: string; index: number };

function ask(url: string, method: string, params: unknown, ms = 8_000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const WS = (globalThis as { WebSocket?: typeof WebSocket }).WebSocket;
    if (!WS) return reject(new Error("no WebSocket in this runtime"));
    const ws = new WS(url);
    const t = setTimeout(() => { try { ws.close(); } catch { /* closed */ } reject(new Error("timeout")); }, ms);
    ws.onopen = () => ws.send(JSON.stringify({ id: 1, method, params }));
    ws.onmessage = (m) => {
      clearTimeout(t);
      try { ws.close(); } catch { /* closed */ }
      try {
        const j = JSON.parse(String(m.data)) as { error?: unknown; params?: unknown; result?: unknown };
        if (j.error) reject(new Error(typeof j.error === "string" ? j.error : JSON.stringify(j.error))); else resolve(j.params ?? j.result);
      } catch (e) { reject(e); }
    };
    ws.onerror = () => { clearTimeout(t); reject(new Error("node unreachable")); };
  });
}

/** The coins at an address, with the covenant id each carries, from the first node that answers. */
export async function coinsAt(address: string): Promise<{ coins: Coin[]; node: string } | null> {
  for (const n of NODES) {
    try {
      const r = (await ask(n, "getUtxosByAddresses", { addresses: [address] })) as { entries?: { outpoint?: { transactionId?: string; index?: number }; utxoEntry?: { amount?: number | string; covenantId?: string | null } }[] };
      const coins = (r?.entries ?? []).map((e) => ({
        covenantId: e.utxoEntry?.covenantId ? String(e.utxoEntry.covenantId).toLowerCase() : null,
        amount: Number(e.utxoEntry?.amount ?? 0),
        txid: e.outpoint?.transactionId ?? "", index: e.outpoint?.index ?? 0,
      }));
      return { coins, node: new URL(n).host };
    } catch { /* next node */ }
  }
  return null;
}

export type ChainCheck =
  | { state: "live"; amount: number; node: string; at: number }            // a coin with this covenant id sits at the address
  | { state: "moved"; node: string; at: number }                           // none: the vault moved since this ledger (or never lived there)
  | { state: "unread"; at: number };                                       // no node answered
export type VaultCheck = { version: string; code: CodeCheck; chain: ChainCheck };

export type VaultKind = "credit" | "nav";
type Ledger = { covenant?: string; covenantId: string; address: string; state: unknown; moves: unknown[] };

/** Which covenant a ledger says it runs (the first TN10 vaults predate the field: credit v0, NAV v1). */
export const versionOf = (l: { covenant?: string }, kind: VaultKind = "credit") => l.covenant ?? (kind === "credit" ? "dawns-credit/0" : "dawns-nav/1");

/** The code check alone: pure, no network. */
export function codeCheckOf(kind: VaultKind, l: Ledger, m: unknown): CodeCheck {
  const v = versionOf(l, kind);
  if (!(kind === "credit" ? CREDIT_VERSIONS : NAV_VERSIONS).includes(v)) return { ok: false, why: `unknown covenant version ${v}` };
  return kind === "credit" ? checkCreditAddress(v, m, l.state as CreditStateDoc, l.address) : checkNavAddress(v, m, l.state as NavStateDoc, l.address);
}
export const codeCheck = (l: CreditLedger, m: CreditMandateDoc) => codeCheckOf("credit", l as never, m);

async function check(kind: VaultKind, l: Ledger, m: unknown): Promise<VaultCheck> {
  const code = codeCheckOf(kind, l, m);
  const at = Date.now();
  const r = await coinsAt(l.address).catch(() => null);
  const chain: ChainCheck = !r ? { state: "unread", at }
    : (() => { const c = r.coins.find((x) => x.covenantId === l.covenantId.toLowerCase()); return c ? { state: "live" as const, amount: c.amount, node: r.node, at } : { state: "moved" as const, node: r.node, at }; })();
  return { version: versionOf(l, kind), code, chain };
}

/** Both checks, cached a minute per ledger version (a new move is a new key). */
export function checkVault(kind: VaultKind, l: Ledger, m: unknown): Promise<VaultCheck> {
  return unstable_cache(() => check(kind, l, m), ["dawns-vault-check-v1", kind, l.covenantId, String(l.moves.length), l.address], { revalidate: 60 })();
}
export const checkCredit = (l: CreditLedger, m: CreditMandateDoc) => checkVault("credit", l as never, m);
export const checkNav = (l: NavLedger, m: NavMandateDoc) => checkVault("nav", l as never, m);
