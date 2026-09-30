import type { BridgeState, ContractRow, OwnerAction, ProtocolView, Snapshot, Status } from "./types";

/**
 * Proof of reserves, read by dawns: for each protocol it reads on-chain (and the Igra
 * bridge), what backs users' money against what users are owed, how they get it back,
 * and exactly where each figure is read. Nothing here is reported by the protocol.
 */

export type ProofKind = "bridge" | "lending" | "dex";
export type Unit = "USD" | "KAS";

export interface ProofLine { label: string; sub?: string; value: number; share: number; chain?: string; href?: string }
export interface ProofExitRow { label: string; value: string; sub?: string; tone?: Status }
export interface ProofBar { label: string; have: number; of: number; sub: string }
export interface ProofSource { name: string; what: string; type: string; side: "Reserves" | "Owed" | "Exits" | "Prices"; chain: string; href: string | null }
export interface ProofLoans { borrowers: number; debtUsd: number; collateralUsd: number; liquidatableUsd: number; liquidatable: number; badDebtUsd: number; badDebtAccounts: number }

export interface Proof {
  id: string; name: string; kind: ProofKind; href: string; site: string | null;
  unit: Unit; kasUsd: number | null;
  reserves: number; owed: number;
  /** reserves ÷ owed; for a DEX the pool's reserves are its LPs' by construction, so there is no ratio to watch */
  coverage: number | null;
  reservesLabel: string; reservesSub: string; owedLabel: string; owedSub: string; coverageSub: string;
  status: Status; statusText: string;
  read: { chain: "igra" | "kasplex"; block: number; t: number } | null;
  usdValue: number;
  breakdown: { title: string; sub: string; rows: ProofLine[] };
  exits: { title: string; lead: string; rows: ProofExitRow[]; bars: ProofBar[]; waits: { label: string; value: number; color: string }[] };
  loans: ProofLoans | null;
  sources: ProofSource[];
  control: ContractRow[];
  owner: OwnerAction[];
  checks: [string, string, string][];
  pending: [string, string][];
}

export const ENTRY = "kaspa:ppvnxxzm0rr37zpnwux2f2ntvfpr4uqdpm7zsvsztg3en92r7gs0wkmr72q9n";
export const EXIT = "0x4bb88C213d3eD9dc4bae694f1bc1bF745903b2d0";
export const BRIDGE_ID = "igra-bridge";

const EXPL = { igra: "https://explorer.igralabs.com", kasplex: "https://explorer.kasplex.org" } as const;
const addrUrl = (chain: "igra" | "kasplex", a: string) => `${EXPL[chain]}/address/${a}`;
const chainName = (c: string) => (c === "kasplex" ? "Kasplex" : c === "igra" ? "Igra" : c);
const hrs = (h: number) => (h < 48 ? `${Math.max(1, Math.round(h))} h` : `${Math.round(h / 24)} days`);

function bridgeProof(s: Snapshot, b: BridgeState): Proof {
  const po = b.payouts;
  const now = b.timestamp * 1000;
  const took = b.recentExits.map((e) => (e.paidAt ? (e.paidAt - (now - e.ageSec * 1000)) / 3600_000 : null));
  const waits = [
    { label: "< 12 h", value: took.filter((h) => h != null && h < 12).length, color: "#199e70" },
    { label: "12–24 h", value: took.filter((h) => h != null && h >= 12 && h < 24).length, color: "#199e70" },
    { label: "24–48 h", value: took.filter((h) => h != null && h >= 24 && h < 48).length, color: "#3987e5" },
    { label: "48–72 h", value: took.filter((h) => h != null && h >= 48 && h < 72).length, color: "#c98500" },
    { label: "> 72 h", value: took.filter((h) => h != null && h >= 72).length, color: "#d95926" },
    { label: "Waiting", value: b.recentExits.filter((e) => !e.paidTx).length, color: "#4A4270" },
  ];
  const status: Status = b.coverage >= 1 ? "good" : b.coverage >= 0.99 ? "warn" : "crit";
  const pending = po ? po.unpaidKas : b.inWindowKas;
  return {
    id: BRIDGE_ID, name: "Igra bridge", kind: "bridge", href: "/bridge", site: null,
    unit: "KAS", kasUsd: s.kasUsd,
    reserves: b.lockedKas, owed: b.ikasSupply, coverage: b.coverage,
    reservesLabel: "KAS locked on Kaspa L1", reservesSub: "balance of the bridge's Entry address",
    owedLabel: "iKAS in circulation", owedSub: "native supply on Igra: every iKAS is a claim on one KAS",
    coverageSub: b.coverage >= 1 ? "every iKAS is backed" : "less KAS locked than iKAS issued",
    status, statusText: status === "good" ? "Fully backed" : status === "warn" ? "Slightly under-backed" : "Under-backed",
    read: { chain: "igra", block: b.block, t: now },
    usdValue: s.kasUsd ? b.lockedKas * s.kasUsd : 0,
    breakdown: {
      title: "Where the locked KAS goes", sub: "Locked KAS split by what it backs",
      rows: [
        { label: "Backs iKAS in circulation", value: Math.min(b.ikasSupply, b.lockedKas), share: Math.min(b.ikasSupply, b.lockedKas) / b.lockedKas, chain: "Kaspa L1" },
        ...(b.surplusKas > 0 ? [
          { label: "Exits burned on Igra, awaiting L1 payout", value: Math.min(pending, b.surplusKas), share: Math.min(pending, b.surplusKas) / b.lockedKas, chain: "Kaspa L1" },
          { label: "Surplus beyond pending exits", value: Math.max(0, b.surplusKas - pending), share: Math.max(0, b.surplusKas - pending) / b.lockedKas, chain: "Kaspa L1" },
        ] : []),
      ].filter((r) => r.value > 0),
    },
    exits: {
      title: "Can holders get their KAS back?",
      lead: "Leaving burns iKAS on Igra at once; the guardian committee then pays the KAS on L1 from the Entry address. dawns matches every exit to its L1 payment.",
      rows: po ? [
        { label: "Exits awaiting L1 payout", value: `${Math.round(po.unpaidKas).toLocaleString("en-US")} KAS`, sub: `${po.unpaid} exits${po.unchecked ? ` · ${po.unchecked} still being matched` : ""}` },
        { label: "Late: over 72 hours", value: String(po.late), sub: po.late ? `${Math.round(po.lateKas).toLocaleString("en-US")} KAS` : "none", tone: po.late ? "warn" : "good" },
        { label: "Typical payout time", value: po.medianHours != null ? hrs(po.medianHours) : "—", sub: "median, last 30 days" },
        { label: "Exits matched to an L1 payment", value: `${po.paid.toLocaleString("en-US")} of ${po.indexed.toLocaleString("en-US")}`, sub: "every exit dawns has indexed" },
      ] : [
        { label: "Exits in the release window", value: `${Math.round(b.inWindowKas).toLocaleString("en-US")} KAS`, sub: `${b.inWindowCount} in the last 72 h` },
        { label: "Exited all-time", value: `${Math.round(b.totalBurnedKas).toLocaleString("en-US")} KAS`, sub: `${b.exitsTotal.toLocaleString("en-US")} exits` },
      ],
      bars: [], waits: waits.some((w) => w.value) ? waits : [],
    },
    loans: null,
    sources: [
      { name: "Bridge Entry address", what: "KAS balance, read from a Kaspa node", type: "L1 address", side: "Reserves", chain: "Kaspa L1", href: `https://explorer.kaspa.org/addresses/${ENTRY}` },
      { name: "iKAS supply", what: "native supply of iKAS on Igra", type: "Chain state", side: "Owed", chain: "Igra", href: EXPL.igra },
      { name: "KasExitBridge", what: "exit requests and burns, with the contract's limits", type: "Contract", side: "Exits", chain: "Igra", href: addrUrl("igra", EXIT) },
      { name: "L1 payouts", what: "each exit matched to a payment from the Entry address", type: "dawns indexer", side: "Exits", chain: "Kaspa L1", href: null },
    ],
    control: [{ n: "KasExitBridge", addr: EXIT, chain: "igra", up: b.implementation ? "Upgradeable proxy" : "Not upgradeable", admin: b.ownerIsContract ? "Owned by a contract" : "Owned by a single key", pause: "—", t: b.ownerIsContract ? "good" : "warn" }],
    owner: [],
    checks: [
      ["KAS locked on L1", "balance of the Entry address, read from a Kaspa node", "Kaspa L1"],
      ["iKAS issued", "native supply on Igra at the block shown", "Igra"],
      ["Exits and payouts", "each burn on Igra matched to its L1 payment", "Both chains"],
    ],
    pending: [["Guardian committee", "who signs L1 payouts and how many signatures it takes is not visible on-chain"]],
  };
}

function lendingProof(s: Snapshot, p: ProtocolView): Proof {
  const L = p.lending!;
  const assets = L.cashUsd + L.borrowedUsd;
  const P = L.positions;
  const status: Status = L.coverage >= 1 ? p.status : "crit";
  return {
    id: p.id, name: p.name, kind: "lending", href: `/protocols/${p.id}`, site: p.site,
    unit: "USD", kasUsd: s.kasUsd,
    reserves: assets, owed: L.suppliedUsd, coverage: L.coverage,
    reservesLabel: "Cash + loans", reservesSub: "tokens held by the markets plus what borrowers owe",
    owedLabel: "Owed to suppliers", owedSub: "receipt tokens (k-tokens) in circulation",
    coverageSub: L.coverage >= 1 ? "suppliers' claims are covered" : "claims exceed cash and loans",
    status, statusText: L.coverage >= 1 ? p.statusText : "Claims not covered",
    read: p.asOf ? { chain: p.asOf.chain, block: p.asOf.block, t: p.asOf.timestamp * 1000 } : null,
    usdValue: assets,
    breakdown: {
      title: "Reserves by market", sub: "Cash in each market plus its outstanding loans",
      rows: L.markets.map((m) => ({ label: m.symbol, sub: `${Math.round(m.utilization * 100)}% lent out${m.frozen ? " · frozen" : ""}`, value: m.cashUsd + m.borrowedUsd, share: assets ? (m.cashUsd + m.borrowedUsd) / assets : 0, chain: "Igra", href: addrUrl("igra", m.aToken) }))
        .sort((a, b) => b.value - a.value),
    },
    exits: {
      title: "Can suppliers withdraw?",
      lead: "Withdrawals are paid from cash in each market. What is lent out comes back only as borrowers repay or are liquidated.",
      rows: [
        { label: "Withdrawable right now", value: `$${Math.round(L.cashUsd).toLocaleString("en-US")}`, sub: `${Math.round((L.cashUsd / Math.max(1, L.suppliedUsd)) * 100)}% of what suppliers are owed`, tone: L.cashUsd / Math.max(1, L.suppliedUsd) < 0.2 ? "warn" : "good" },
        { label: "Lent to borrowers", value: `$${Math.round(L.borrowedUsd).toLocaleString("en-US")}`, sub: `${Math.round(L.utilization * 100)}% utilization` },
      ],
      bars: L.markets.map((m) => ({ label: m.symbol, have: m.cashUsd, of: m.suppliedUsd, sub: `${m.supplied ? Math.round(Math.max(0, m.cash / m.supplied) * 100) : 0}% could leave now` })),
      waits: [],
    },
    loans: P ? { borrowers: P.borrowers, debtUsd: P.debtUsd, collateralUsd: P.collateralUsd, liquidatableUsd: P.liquidatableUsd, liquidatable: P.liquidatable, badDebtUsd: P.badDebtUsd, badDebtAccounts: P.badDebtAccounts } : null,
    sources: [
      ...L.markets.flatMap((m): ProofSource[] => [
        { name: `k${m.symbol}`, what: `totalSupply: what ${m.symbol} suppliers are owed; balanceOf(${m.symbol}): cash held`, type: "Contract", side: "Owed", chain: "Igra", href: addrUrl("igra", m.aToken) },
        { name: `${m.symbol} variable debt`, what: "totalSupply: what borrowers owe", type: "Contract", side: "Reserves", chain: "Igra", href: addrUrl("igra", m.debtToken) },
      ]),
      { name: "Price oracle", what: "the prices the protocol itself uses, checked against market prices", type: "Contract", side: "Prices", chain: "Igra", href: L.oracle ? addrUrl("igra", L.oracle) : null },
      ...(P ? [{ name: "Every account", what: `collateral and debt of ${P.accounts.toLocaleString("en-US")} accounts, from token balances`, type: "dawns indexer", side: "Reserves" as const, chain: "Igra", href: null }] : []),
    ],
    control: p.contracts, owner: (p.ownerLog ?? []).slice(0, 5),
    checks: p.canVerify, pending: p.cannotVerify,
  };
}

function dexProof(s: Snapshot, p: ProtocolView): Proof {
  const d = p.dex!;
  const pools = d.pools.filter((q) => q.usd > 0);
  const chains = [...new Set(pools.map((q) => q.chain))];
  const top = pools.filter((q) => q.usd > 2e4 && q.impact10k != null).slice(0, 4);
  return {
    id: p.id, name: p.name, kind: "dex", href: `/protocols/${p.id}`, site: p.site,
    unit: "USD", kasUsd: s.kasUsd,
    reserves: p.tvl, owed: p.tvl, coverage: null,
    reservesLabel: "Held by the pools", reservesSub: `${d.pairCount} pools on ${chains.map(chainName).join(" and ") || "—"}, read from each pool contract`,
    owedLabel: "Owed to liquidity providers", owedSub: "the same tokens: a pool's reserves belong to its LPs, pro rata",
    coverageSub: "by construction: LPs redeem straight from the pool",
    status: p.status, statusText: p.statusText,
    read: p.asOf ? { chain: p.asOf.chain, block: p.asOf.block, t: p.asOf.timestamp * 1000 } : null,
    usdValue: p.tvl,
    breakdown: {
      title: "Reserves by pool", sub: `The ${Math.min(12, pools.length)} largest of ${d.pairCount} pools`,
      rows: pools.slice(0, 12).map((q) => ({ label: q.symbols.join(" / "), sub: `${q.reserves.map((r, j) => `${r.toLocaleString("en-US", { maximumFractionDigits: r < 10 ? 3 : 0 })} ${q.symbols[j]}`).join(" + ")}${q.kind === "v3" ? " · concentrated" : ""}`, value: q.usd, share: q.share, chain: chainName(q.chain), href: addrUrl(q.chain, q.pair) })),
    },
    exits: {
      title: "Can liquidity providers leave?",
      lead: "An LP can remove liquidity at any time, straight from the pool: no queue and no one's permission. What they get back depends on the pool price at that moment.",
      rows: [
        { label: "Withdrawable right now", value: `$${Math.round(p.tvl).toLocaleString("en-US")}`, sub: "all of it, at the pool price" },
        ...(d.vol24 != null ? [{ label: "Traded, last 24 hours", value: `$${Math.round(d.vol24).toLocaleString("en-US")}`, sub: `${p.tvl ? (d.vol24 / p.tvl).toFixed(2) : "—"}× the reserves` }] : []),
        ...top.map((q) => ({ label: `$10K trade in ${q.symbols.join(" / ")}`, value: `${((q.impact10k ?? 0) * 100).toFixed(2)}%`, sub: "price impact: how deep the pool is", tone: ((q.impact10k ?? 0) > 0.05 ? "warn" : "good") as Status })),
      ],
      bars: [], waits: [],
    },
    loans: null,
    sources: [
      ...pools.slice(0, 8).map((q): ProofSource => ({ name: `${q.symbols.join(" / ")} pool`, what: q.kind === "v3" ? "liquidity and price at the block, token balances of the pool" : "getReserves(): the tokens the pool holds", type: "Contract", side: "Reserves", chain: chainName(q.chain), href: addrUrl(q.chain, q.pair) })),
      ...(pools.length > 8 ? [{ name: `${pools.length - 8} more pools`, what: "read the same way", type: "Contract", side: "Reserves" as const, chain: chains.map(chainName).join(", "), href: null }] : []),
      { name: "Token prices", what: "each token priced by its deepest pool against KAS or a stablecoin", type: "dawns pricing", side: "Prices", chain: chains.map(chainName).join(", "), href: null },
    ],
    control: p.contracts, owner: (p.ownerLog ?? []).slice(0, 5),
    checks: p.canVerify, pending: p.cannotVerify,
  };
}

/** Every proof dawns can give today: the bridge first, then protocols read on-chain, largest first. */
export function proofs(s: Snapshot): Proof[] {
  const out: Proof[] = [];
  if (s.bridge) out.push(bridgeProof(s, s.bridge));
  const ps = s.protocols.filter((p) => p.source === "onchain" && ((p.lending && p.lending.suppliedUsd > 0) || (p.dex && p.tvl > 0)));
  for (const p of ps) out.push(p.lending ? lendingProof(s, p) : dexProof(s, p));
  return [out[0], ...out.slice(1).sort((a, b) => b.usdValue - a.usdValue)].filter(Boolean) as Proof[];
}

export const proofOf = (s: Snapshot, id: string) => proofs(s).find((p) => p.id === id) ?? null;

/** The one line a badge or a card shows. */
export function proofHeadline(p: Proof): { label: string; value: string } {
  if (p.coverage != null) return { label: p.kind === "bridge" ? "Backing" : "Reserves", value: `${(p.coverage * 100).toFixed(1)}%` };
  return { label: "Reserves", value: usdShort(p.reserves) };
}

export function usdShort(v: number) {
  const a = Math.abs(v);
  return a >= 1e9 ? `$${(a / 1e9).toFixed(2)}B` : a >= 1e6 ? `$${(a / 1e6).toFixed(2)}M` : a >= 1e3 ? `$${(a / 1e3).toFixed(1)}K` : `$${a.toFixed(0)}`;
}
