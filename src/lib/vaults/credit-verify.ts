import "server-only";
import { unstable_cache } from "next/cache";
import { checkCreditAddress, CREDIT_VERSIONS, type CodeCheck } from "./verify-credit";
import type { CreditLedger, CreditMandateDoc } from "./credit";

/**
 * A credit vault, checked two ways, by anyone, with no key:
 *
 *   code   the vault's address is the hash of the credit covenant compiled with this
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
export type CreditCheck = { version: string; code: CodeCheck; chain: ChainCheck };

/** Which covenant a ledger says it runs (the first TN10 vault predates the field: v0). */
export const versionOf = (l: Pick<CreditLedger, "covenant">) => l.covenant ?? "dawns-credit/0";

/** The code check alone: pure, no network. */
export function codeCheck(l: CreditLedger, m: CreditMandateDoc): CodeCheck {
  const v = versionOf(l);
  if (!CREDIT_VERSIONS.includes(v)) return { ok: false, why: `unknown covenant version ${v}` };
  return checkCreditAddress(v, m, l.state, l.address);
}

async function check(l: CreditLedger, m: CreditMandateDoc): Promise<CreditCheck> {
  const code = codeCheck(l, m);
  const at = Date.now();
  const r = await coinsAt(l.address).catch(() => null);
  const chain: ChainCheck = !r ? { state: "unread", at }
    : (() => { const c = r.coins.find((x) => x.covenantId === l.covenantId.toLowerCase()); return c ? { state: "live" as const, amount: c.amount, node: r.node, at } : { state: "moved" as const, node: r.node, at }; })();
  return { version: versionOf(l), code, chain };
}

/** Both checks, cached a minute per ledger version (a new move is a new key). */
export function checkCredit(l: CreditLedger, m: CreditMandateDoc): Promise<CreditCheck> {
  return unstable_cache(() => check(l, m), ["dawns-credit-check-v1", l.covenantId, String(l.moves.length), l.address], { revalidate: 60 })();
}
