import "server-only";
import { parseAbi, type Address } from "viem";
import { clients, pool as runPool, type ChainKey } from "./chain/clients";
import { ZEALOUS_FARM } from "./chain/farms";
import type { Snapshot } from "./types";
import type { WalletRead } from "./portfolio";
import { currentUser, accountOf } from "./auth/session";
import { hasDb } from "./db";

const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)", "function totalSupply() view returns (uint256)", "function decimals() view returns (uint8)"]);
const farmAbi = parseAbi(["function userInfo(uint256, address) view returns (uint256 amount, uint256 rewardDebt, uint256 lastDeposit)"]);

type Job = { chain: ChainKey; key: string; address: Address; fn: "balanceOf" | "totalSupply" | "decimals"; dec?: number; into: "bal" | "lpSupply" | "dec" };

/**
 * Read one wallet's balances of every token, receipt, LP share and staking share the
 * snapshot knows, on Igra and Kasplex, plus its LP staked in the ZealousSwap farm.
 * Read-only calls to public RPCs; nothing is stored.
 */
export async function readWallet(s: Snapshot, address: string): Promise<WalletRead> {
  const who = address.toLowerCase() as Address;
  const jobs: Job[] = [];
  const seen = new Set<string>();
  const add = (chain: ChainKey, a: string, dec: number | undefined, extra?: "supply") => {
    const k = `${chain}:${a.toLowerCase()}`;
    if (!/^0x[0-9a-f]{40}$/i.test(a)) return;
    if (!seen.has(k)) { seen.add(k); jobs.push({ chain, key: k, address: a as Address, fn: "balanceOf", dec, into: "bal" }); if (dec == null) jobs.push({ chain, key: k, address: a as Address, fn: "decimals", into: "dec" }); }
    if (extra === "supply" && !seen.has(k + ":s")) { seen.add(k + ":s"); jobs.push({ chain, key: k, address: a as Address, fn: "totalSupply", dec, into: "lpSupply" }); }
  };
  for (const p of s.protocols) {
    for (const pool of p.dex?.pools ?? []) {
      pool.tk.forEach((t) => add(pool.chain, t.a, t.d));
      if (pool.kind === "v2") add(pool.chain, pool.pair, 18, "supply");
    }
    for (const m of p.lending?.markets ?? []) { add("igra", m.asset, m.decimals); add("igra", m.aToken, m.decimals); add("igra", m.debtToken, m.decimals); }
    for (const v of p.dex?.infinity ?? []) add(v.chain, v.vault, undefined);
  }
  const farmPools = s.protocols.flatMap((p) => p.dex?.farms ?? []).flatMap((f) => f.pools).filter((q) => q.pid != null);

  let failed = 0;
  const raw = new Map<string, bigint>();
  const dec = new Map<string, number>();
  const [results, nIgra, nKas, farm] = await Promise.all([
    runPool(jobs, 12, async (j) => {
      const v = await clients[j.chain].readContract({ address: j.address, abi: erc20, functionName: j.fn, args: j.fn === "balanceOf" ? [who] : [] } as never) as bigint | number;
      return { j, v };
    }),
    clients.igra.getBalance({ address: who }).catch(() => { failed++; return null; }),
    clients.kasplex.getBalance({ address: who }).catch(() => { failed++; return null; }),
    runPool(farmPools, 4, async (q) => {
      const r = await clients[ZEALOUS_FARM.chain].readContract({ address: ZEALOUS_FARM.address, abi: farmAbi, functionName: "userInfo", args: [BigInt(q.pid!), who] });
      return { pair: q.pair, amount: r[0] };
    }),
  ]);
  for (const r of results) {
    if (!r) { failed++; continue; }
    if (r.j.into === "dec") dec.set(r.j.key, Number(r.v));
    else raw.set(`${r.j.into}|${r.j.key}`, BigInt(r.v));
  }
  const bal: Record<string, number> = {}, lpSupply: Record<string, number> = {}, farmOut: Record<string, number> = {};
  for (const j of jobs) {
    if (j.into === "dec") continue;
    const v = raw.get(`${j.into}|${j.key}`);
    if (v == null || v === BigInt(0)) continue;
    const d = j.dec ?? dec.get(j.key) ?? 18;
    (j.into === "bal" ? bal : lpSupply)[j.key] = Number(v) / 10 ** d;
  }
  for (const f of farm) { if (!f) { failed++; continue; } if (f.amount > BigInt(0)) farmOut[f.pair] = Number(f.amount) / 1e18; }
  return {
    address: who, bal, lpSupply, farm: farmOut, failed, at: Date.now(),
    native: { igra: nIgra != null ? Number(nIgra) / 1e18 : null, kasplex: nKas != null ? Number(nKas) / 1e18 : null },
  };
}

/** The signed-in user's first EVM wallet, to offer as a one-tap portfolio. */
export async function myWallet(): Promise<string | null> {
  if (!hasDb()) return null;
  try { const u = await currentUser(); if (!u) return null; return (await accountOf(u.id)).wallets.find((w) => w.kind === "evm")?.address ?? null; } catch { return null; }
}
