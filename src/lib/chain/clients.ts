import "server-only";
import { createPublicClient, defineChain, http, type PublicClient } from "viem";

/** Networks dawns reads directly. RPCs are public and read-only. */
export const igra = defineChain({
  id: 38833,
  name: "Igra",
  nativeCurrency: { name: "Igra KAS", symbol: "iKAS", decimals: 18 },
  rpcUrls: { default: { http: [process.env.IGRA_RPC_URL ?? "https://rpc.igralabs.com:8545"] } },
  blockExplorers: { default: { name: "Igra Explorer", url: "https://explorer.igralabs.com" } },
  contracts: { multicall3: { address: "0x8a5d7f49f4984fa5d75325cB3a3F58fa8B198927" } },
});

export const kasplex = defineChain({
  id: 202555,
  name: "Kasplex",
  nativeCurrency: { name: "Bridged KAS", symbol: "KAS", decimals: 18 },
  rpcUrls: { default: { http: [process.env.KASPLEX_RPC_URL ?? "https://evmrpc.kasplex.org"] } },
  blockExplorers: { default: { name: "Kasplex Explorer", url: "https://explorer.kasplex.org" } },
});

export type ChainKey = "igra" | "kasplex";
export const CHAINS = { igra, kasplex } as const;

const transportOpts = { batch: { batchSize: 50, wait: 10 }, timeout: 12_000, retryCount: 2 } as const;

export const clients: Record<ChainKey, PublicClient> = {
  igra: createPublicClient({ chain: igra, transport: http(undefined, transportOpts) }) as PublicClient,
  kasplex: createPublicClient({ chain: kasplex, transport: http(undefined, transportOpts) }) as PublicClient,
};

export const explorerAddress = (chain: ChainKey, a: string) => `${CHAINS[chain].blockExplorers.default.url}/address/${a}`;
export const explorerBlock = (chain: ChainKey, b: bigint | number) => `${CHAINS[chain].blockExplorers.default.url}/block/${b}`;

/** Run async jobs with bounded concurrency; failed jobs resolve to null. */
export async function pool<T, R>(items: T[], n: number, fn: (x: T, i: number) => Promise<R>): Promise<(R | null)[]> {
  const out: (R | null)[] = new Array(items.length).fill(null);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        try { out[i] = await fn(items[i], i); } catch { out[i] = null; }
      }
    }),
  );
  return out;
}
