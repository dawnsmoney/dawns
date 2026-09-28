import "server-only";

/**
 * What protocol owners do to contracts that hold users' money or pay their rewards:
 * every transaction to a watched contract from its owner, or calling an admin function,
 * read from the Igra explorer. Selectors are matched from the contracts' bytecode (they
 * are not verified); setEmissionsPaused was confirmed by reading emissionsPaused()
 * before and after the call.
 */
const EXPLORER = "https://explorer.igralabs.com";

type Decode = (arg: bigint | null, w: bigint[]) => string;
const tok = (x: bigint | null, sym: string, dec = 18) => (x == null ? "" : `${(Number(x) / 10 ** dec).toLocaleString("en-US", { maximumFractionDigits: 4 })} ${sym}`);
const ADMIN: Record<string, { name: string; say: Decode }> = {
  // farm (MasterChef-style)
  "0xbb872b4a": { name: "setRewardPerBlock", say: (a) => (a === BigInt(0) ? "set farm rewards to 0" : `set farm rewards to ${tok(a, "ZEAL")} a block`) },
  "0x8cb8c8f0": { name: "set", say: (_a, w) => (w.length >= 2 ? `set farm pool #${w[0]}'s reward weight to ${w[1]} points` : "changed a farm pool's reward share") },
  "0x96805e54": { name: "add", say: () => "added a pool to the farm" },
  "0x3b5b1eff": { name: "removePool", say: () => "removed a pool from the farm" },
  "0x26b321d1": { name: "setLockingPeriod", say: (a) => `set the farm's locking period to ${a == null ? "?" : `${Number(a) / 3600} h`}` },
  "0x6605bfda": { name: "setTreasuryAddress", say: () => "changed the farm's treasury address" },
  "0x9be65a60": { name: "recoverToken", say: () => "recovered tokens from the contract" },
  // staking vaults (Infinity Pools)
  "0xa1bdb15e": { name: "setEmissionRate", say: (a) => (a === BigInt(0) ? "set staking emissions to 0" : `set staking emissions to ${tok(a, "ZEAL")} a block`) },
  "0x79b549c6": { name: "setEmissionsPaused", say: (a) => (a ? "paused staking emissions" : "resumed staking emissions") },
  "0xbeceed39": { name: "addRewards", say: (a) => `added ${tok(a, "tokens")} of rewards` },
  "0xeb4af045": { name: "setMinStakeAmount", say: () => "changed the minimum stake" },
  // any Ownable contract
  "0xf2fde38b": { name: "transferOwnership", say: () => "transferred ownership" },
  "0x715018a6": { name: "renounceOwnership", say: () => "renounced ownership" },
};
const USER = new Set(["0xe2bbb158", "0x441a3e70", "0x379607f5", "0x5312ea8e", "0xa694fc3a", "0x2e17de78", "0x51eb05a6", "0x630b5ba1"]);

export interface Watched { protocol: string; label: string; address: string; owner?: string | null }
import type { OwnerAction } from "../types";
export type { OwnerAction };

/** The newest `pages` × 50 transactions to each contract are scanned: enough for recent actions, not a full archive. */
export async function ownerActions(list: Watched[], pages = 20): Promise<OwnerAction[]> {
  const out: OwnerAction[] = [];
  await Promise.all(list.map(async (w) => { try {
    const base = `${EXPLORER}/api/v2/addresses/${w.address}/transactions?filter=to`;
    let url: string | null = base;
    for (let i = 0; i < pages && url; i++) {
      const r = await fetch(url, { signal: AbortSignal.timeout(8_000), next: { revalidate: 600 } });
      if (!r.ok) throw new Error(`explorer ${r.status}`);
      const j = (await r.json()) as { items?: { hash: string; timestamp: string; block_number: number; raw_input?: string; status?: string; from?: { hash: string } }[]; next_page_params?: Record<string, string> | null };
      for (const t of j.items ?? []) {
        if (t.status && t.status !== "ok") continue;
        const input = t.raw_input ?? "0x";
        const sel = input.slice(0, 10), from = (t.from?.hash ?? "").toLowerCase();
        const byOwner = !!w.owner && from === w.owner.toLowerCase();
        if (USER.has(sel) && !byOwner) continue;
        const a = ADMIN[sel];
        if (!a && !byOwner) continue;
        if (input.length <= 10 && !a) continue; // plain transfers
        const words = (input.slice(10).match(/.{64}/g) ?? []).slice(0, 4).map((x) => BigInt("0x" + x));
        const arg = words[0] ?? null;
        const created = sel === "0x60806040" || input.length > 2_000;
        out.push({ protocol: w.protocol, contract: w.address.toLowerCase(), label: w.label, t: Date.parse(t.timestamp), block: t.block_number, tx: t.hash, from,
          method: created ? "deploy" : a?.name ?? sel, what: created ? "deployed the contract" : a ? a.say(arg, words) : `called an unidentified function (${sel})` });
      }
      url = j.next_page_params ? `${base}&${new URLSearchParams(j.next_page_params).toString()}` : null;
    }
  } catch { /* one contract's history failing does not hide the others */ } }));
  return out.sort((a, b) => b.t - a.t);
}

export const txLink = (tx: string) => `${EXPLORER}/tx/${tx}`;
