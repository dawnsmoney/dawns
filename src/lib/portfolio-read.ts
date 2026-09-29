import "server-only";
import { unstable_cache } from "next/cache";
import { getSnapshot } from "./snapshot";
import { parseAbi, type Address } from "viem";
import { clients, type ChainKey } from "./chain/clients";
import { ZEALOUS_FARM } from "./chain/farms";
import type { Snapshot } from "./types";
import { infinityShare } from "./underneath";
import type { WalletRead, L1Read, Position } from "./portfolio";
import { getNav, navFigures, SOMPI } from "./vaults/nav";
import { getCredit, creditFigures } from "./vaults/credit";
import { decodeKaspaAddress } from "./auth/kaspa";
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
    for (const v of p.dex?.infinity ?? []) add(v.chain, infinityShare(s, v), undefined);
  }
  const farmPools = s.protocols.flatMap((p) => p.dex?.farms ?? []).flatMap((f) => f.pools).filter((q) => q.pid != null);

  let failed = 0;
  const raw = new Map<string, bigint>();
  const dec = new Map<string, number>();
  const heldP = (async () => {
    try {
      const r = await fetch(`https://explorer.igralabs.com/api/v2/addresses/${who}/token-balances`, { next: { revalidate: 60 }, signal: AbortSignal.timeout(10_000), headers: { accept: "application/json" } });
      if (!r.ok) return null;
      const j = (await r.json()) as { value: string; token: { address_hash?: string; address?: string; symbol?: string; decimals?: string; type?: string } }[];
      return j.filter((t) => t.token?.type === "ERC-20").map((t) => ({ address: String(t.token.address_hash ?? t.token.address ?? "").toLowerCase(), symbol: t.token.symbol ?? "?", amount: Number(t.value) / 10 ** (Number(t.token.decimals) || 18) }));
    } catch { return null; }
  })();
  // Igra: every read in one Multicall3 call. Kasplex has no Multicall3: parallel reads,
  // each capped at 5 s, so one slow node cannot hold the page.
  const cap = <T,>(p: Promise<T>, ms = 5000) => Promise.race([p, new Promise<never>((_, no) => setTimeout(() => no(new Error("timeout")), ms))]);
  const ig = jobs.filter((j) => j.chain === "igra");
  const kx = jobs.filter((j) => j.chain !== "igra");
  const igraCalls = [
    ...ig.map((j) => ({ address: j.address, abi: erc20, functionName: j.fn, args: j.fn === "balanceOf" ? [who] : [] })),
    ...farmPools.map((q) => ({ address: ZEALOUS_FARM.address, abi: farmAbi, functionName: "userInfo", args: [BigInt(q.pid!), who] })),
  ];
  const [igraOut, kxOut, nIgra, nKas, held] = await Promise.all([
    cap(clients.igra.multicall({ contracts: igraCalls as never, allowFailure: true, batchSize: 64_000 }), 8000).catch(() => null) as Promise<{ status: string; result?: unknown }[] | null>,
    Promise.all(kx.map((j) => cap(clients[j.chain].readContract({ address: j.address, abi: erc20, functionName: j.fn, args: j.fn === "balanceOf" ? [who] : [] } as never) as Promise<bigint | number>).then((v) => ({ j, v })).catch(() => null))),
    cap(clients.igra.getBalance({ address: who })).catch(() => { failed++; return null; }),
    cap(clients.kasplex.getBalance({ address: who })).catch(() => { failed++; return null; }),
    heldP,
  ]);
  if (!igraOut) failed++;
  const results = [
    ...ig.map((j, i) => { const o = igraOut?.[i]; return o && o.status === "success" ? { j, v: o.result as bigint | number } : null; }),
    ...kxOut,
  ];
  const farm = farmPools.map((q, i) => { const o = igraOut?.[ig.length + i]; return o && o.status === "success" ? { pair: q.pair, amount: (o.result as readonly bigint[])[0] } : null; });
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
    address: who, bal, lpSupply, farm: farmOut, failed, at: Date.now(), held,
    native: { igra: nIgra != null ? Number(nIgra) / 1e18 : null, kasplex: nKas != null ? Number(nKas) / 1e18 : null },
  };
}

/** The signed-in user's wallets (EVM and Kaspa), comma-separated, to offer as a one-tap portfolio. */
export async function myWallet(): Promise<string | null> {
  if (!hasDb()) return null;
  try { const u = await currentUser(); if (!u) return null; const w = (await accountOf(u.id)).wallets; return w.length ? w.map((x) => x.address).join(",") : null; } catch { return null; }
}

/**
 * A Kaspa L1 address: KAS from the Kaspa REST API, KRC-20 from the Kasplex indexer.
 * Either can be unavailable; the page says so rather than showing zero.
 */
export async function readL1(address: string): Promise<L1Read> {
  const a = address.toLowerCase();
  if (a.startsWith("kaspatest:")) return { address: a, kas: 0, krc20: [], at: Date.now() };   // testnet: only vault shares count
  const get = async <T,>(url: string) => { try { const r = await fetch(url, { next: { revalidate: 60 }, signal: AbortSignal.timeout(10_000), headers: { accept: "application/json" } }); return r.ok ? ((await r.json()) as T) : null; } catch { return null; } };
  const bal = get<{ balance?: number | string }>(`https://api.kaspa.org/addresses/${a}/balance`);
  const krc = (async () => {
    const out: { tick: string; amount: number }[] = [];
    let next = "";
    for (let i = 0; i < 5; i++) {
      const r = await get<{ result?: { tick: string; balance: string; locked?: string; dec: string }[]; next?: string | null }>(`https://api.kasplex.org/v1/krc20/address/${a}/tokenlist${next ? `?next=${encodeURIComponent(next)}` : ""}`);
      if (!r || !Array.isArray(r.result)) return i === 0 ? null : out;
      for (const t of r.result) { const d = Number(t.dec) || 8; const amt = (Number(t.balance) + Number(t.locked ?? 0)) / 10 ** d; if (amt > 0) out.push({ tick: t.tick.toUpperCase(), amount: amt }); }
      if (!r.next) break;
      next = r.next;
    }
    return out;
  })();
  const [b, k] = await Promise.all([bal, krc]);
  return { address: a, kas: b?.balance != null ? Number(b.balance) / 1e8 : null, krc20: k, at: Date.now() };
}

const keyOf = (a: string) => { try { const d = decodeKaspaAddress(a.toLowerCase()); return `${d.version}:${Buffer.from(d.payload).toString("hex")}`; } catch { return null; } };

/**
 * Shares in dawns' NAV vault (testnet-10) held by any of these Kaspa keys. A kaspa: and a
 * kaspatest: address with the same key are the same owner, so a mainnet address finds its
 * testnet shares. Value is in test KAS at the vault's NAV per share; no dollar value.
 */
export async function vaultPositions(addresses: string[]): Promise<Position[]> {
  const keys = new Set(addresses.map(keyOf).filter(Boolean));
  if (!keys.size) return [];
  const [nav, credit] = await Promise.all([navPosition(keys), creditPosition(keys)]);
  return [...nav, ...credit];
}

async function creditPosition(keys: Set<string | null>): Promise<Position[]> {
  const { l, m } = await getCredit();
  if (!l || !m) return [];
  const f = creditFigures(l, m, null);
  const mine = l.notes.filter((n) => !n.redeemed && keys.has(keyOf(n.owner)));
  const shares = mine.reduce((a, n) => a + n.shares, 0);
  if (!shares) return [];
  const kas = shares * f.price;
  const total = f.liquid + f.lent || 1;
  const under = [{ sym: "KAS", amount: kas * (f.liquid / total), usd: null }, ...f.loans.map((x) => ({ sym: `Loan · ${x.label}`, amount: kas * (x.counts / total), usd: null }))].filter((u) => u.amount > 0);
  return [{
    key: `vault:credit-tn10`, kind: "vault", name: m.name, sub: `${shares.toLocaleString("en-US")} shares in ${mine.length} note${mine.length > 1 ? "s" : ""} · testnet-10`, chain: "Kaspa TN10",
    usd: null, valueText: `${kas.toLocaleString("en-US", { maximumFractionDigits: 2 })} test KAS`, under,
    exitNow: null, exitNote: `redeem at NAV (${f.price.toFixed(6)} KAS a share); loaned KAS returns as borrowers repay`, href: "/vaults/credit-tn10",
    actions: [{ label: "Deposit", href: "/vaults/credit-tn10?do=deposit#position" }, { label: "Withdraw", href: "/vaults/credit-tn10?do=withdraw#position" }],
  }];
}

async function navPosition(keys: Set<string | null>): Promise<Position[]> {
  const { l, m } = await getNav();
  if (!l || !m) return [];
  const f = navFigures(l, m);
  const mine = l.notes.filter((n) => !n.redeemed && keys.has(keyOf(n.owner)));
  const shares = mine.reduce((a, n) => a + n.shares, 0);
  if (!shares) return [];
  const kas = shares * f.price;
  const paid = mine.reduce((a, n) => a + n.value, 0) / SOMPI;
  const total = f.liquid + f.marks.reduce((a, x) => a + x, 0) || 1;
  const under = [{ sym: "KAS", amount: kas * (f.liquid / total), usd: null }, ...m.destinations.map((d, i) => ({ sym: d.label.replace(" (test wallet)", ""), amount: kas * ((f.marks[i] ?? 0) / total), usd: null }))].filter((u) => u.amount > 0);
  return [{
    key: `vault:nav-tn10`, kind: "vault", name: `${m.name}`, sub: `${shares.toLocaleString("en-US")} shares in ${mine.length} note${mine.length > 1 ? "s" : ""} · testnet-10`, chain: "Kaspa TN10",
    usd: null, valueText: `${kas.toLocaleString("en-US", { maximumFractionDigits: 2 })} test KAS`, under,
    exitNow: null, exitNote: `redeem at NAV (${f.price.toFixed(6)} KAS a share)${paid ? ` · paid ${paid.toLocaleString("en-US", { maximumFractionDigits: 2 })} KAS` : ""}`, href: "/vaults/nav-tn10",
    actions: [{ label: "Deposit", href: "/vaults/nav-tn10?do=deposit#position" }, { label: "Withdraw", href: "/vaults/nav-tn10?do=withdraw#position" }],
  }];
}

/** The same reads, cached a minute per address: reloading or switching tabs is instant. */
export const readWalletCached = unstable_cache(async (address: string) => readWallet(await getSnapshot(), address), ["pf-wallet-v1"], { revalidate: 60 });
export const readL1Cached = unstable_cache(async (address: string) => readL1(address), ["pf-l1-v1"], { revalidate: 60 });
