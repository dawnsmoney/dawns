import "server-only";

/**
 * ZKas block producers. Every ZKas coinbase payload carries the miner's payout address
 * (a 43-byte Orchard raw address): blueScore u64 | subsidy u64 | 32 bytes | spk version u16 |
 * spk length u8 (43) | address | node version text. dawns samples recent blocks each run and
 * counts blocks per payout address. One operator can use several addresses, so concentration
 * read this way is a lower bound.
 */
const API = "https://explorer.zkas.info/api";

async function get<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(12_000), headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return (await r.json()) as T;
}

export function payoutOf(payloadHex: string): string | null {
  const h = payloadHex.toLowerCase();
  const at = 96; // 8 + 8 + 32 bytes
  if (h.slice(at, at + 6) !== "00002b") return null;
  const addr = h.slice(at + 6, at + 6 + 86);
  return /^[0-9a-f]{86}$/.test(addr) ? addr : null;
}

export async function sampleProducers(n = 40): Promise<{ producer: string; blocks: number }[]> {
  const recent = await get<{ block_hash: string }[]>(`${API}/blocks/recent`);
  const hashes = recent.map((b) => b.block_hash).filter((x) => /^[0-9a-f]{64}$/.test(x));
  // a random sample, so a run of blocks from one miner does not dominate a tick
  for (let i = hashes.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [hashes[i], hashes[j]] = [hashes[j], hashes[i]]; }
  const pick = hashes.slice(0, n);
  const counts = new Map<string, number>();
  for (let i = 0; i < pick.length; i += 8) {
    await Promise.all(pick.slice(i, i + 8).map(async (h) => {
      try {
        const b = await get<{ transactions?: { payload?: string; subnetworkId?: string }[] }>(`${API}/blocks/${h}?includeTransactions=true`);
        const p = payoutOf(b.transactions?.[0]?.payload ?? "") ?? "unknown";
        counts.set(p, (counts.get(p) ?? 0) + 1);
      } catch { /* skip this block */ }
    }));
  }
  return [...counts].map(([producer, blocks]) => ({ producer, blocks }));
}
