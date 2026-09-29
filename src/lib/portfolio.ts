import type { Snapshot } from "./types";
import { infinityShare } from "./underneath";

/**
 * Portfolio: one wallet's positions in Kaspa DeFi, looked through to what they hold.
 * Pure: `buildPortfolio` takes balances read on-chain (portfolio-read.ts) and the snapshot.
 * Every position shows what is underneath it and how much of it could leave today.
 */

export type PosKind = "wallet" | "supply" | "borrow" | "lp" | "farm" | "staking";
export const POS_LABEL: Record<PosKind, string> = { wallet: "In the wallet", supply: "Lending", borrow: "Borrowed", lp: "Liquidity", farm: "Farm", staking: "Staking" };
export const POS_COLOR: Record<PosKind, string> = { wallet: "#9085e9", supply: "#4F8EE0", borrow: "#D55A7C", lp: "#D17A30", farm: "#c98500", staking: "#2FA88F" };

/** Balances in whole units, keyed `chain:address` (lower case). */
export interface WalletRead {
  address: string;
  native: { igra: number | null; kasplex: number | null };
  bal: Record<string, number>;
  lpSupply: Record<string, number>;
  farm: Record<string, number>;          // pair → LP staked in the farm
  failed: number;                        // reads that did not answer
  at: number;
}

export interface Under { sym: string; amount: number; usd: number | null }
export interface Position {
  key: string; kind: PosKind; name: string; sub: string; chain: string;
  usd: number | null;                    // negative for debt
  under: Under[];
  exitNow: number | null; exitNote: string;
  href: string | null; opp?: string;
}
export interface Portfolio {
  addresses: string[]; at: number;
  gross: number; debt: number; net: number;
  byKind: { kind: PosKind; usd: number }[];
  exposure: { sym: string; usd: number; share: number }[];
  exitNow: number; exitShare: number | null;
  positions: Position[];
  unpriced: number;
  dust: number;
  hf: number | null;
  failed: number;
}

const CH: Record<string, string> = { igra: "Igra", kasplex: "Kasplex L2" };
const canon = (sym: string) => (/^(w?i?kas|wikas|ikas|wkas)$/i.test(sym) ? "KAS" : sym.replace(/^w(eth|btc)$/i, "$1").toUpperCase());

/** A Kaspa L1 address: KAS and KRC-20 balances (null: the indexer did not answer). */
export interface L1Read { address: string; kas: number | null; krc20: { tick: string; amount: number }[] | null; at: number }

function positionsOf(s: Snapshot, r: WalletRead): { out: Position[]; hf: number | null } {
  const px = new Map<string, number | null>();
  const sym = new Map<string, string>();
  for (const p of s.protocols) {
    for (const pool of p.dex?.pools ?? []) pool.tk.forEach((t, i) => { const k = `${pool.chain}:${t.a.toLowerCase()}`; if (t.px != null || !px.has(k)) px.set(k, t.px); sym.set(k, pool.symbols[i]); });
    for (const m of p.lending?.markets ?? []) { const k = `igra:${m.asset.toLowerCase()}`; px.set(k, m.price); sym.set(k, m.symbol); }
  }
  const val = (k: string, amt: number) => { const p = px.get(k); return p != null ? p * amt : null; };
  const out: Position[] = [];
  const bal = (k: string) => r.bal[k] ?? 0;

  /* native coins */
  if (r.native.igra) out.push({ key: "igra:native", kind: "wallet", name: "iKAS", sub: "Igra's coin", chain: "Igra", usd: s.kasUsd != null ? r.native.igra * s.kasUsd : null, under: [{ sym: "KAS", amount: r.native.igra, usd: s.kasUsd != null ? r.native.igra * s.kasUsd : null }], exitNow: s.kasUsd != null ? r.native.igra * s.kasUsd : null, exitNote: "in the wallet", href: "/bridge" });
  if (r.native.kasplex) out.push({ key: "kasplex:native", kind: "wallet", name: "KAS", sub: "Kasplex L2 coin", chain: "Kasplex L2", usd: s.kasUsd != null ? r.native.kasplex * s.kasUsd : null, under: [{ sym: "KAS", amount: r.native.kasplex, usd: s.kasUsd != null ? r.native.kasplex * s.kasUsd : null }], exitNow: s.kasUsd != null ? r.native.kasplex * s.kasUsd : null, exitNote: "in the wallet", href: null });

  /* plain tokens (Infinity shares are shown as staking below) */
  const shares = new Set(s.protocols.flatMap((p) => (p.dex?.infinity ?? []).map((v) => `${v.chain}:${infinityShare(s, v)}`)));
  for (const [k, name] of sym) {
    if (shares.has(k)) continue;
    const a = bal(k); if (!a) continue;
    const [chain, addr] = k.split(":");
    const v = val(k, a);
    out.push({ key: k, kind: "wallet", name, sub: "token", chain: CH[chain], usd: v, under: [{ sym: canon(name), amount: a, usd: v }], exitNow: v, exitNote: "in the wallet", href: `/assets/${chain}/erc20/${addr}` });
  }

  let hf: number | null = null;
  for (const p of s.protocols) {
    /* lending: deposit receipts and debt */
    for (const m of p.lending?.markets ?? []) {
      const sup = bal(`igra:${m.aToken.toLowerCase()}`), debt = bal(`igra:${m.debtToken.toLowerCase()}`);
      if (sup) {
        const v = sup * m.price, out1 = Math.min(v, m.cashUsd);
        out.push({ key: `sup:${m.symbol}`, kind: "supply", name: `${m.symbol} supplied`, sub: p.name, chain: "Igra", usd: v, under: [{ sym: canon(m.symbol), amount: sup, usd: v }],
          exitNow: out1, exitNote: out1 < v ? `market cash covers ${Math.round((out1 / v) * 100)}%` : "withdrawable now", href: `/assets/igra/erc20/${m.aToken.toLowerCase()}`, opp: `${p.id}:${m.symbol}` });
      }
      if (debt) {
        const v = debt * m.price;
        out.push({ key: `debt:${m.symbol}`, kind: "borrow", name: `${m.symbol} borrowed`, sub: p.name, chain: "Igra", usd: -v, under: [{ sym: canon(m.symbol), amount: -debt, usd: -v }],
          exitNow: null, exitNote: `repay to free collateral · ${(m.borrowApr * 100).toFixed(1)}% a year`, href: `/protocols/${p.id}` });
      }
    }
    const me = p.lending?.positions?.top.find((x) => x.address.toLowerCase() === r.address);
    if (me?.hf != null) hf = me.hf;

    /* liquidity: LP shares, in the wallet and staked in the farm */
    for (const pool of p.dex?.pools ?? []) {
      if (pool.kind !== "v2") continue;
      const k = `${pool.chain}:${pool.pair.toLowerCase()}`;
      const sup = r.lpSupply[k];
      const lpFor = (lp: number, kind: "lp" | "farm") => {
        if (!lp || !sup) return;
        const sh = lp / sup;
        const under = pool.symbols.map((sy, i) => { const a = pool.reserves[i] * sh; return { sym: canon(sy), amount: a, usd: pool.tk[i].px != null ? a * pool.tk[i].px! : null }; });
        const v = pool.usd * sh;
        out.push({ key: `${kind}:${k}`, kind, name: `${pool.symbols.join(" / ")} ${kind === "farm" ? "staked LP" : "LP"}`, sub: `${p.name} · ${(sh * 100).toFixed(sh < 0.01 ? 3 : 2)}% of the pool`, chain: CH[pool.chain], usd: v, under,
          exitNow: v, exitNote: kind === "farm" ? "unstake, then remove liquidity at the pool's mix" : "remove at the pool's current mix", href: `/assets/${pool.chain}/erc20/${pool.pair.toLowerCase()}`, opp: `${p.id}:${pool.pair.toLowerCase()}` });
      };
      lpFor(bal(k), "lp");
      lpFor(r.farm[pool.pair.toLowerCase()] ?? 0, "farm");
    }

    /* staking: Infinity Pool shares */
    for (const v of p.dex?.infinity ?? []) {
      const k = `${v.chain}:${infinityShare(s, v)}`;
      const sh = bal(k); if (!sh || v.rate == null) continue;
      const amt = sh * v.rate;
      const tk = `${v.chain}:${v.token.toLowerCase()}`;
      const u = val(tk, amt) ?? (v.usd != null && v.amount ? (v.usd / v.amount) * amt : null);
      out.push({ key: `stk:${k}`, kind: "staking", name: `x${v.symbol}`, sub: `${p.name} Infinity Pool · 1 x${v.symbol} = ${v.rate.toFixed(4)} ${v.symbol}`, chain: CH[v.chain], usd: u,
        under: [{ sym: canon(v.symbol), amount: amt, usd: u }], exitNow: u, exitNote: `redeem for ${v.symbol} at the vault's rate`, href: `/assets/${v.chain}/erc20/${infinityShare(s, v)}` });
    }
  }

  return { out, hf };
}

/**
 * One portfolio across any mix of EVM addresses (Igra, Kasplex) and Kaspa L1 addresses.
 * `krcPrice` gives a KRC-20 tick's USD price when it is credible (traded, not stale), else null.
 */
export function buildPortfolio(s: Snapshot, evm: WalletRead[], l1: L1Read[] = [], krcPrice: (tick: string) => number | null = () => null): Portfolio {
  const out: Position[] = [];
  let hf: number | null = null, failed = 0, at = 0;
  for (const r of evm) { const x = positionsOf(s, r); out.push(...x.out); hf = hf ?? x.hf; failed += r.failed; at = Math.max(at, r.at); }
  for (const r of l1) {
    at = Math.max(at, r.at);
    const short = `${r.address.slice(0, 12)}…${r.address.slice(-4)}`;
    if (r.kas == null) failed++;
    else if (r.kas > 0) { const v = s.kasUsd != null ? r.kas * s.kasUsd : null; out.push({ key: `l1:${r.address}`, kind: "wallet", name: "KAS", sub: `Kaspa L1 · ${short}`, chain: "Kaspa", usd: v, under: [{ sym: "KAS", amount: r.kas, usd: v }], exitNow: v, exitNote: "in the wallet", href: "/assets/kaspa/native/KAS" }); }
    if (r.krc20 == null) failed++;
    for (const t of r.krc20 ?? []) {
      if (!t.amount) continue;
      const p = krcPrice(t.tick), v = p != null ? p * t.amount : null;
      out.push({ key: `krc:${r.address}:${t.tick}`, kind: "wallet", name: t.tick, sub: `KRC-20 · ${short}`, chain: "Kaspa", usd: v, under: [{ sym: t.tick.toUpperCase(), amount: t.amount, usd: v }], exitNow: v, exitNote: v != null ? "sell on a KRC-20 market" : "no reliable price", href: `/assets/kaspa/krc20/${t.tick.toUpperCase()}` });
    }
  }
  // dust: priced balances under 50 cents stay out of the list (they are still in the totals)
  const dust = out.filter((x) => x.usd != null && Math.abs(x.usd) < 0.5);
  const priced = out.filter((x) => x.usd != null);
  const gross = priced.filter((x) => x.usd! > 0).reduce((a, x) => a + x.usd!, 0);
  const debt = -priced.filter((x) => x.usd! < 0).reduce((a, x) => a + x.usd!, 0);
  const kinds = (Object.keys(POS_LABEL) as PosKind[]).filter((k) => k !== "borrow");
  const byKind = kinds.map((kind) => ({ kind, usd: priced.filter((x) => x.kind === kind).reduce((a, x) => a + x.usd!, 0) })).filter((x) => x.usd > 0);
  const ex = new Map<string, number>();
  for (const x of out) for (const u of x.under) if (u.usd != null) ex.set(u.sym, (ex.get(u.sym) ?? 0) + u.usd);
  const exPos = [...ex.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const exTotal = exPos.reduce((a, [, v]) => a + v, 0) || 1;
  const exitNow = out.filter((x) => x.kind !== "borrow").reduce((a, x) => a + (x.exitNow ?? 0), 0);
  return {
    addresses: [...evm.map((r) => r.address), ...l1.map((r) => r.address)], at, gross, debt, net: gross - debt, byKind,
    exposure: exPos.map(([sym, usd]) => ({ sym, usd, share: usd / exTotal })),
    exitNow, exitShare: gross ? exitNow / gross : null,
    positions: out.filter((x) => !dust.includes(x)).sort((a, b) => Math.abs(b.usd ?? 0) - Math.abs(a.usd ?? 0)),
    dust: dust.length,
    unpriced: out.filter((x) => x.usd == null).length, hf, failed,
  };
}

/** Split a pasted list into EVM and Kaspa L1 addresses (up to 5 in all). */
export function parseAddresses(input: string | undefined | null): { evm: string[]; l1: string[]; bad: string[] } {
  const parts = [...new Set((input ?? "").split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean))].slice(0, 5);
  const evm: string[] = [], l1: string[] = [], bad: string[] = [];
  for (const p of parts) {
    if (/^0x[0-9a-fA-F]{40}$/.test(p)) evm.push(p.toLowerCase());
    else if (/^kaspa:[a-z0-9]{61,63}$/i.test(p)) l1.push(p.toLowerCase());
    else bad.push(p);
  }
  return { evm, l1, bad };
}
