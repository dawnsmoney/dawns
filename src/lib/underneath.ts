import type { Snapshot, Status } from "./types";
import { usd, pct } from "./format";

/**
 * Underneath: what a receipt token is a claim on. A deposit receipt, an LP share, a staking
 * share, a wrapped coin or a vault share is only worth what sits behind it, so dawns looks
 * through it to the assets, where they are, and what can stop you getting them back.
 * Pure: everything is read from the snapshot (and, for the testnet vault, its ledger).
 */

export type ReceiptKind = "lending" | "lp" | "staking" | "wrapped" | "vault";
export const KIND_LABEL: Record<ReceiptKind, string> = { lending: "Deposit receipt", lp: "LP share", staking: "Staking share", wrapped: "Wrapped coin", vault: "Vault share" };
export interface UPart { key: string; label: string; share: number; color: string; note?: string }
export interface Receipt {
  id: string;                 // asset id (chain:erc20:address); the vault share uses its own
  href: string;
  chain: string;              // display name
  address: string;
  symbol: string; name: string; kind: ReceiptKind;
  issuer: { href: string; name: string } | null;
  claim: string;              // one sentence: what one token is a claim on
  per: string;                // the conversion, in numbers
  size: number | null;        // USD behind all of it
  sizeNote?: string;
  parts: UPart[]; partsLabel: string;
  facts: [string, string][];
  flags: [Status, string][];
  exit: string;               // how you get the assets back, and what can stop you
  opp?: string;               // opportunity id it belongs to
}

const CASH = "#2FA88F", LENT = "#4F8EE0", GAP = "#D55A7C";
const TOKEN_COLORS = ["#D17A30", "#8578E6"];
const CHAIN: Record<string, string> = { igra: "Igra", kasplex: "Kasplex L2" };
const amt = (v: number, sym: string) => `${v >= 1e9 ? (v / 1e9).toFixed(2) + "B" : v >= 1e6 ? (v / 1e6).toFixed(2) + "M" : v >= 1e3 ? (v / 1e3).toFixed(1) + "K" : v >= 1 ? v.toFixed(2) : v.toPrecision(3)} ${sym}`;
const day = (t: number | null) => (t ? new Date(t).toISOString().slice(0, 10) : null);

/**
 * The share token of an Infinity Pool: a separate ERC-20 (xZEAL, xNACHO…) from the vault
 * contract. Found among the pool tokens dawns reads by its symbol; the vault if not traded.
 */
export function infinityShare(s: Snapshot, v: { chain: string; symbol: string; vault: string }): string {
  for (const p of s.protocols) for (const pool of p.dex?.pools ?? []) {
    if (pool.chain !== v.chain) continue;
    const i = pool.symbols.findIndex((x) => x.toLowerCase() === `x${v.symbol}`.toLowerCase());
    if (i >= 0) return pool.tk[i].a.toLowerCase();
  }
  return v.vault.toLowerCase();
}

export function receiptsFrom(s: Snapshot): Receipt[] {
  const out: Receipt[] = [];
  for (const p of s.protocols) {
    /* ---- lending: the market's deposit receipt ---- */
    for (const m of p.lending?.markets ?? []) {
      if (!m.aToken || !/^0x[0-9a-f]{40}$/i.test(m.aToken)) continue;
      const a = m.aToken.toLowerCase();
      const cashShare = m.suppliedUsd ? Math.min(1, m.cashUsd / m.suppliedUsd) : 0;
      const flags: [Status, string][] = [];
      if (m.utilization >= 0.95) flags.push(["crit", `Only ${usd(m.cashUsd)} of ${usd(m.suppliedUsd)} can be withdrawn now: the rest is lent out.`]);
      else if (m.utilization >= 0.8) flags.push(["warn", `${pct(m.utilization, 0)} is lent out; withdrawals above ${usd(m.cashUsd)} wait for repayments.`]);
      if (m.frozen) flags.push(["warn", "The market is frozen: no new deposits or borrows."]);
      if (m.oracleError === "StalePrice") flags.push(["warn", "The price oracle is stale: liquidations fail until it updates, which puts the loans behind this receipt at risk."]);
      else if (!m.oracleOk) flags.push(["warn", "The price oracle reverts for this asset."]);
      if (p.lending && !p.lending.aclAdminIsContract) flags.push(["warn", "The protocol admin is a single key: it can change the market's rules."]);
      out.push({
        id: `igra:erc20:${a}`, href: `/assets/igra/erc20/${a}`, chain: "Igra", address: a,
        symbol: `${p.name} ${m.symbol}`, name: `${p.name} ${m.symbol} deposit receipt`, kind: "lending", issuer: { href: `/protocols/${p.id}`, name: p.name },
        claim: `One ${m.symbol} supplied to ${p.name}, plus the interest borrowers pay. Your balance of it grows as interest accrues.`,
        per: `1 receipt = 1 ${m.symbol} · earning ${pct(m.supplyApy, m.supplyApy < 0.1 ? 2 : 1)} a year`,
        size: m.suppliedUsd,
        parts: [
          { key: "cash", label: "In the market, withdrawable now", share: cashShare, color: CASH, note: `${amt(m.cash, m.symbol)} · ${usd(m.cashUsd)}` },
          { key: "lent", label: "Lent to borrowers against collateral", share: 1 - cashShare, color: LENT, note: `${amt(m.borrowed, m.symbol)} · ${usd(m.borrowedUsd)}` },
        ],
        partsLabel: `What backs ${m.symbol} deposits on ${p.name}`,
        facts: [
          ["Supplied", `${amt(m.supplied, m.symbol)} · ${usd(m.suppliedUsd)}`],
          ["Lent out", `${pct(m.utilization, 1)} (utilization)`],
          ["Borrowers post", `collateral worth more than the loan; liquidated below ${pct(m.liquidationThreshold, 0)} loan-to-value`],
          ["Oracle", m.oracleOk ? (m.oracleDeviation != null ? `working · ${pct(Math.abs(m.oracleDeviation), 1)} from market` : "working") : m.oracleError ?? "reverting"],
        ],
        flags,
        exit: `Redeem for ${m.symbol} from the market's cash: ${usd(m.cashUsd)} can leave now. Beyond that, you wait for borrowers to repay or new deposits to arrive.`,
        opp: `${p.id}:${m.symbol}`,
      });
    }

    /* ---- liquidity: the V2 LP share (V3 positions are NFTs, not fungible) ---- */
    for (const pool of p.dex?.pools ?? []) {
      if (pool.kind !== "v2" || !/^0x[0-9a-f]{40}$/i.test(pool.pair) || pool.usd <= 0) continue;
      const a = pool.pair.toLowerCase();
      const v = pool.tk.map((t, i) => (t.px != null ? pool.reserves[i] * t.px : null));
      const known = v[0] != null && v[1] != null && v[0]! + v[1]! > 0;
      const sh0 = known ? v[0]! / (v[0]! + v[1]!) : 0.5;
      const k = 1000 / pool.usd;
      const opp = s.opportunities.find((o) => o.id === `${p.id}:${a}`);
      const farm = (p.dex?.farms ?? []).flatMap((f) => f.pools.filter((q) => q.pair === a).map((q) => ({ f, q })))[0];
      const flags: [Status, string][] = [];
      if (opp?.ilAtMove != null && opp.ilAtMove >= 0.01) flags.push(["warn", `The price moved ${pct(opp.priceMove ?? 0, 0)} in ${Math.round(opp.rangeHours)} h; at that move an LP trails simply holding by ${pct(opp.ilAtMove, 1)}.`]);
      if (pool.tk.some((t) => t.px == null)) flags.push(["warn", "One token has no reliable price: the split is by count, not by value."]);
      if (pool.usd < 10_000) flags.push(["warn", `A small pool (${usd(pool.usd)}): one trade moves its price.`]);
      const feeRate = p.dex!.feeRate;
      const lpShare = pool.lpShare ?? p.dex!.lpShare ?? 1;
      out.push({
        id: `${pool.chain}:erc20:${a}`, href: `/assets/${pool.chain}/erc20/${a}`, chain: CHAIN[pool.chain], address: a,
        symbol: `${pool.symbols.join("/")} LP`, name: `${pool.symbols.join(" / ")} LP share on ${p.name}`, kind: "lp", issuer: { href: `/protocols/${p.id}`, name: p.name },
        claim: `A share of the pool's two reserves. Traders swap against them, so the mix shifts with the price; fees add to both.`,
        per: `$1,000 of LP = ${amt(pool.reserves[0] * k, pool.symbols[0])} + ${amt(pool.reserves[1] * k, pool.symbols[1])}`,
        size: pool.usd,
        parts: pool.symbols.map((sym, i) => ({ key: sym + i, label: sym, share: i ? 1 - sh0 : sh0, color: TOKEN_COLORS[i], note: `${amt(pool.reserves[i], sym)}${v[i] != null ? ` · ${usd(v[i]!)}` : " · no price"}` })),
        partsLabel: `What the ${pool.symbols.join("/")} pool holds`,
        facts: [
          ["Pool", `${usd(pool.usd)} · ${p.name}, ${CHAIN[pool.chain]}`],
          ["Fees to LPs", feeRate != null ? `${pct(feeRate * lpShare, 2)} of each swap` : "unknown"],
          ...(opp?.apy != null ? [["Fee yield", `${pct(opp.apy, 1)} · ${opp.apyShort}`] as [string, string]] : []),
          ...(farm ? [["Staked in the farm", `${pct(farm.q.stakedShare, 0)} of the LP${farm.f.perDay > 0 ? "" : " · rewards off"}`] as [string, string]] : []),
        ],
        flags,
        exit: `Remove liquidity any time: you get both tokens back at the pool's current mix. What you get depends on the price then, not when you entered.`,
        opp: `${p.id}:${a}`,
      });
    }

    /* ---- staking: the Infinity Pool share ---- */
    for (const v of p.dex?.infinity ?? []) {
      if (!/^0x[0-9a-f]{40}$/i.test(v.vault)) continue;
      const a = infinityShare(s, v);
      const e = v.emissions;
      const flags: [Status, string][] = [];
      if (e?.paused) flags.push(["warn", `Reward emissions are paused${e.lastAt ? ` since ${day(e.lastAt)}` : ""}: the rate only grows if the owner turns them back on.`]);
      flags.push(["info", "The vault contract is not verified on the explorer; dawns matched its functions from bytecode."]);
      out.push({
        id: `${v.chain}:erc20:${a}`, href: `/assets/${v.chain}/erc20/${a}`, chain: CHAIN[v.chain], address: a,
        symbol: `x${v.symbol}`, name: `${p.name} Infinity Pool ${v.symbol} share`, kind: "staking", issuer: { href: `/protocols/${p.id}`, name: p.name },
        claim: `${v.symbol} staked in ${p.name}'s Infinity Pool. Rewards are added to the pool, so each share redeems for more ${v.symbol} over time.`,
        per: v.rate != null ? `1 x${v.symbol} = ${v.rate.toFixed(4)} ${v.symbol}` : "rate unreadable",
        size: v.usd, sizeNote: v.usd == null ? "no price" : undefined,
        parts: [{ key: "u", label: `${v.symbol} held by the vault`, share: 1, color: TOKEN_COLORS[0], note: amt(v.amount, v.symbol) }],
        partsLabel: `What backs x${v.symbol}`,
        facts: [
          ["Held", `${amt(v.amount, v.symbol)}${v.usd != null ? ` · ${usd(v.usd)}` : ""}`],
          ["Since launch", v.rate != null ? `+${pct(v.rate - 1, 2)} ${v.symbol} per share` : "—"],
          ["Emissions", e == null ? "not read" : e.paused ? "paused" : e.perBlock ? `${e.perBlock} ${v.symbol} a block` : "on"],
          ["Price exposure", `all of it is ${v.symbol}: its dollar value moves with ${v.symbol}`],
        ],
        flags,
        exit: `Redeem x${v.symbol} for ${v.symbol} at the vault's rate. Selling ${v.symbol} after that depends on its own pools.`,
      });
    }
  }

  /* ---- wrapped: WiKAS, backed by KAS locked on Kaspa L1 ---- */
  const b = s.bridge;
  const wk = s.protocols.flatMap((p) => p.dex?.pools ?? []).filter((q) => q.chain === "igra").flatMap((q) => q.symbols.map((sym, i) => ({ sym, t: q.tk[i] }))).find((x) => /^wikas$/i.test(x.sym));
  if (b && wk && /^0x[0-9a-f]{40}$/i.test(wk.t.a)) {
    const a = wk.t.a.toLowerCase();
    const cov = b.coverage;
    const flags: [Status, string][] = [];
    if (cov < 0.99) flags.push([cov < 0.95 ? "crit" : "warn", `KAS locked covers ${pct(cov, 1)} of iKAS in circulation.`]);
    if (!b.ownerIsContract) flags.push(["warn", "The exit bridge owner is a single key: it can change limits and fees."]);
    flags.push(["info", "The KAS sits in a multisig on Kaspa L1, released by the bridge's guardian committee, not by a contract you can call."]);
    out.push({
      id: `igra:erc20:${a}`, href: `/assets/igra/erc20/${a}`, chain: "Igra", address: a,
      symbol: "WiKAS", name: "Wrapped iKAS", kind: "wrapped", issuer: { href: "/bridge", name: "Igra bridge" },
      claim: "One iKAS, Igra's coin, wrapped as a token. Each iKAS is minted for KAS sent to the bridge's address on Kaspa L1.",
      per: "1 WiKAS = 1 iKAS = a claim on 1 KAS on Kaspa L1",
      size: s.kasUsd != null ? b.ikasSupply * s.kasUsd : null,
      parts: [
        { key: "locked", label: "KAS locked on Kaspa L1", share: Math.min(1, cov), color: CASH, note: amt(b.lockedKas, "KAS") },
        ...(cov < 1 ? [{ key: "gap", label: "Not covered", share: 1 - cov, color: GAP, note: amt(b.ikasSupply - b.lockedKas, "KAS") }] : []),
      ],
      partsLabel: "What backs iKAS",
      facts: [
        ["iKAS in circulation", amt(b.ikasSupply, "iKAS")],
        ["KAS locked", `${amt(b.lockedKas, "KAS")} · ${pct(cov, 2)} coverage`],
        ["Exit limits", `${amt(b.config.minExitKas, "KAS")} to ${amt(b.config.maxExitKas, "KAS")} each · ${amt(b.config.maxUnlockPerWindowKas, "KAS")} per window`],
        ["Exits waiting", `${amt(b.inWindowKas, "KAS")} requested in the last 72 h`],
      ],
      flags,
      exit: `Unwrap to iKAS, then request an exit on Igra: the iKAS is burned and KAS is released on L1 in 48–72 h, within the bridge's per-window limits (${amt(b.throttle.remainingUnlockKas, "KAS")} left in this window).`,
      opp: undefined,
    });
  }
  return out;
}

export const receiptOf = (s: Snapshot, id: string) => receiptsFrom(s).find((r) => r.id === id) ?? null;

/** The testnet NAV vault's share token: what one share is worth and where the NAV sits. */
export function navReceipt(v: { shareCovid: string; name: string; price: number; nav: number; liquid: number; shares: number; places: { label: string; kas: number }[] }): Receipt {
  const total = v.liquid + v.places.reduce((a, x) => a + x.kas, 0) || 1;
  const COLORS = ["#3987e5", "#d95926", "#199e70", "#c98500"];
  return {
    id: `tn10:kcc20:${v.shareCovid}`, href: "/vaults/nav-tn10", chain: "Kaspa testnet-10", address: v.shareCovid,
    symbol: "NAV share", name: `${v.name} share`, kind: "vault", issuer: { href: "/vaults/nav-tn10", name: "dawns NAV vault" },
    claim: "A share of the vault's net asset value: KAS it holds plus positions at their last mark. Minted and redeemed at NAV, enforced by the Kaspa covenant.",
    per: `1 share = ${v.price.toFixed(6)} KAS`,
    size: null, sizeNote: `${amt(v.nav, "KAS")} NAV · testnet, no dollar value`,
    parts: [
      { key: "liquid", label: "KAS in the vault", share: v.liquid / total, color: "#9085e9", note: amt(v.liquid, "KAS") },
      ...v.places.map((p, i) => ({ key: `d${i}`, label: p.label, share: p.kas / total, color: COLORS[i % 4], note: `${amt(p.kas, "KAS")} marked` })),
    ],
    partsLabel: "Where the NAV is",
    facts: [["Shares", v.shares.toLocaleString("en-US")], ["NAV", amt(v.nav, "KAS")]],
    flags: [["info", "Testnet-10 only: no real value. Not audited."]],
    exit: "Redeem at NAV from the vault's liquid KAS; positions come back only when the allocator recalls them.",
  };
}
