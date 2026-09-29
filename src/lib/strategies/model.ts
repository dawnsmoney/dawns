import { blake2b } from "@noble/hashes/blake2b";
import type { Opportunity, Status } from "../types";

/**
 * A strategy: how capital is split across opportunities, the rules it keeps, and the
 * terms of the vault that would run it. Pure and client-safe; the same document and the
 * same opportunities always give the same evaluation.
 *
 *   Assets → Opportunities → Strategy → Vault → Monitor
 *
 * The vault does not make the yield; the opportunities do. The strategy is the choice.
 * Strategist ≠ vault curator ≠ allocator ≠ depositor.
 */
export const MAX_LEGS = 4;           // the NAV covenant has four destination slots
const BPS = 10_000;

export type VaultType = "nav" | "fixed";
export type Access = "permissionless" | "whitelist" | "private";
export type PauseRule = "exit-blocked" | "oracle" | "frozen" | "volume";

/**
 * A credit leg: capital lent to a named borrower (market maker, prime broker, exchange,
 * custodian…) for a fixed term at a contract rate. It is not an on-chain market, so dawns
 * cannot read its yield or its exit: the terms are the strategist's, the repayment is the
 * borrower's promise, and only what comes back to the vault is seen on-chain.
 */
export type BorrowerKind = "market-maker" | "prime-broker" | "exchange" | "custodian" | "fund" | "other";
export const BORROWER: Record<BorrowerKind, string> = { "market-maker": "Market maker", "prime-broker": "Prime broker", exchange: "Exchange", custodian: "Custodian", fund: "Fund", other: "Other" };
export interface CreditTerms {
  borrower: string; kind: BorrowerKind;
  rateBps: number;                 // contract rate a year
  termDays: number;                // capital is locked until repaid
  collateral: "secured" | "unsecured"; collateralNote: string;
  graceDays: number; markdownBps: number;   // overdue: after the grace, the mark falls this much each 30 days
  reporting: "attested" | "self";  // who reports the loan's standing
}
export const creditId = (borrower: string) => `credit:${borrower.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40)}`;
export interface Leg { opp: string; target: number; cap: number; credit?: CreditTerms }   // bps of the vault
export interface StrategyDoc {
  v: 1;
  name: string;
  thesis: string;
  legs: Leg[];
  reserveBps: number;              // held in the vault as KAS, the first thing redemptions draw on
  maxProtocolBps: number;          // most of the vault in one protocol
  exitCover: number;               // a leg's position must be ≤ the market's withdrawable cash ÷ this
  driftBps: number;                // rebalance when a leg is this far from target
  pause: PauseRule[];
  fees: { performanceBps: number; managementBps: number };
  noticeDays: number;              // a new version takes effect this long after it is published
  vault: { type: VaultType; access: Access; capacityKas: number; exitFeeBps: number; termDays: number; depositDays: number; redemptionDays: number };
}

export const PAUSE: Record<PauseRule, { label: string; why: string }> = {
  "exit-blocked": { label: "Exit blocked", why: "No new capital into a market at ≥95% utilization; suppliers there cannot leave." },
  oracle: { label: "Oracle fault", why: "No new capital while the market's price oracle is stale, reverting or ≥2% off." },
  frozen: { label: "Frozen market", why: "No new capital into a frozen market." },
  volume: { label: "Suspicious volume", why: "No new capital into a pool trading more than 3× its size a day." },
};

export const DEFAULT_NOTICE = 7;
export const DEFAULT_DOC: StrategyDoc = {
  v: 1, name: "", thesis: "", legs: [], reserveBps: 2_000, maxProtocolBps: 6_000, exitCover: 2, driftBps: 500,
  pause: ["exit-blocked", "oracle", "frozen", "volume"],
  fees: { performanceBps: 1_000, managementBps: 0 },
  noticeDays: 7,
  vault: { type: "nav", access: "permissionless", capacityKas: 100_000, exitFeeBps: 50, termDays: 0, depositDays: 0, redemptionDays: 0 },
};

// ---------------------------------------------------------------------------
// canonical form, id, validation
// ---------------------------------------------------------------------------
const int = (x: unknown, lo: number, hi: number) => { const n = Math.round(Number(x)); return Number.isFinite(n) && n >= lo && n <= hi ? n : null; };
const str = (x: unknown, max: number) => (typeof x === "string" ? x.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** Parse untrusted input into a canonical document, or explain what is wrong. */
export function parseDoc(x: unknown): { doc: StrategyDoc } | { error: string } {
  if (!x || typeof x !== "object") return { error: "Not a strategy." };
  const o = x as Record<string, unknown>;
  const name = str(o.name, 60), thesis = str(o.thesis, 600);
  if (name.length < 3) return { error: "Give the strategy a name (3 characters or more)." };
  const legsIn = Array.isArray(o.legs) ? o.legs : [];
  if (legsIn.length < 1 || legsIn.length > MAX_LEGS) return { error: `A strategy has 1 to ${MAX_LEGS} legs.` };
  const legs: Leg[] = [];
  for (const l of legsIn) {
    const r = (l ?? {}) as Record<string, unknown>;
    const opp = str(r.opp, 200), target = int(r.target, 1, BPS), cap = int(r.cap, 1, BPS);
    if (!opp || target == null || cap == null) return { error: "Every leg needs an opportunity, a target and a cap." };
    if (cap < target) return { error: "A leg's cap cannot be below its target." };
    if (legs.some((y) => y.opp === opp)) return { error: "The same opportunity twice." };
    let credit: CreditTerms | undefined;
    if (r.credit != null) {
      const c = r.credit as Record<string, unknown>;
      const borrower = str(c.borrower, 60);
      const kind = (typeof c.kind === "string" && c.kind in BORROWER ? c.kind : "other") as BorrowerKind;
      const rateBps = int(c.rateBps, 0, 5_000), termDays = int(c.termDays, 7, 730), graceDays = int(c.graceDays, 0, 90), markdownBps = int(c.markdownBps, 0, BPS);
      if (borrower.length < 2) return { error: "A credit leg needs the borrower's name." };
      if (rateBps == null || termDays == null || graceDays == null || markdownBps == null) return { error: "Credit terms out of range (rate ≤ 50%, term 7–730 days, grace ≤ 90 days)." };
      if (opp !== creditId(borrower)) return { error: "A credit leg's id must follow its borrower's name." };
      credit = { borrower, kind, rateBps, termDays, collateral: c.collateral === "unsecured" ? "unsecured" : "secured", collateralNote: str(c.collateralNote, 200), graceDays, markdownBps, reporting: c.reporting === "attested" ? "attested" : "self" };
    } else if (opp.startsWith("credit:")) return { error: "A credit leg needs its terms." };
    legs.push(credit ? { opp, target, cap, credit } : { opp, target, cap });
  }
  const reserveBps = int(o.reserveBps, 0, BPS);
  if (reserveBps == null) return { error: "Reserve must be 0–100%." };
  if (legs.reduce((s, l) => s + l.target, 0) + reserveBps !== BPS) return { error: "Targets and reserve must add up to 100%." };
  const maxProtocolBps = int(o.maxProtocolBps, 1_000, BPS), exitCover = Number(o.exitCover), driftBps = int(o.driftBps, 50, 5_000);
  if (maxProtocolBps == null || driftBps == null || !(exitCover >= 1 && exitCover <= 10)) return { error: "Limits out of range." };
  const pause = (Array.isArray(o.pause) ? o.pause : []).filter((p): p is PauseRule => typeof p === "string" && p in PAUSE);
  const f = (o.fees ?? {}) as Record<string, unknown>;
  const performanceBps = int(f.performanceBps, 0, 3_000), managementBps = int(f.managementBps, 0, 300);
  if (performanceBps == null || managementBps == null) return { error: "Performance fee 0–30%, management fee 0–3%." };
  const noticeDays = o.noticeDays == null ? DEFAULT_NOTICE : int(o.noticeDays, 3, 60);
  if (noticeDays == null) return { error: "Notice period 3–60 days." };
  const v = (o.vault ?? {}) as Record<string, unknown>;
  const type: VaultType = v.type === "fixed" ? "fixed" : "nav";
  const access: Access = v.access === "whitelist" || v.access === "private" ? v.access : "permissionless";
  const capacityKas = int(v.capacityKas, 100, 1_000_000), exitFeeBps = int(v.exitFeeBps, 0, 500);
  const termDays = type === "fixed" ? int(v.termDays, 7, 730) : 0, depositDays = type === "fixed" ? int(v.depositDays, 1, 90) : 0;
  const redemptionDays = int(v.redemptionDays, 0, 7);
  if (capacityKas == null || exitFeeBps == null || termDays == null || depositDays == null || redemptionDays == null) return { error: "Vault terms out of range (capacity ≤ 1M KAS, exit fee ≤ 5%, redemption window ≤ 7 days)." };
  if (type === "fixed" && depositDays >= termDays) return { error: "The deposit window must close before maturity." };
  return { doc: { v: 1, name, thesis, legs, reserveBps, maxProtocolBps, exitCover: Math.round(exitCover * 10) / 10, driftBps, pause: [...new Set(pause)].sort() as PauseRule[],
    fees: { performanceBps, managementBps }, noticeDays, vault: { type, access, capacityKas, exitFeeBps, termDays, depositDays, redemptionDays } } };
}

/** Canonical JSON: fixed key order, so the same strategy always hashes the same. */
export function canonical(d: StrategyDoc): string {
  return JSON.stringify({
    v: d.v, name: d.name, thesis: d.thesis, legs: d.legs.map((l) => ({ opp: l.opp, target: l.target, cap: l.cap, ...(l.credit ? { credit: {
      borrower: l.credit.borrower, kind: l.credit.kind, rateBps: l.credit.rateBps, termDays: l.credit.termDays, collateral: l.credit.collateral,
      collateralNote: l.credit.collateralNote, graceDays: l.credit.graceDays, markdownBps: l.credit.markdownBps, reporting: l.credit.reporting } } : {}) })),
    reserveBps: d.reserveBps, maxProtocolBps: d.maxProtocolBps, exitCover: d.exitCover, driftBps: d.driftBps, pause: d.pause,
    fees: { performanceBps: d.fees.performanceBps, managementBps: d.fees.managementBps },
    // added after the first strategies were published: only in the hash when it differs from the default
    ...(d.noticeDays !== DEFAULT_NOTICE ? { noticeDays: d.noticeDays } : {}),
    vault: { type: d.vault.type, access: d.vault.access, capacityKas: d.vault.capacityKas, exitFeeBps: d.vault.exitFeeBps, termDays: d.vault.termDays, depositDays: d.vault.depositDays, redemptionDays: d.vault.redemptionDays },
  });
}
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
/** blake2b-256 of the canonical document: the strategy's hash; its id is the first 12 hex. */
export function strategyHash(d: StrategyDoc) { return hex(blake2b(new TextEncoder().encode(canonical(d)), { dkLen: 32 })); }
export const strategyId = (d: StrategyDoc) => strategyHash(d).slice(0, 12);

// ---------------------------------------------------------------------------
// evaluation
// ---------------------------------------------------------------------------
export interface LegView {
  leg: Leg; o: Opportunity | null; share: number; cap: number;
  name: string; where: string;     // for display: the opportunity, or the loan
  credit?: CreditTerms;
  usd: number;                     // position at full capacity
  apy: number | null; range: [number, number] | null;
  exitUsd: number;                 // what could leave the position now
  cover: number | null;            // market's withdrawable cash ÷ the position
  paused: PauseRule[];             // rules that stop new capital into this leg right now
  flags: { t: Status; text: string }[];
}
export interface Check { key: string; ok: boolean; t: Status; label: string; detail: string }
export interface Evaluation {
  legs: LegView[];
  capacityUsd: number | null;
  gross: number | null;            // native APY on the whole vault, reserve earning nothing
  rewards: number;                 // farm incentives on the whole vault: shown, never added to gross or net
  perfFee: number; mgmtFee: number;
  net: number | null;
  measuring: string[];             // legs without a measured yield
  range: [number, number] | null;  // gross APY at each leg's lowest and highest observed rate
  exitNow: number;                 // share of the vault that could leave now: reserve + exitable legs
  byProtocol: { id: string; name: string; share: number }[];
  byAsset: { sym: string; share: number }[];
  checks: Check[];
  status: Status; statusText: string;
}

export function evaluate(d: StrategyDoc, opps: Opportunity[], kasUsd: number | null): Evaluation {
  const capUsd = kasUsd ? d.vault.capacityKas * kasUsd : null;
  const legs: LegView[] = d.legs.map((leg) => {
    const o = opps.find((x) => x.id === leg.opp) ?? null;
    const share = leg.target / BPS, usdPos = capUsd != null ? capUsd * share : 0;
    const flags: LegView["flags"] = [];
    const paused: PauseRule[] = [];
    if (leg.credit) {
      const c = leg.credit;
      const r = `${(c.rateBps / 100).toFixed(c.rateBps % 100 ? 2 : 0)}%`;
      flags.push({ t: "info", text: `Contract rate ${r} a year, paid by ${c.borrower} (${BORROWER[c.kind].toLowerCase()}). Not a market: dawns cannot read this yield, only the repayments that reach the vault.` });
      flags.push({ t: "warn", text: `Locked for ${c.termDays} days: it counts as nothing towards what can leave today, and a withdrawal beyond the reserve waits for repayment.` });
      flags.push(c.collateral === "secured"
        ? { t: "info", text: `Secured${c.collateralNote ? `: ${c.collateralNote}` : ""}. Collateral is held off-chain under the loan agreement; dawns cannot see it.` }
        : { t: "warn", text: `Unsecured: if ${c.borrower} does not pay, the vault recovers only through the loan agreement.` });
      flags.push({ t: "info", text: c.markdownBps ? `Overdue: after ${c.graceDays} days' grace the loan's mark falls ${(c.markdownBps / 100).toFixed(0)}% every 30 days, so the share price shows a default before it is certain.` : "No markdown schedule: an overdue loan keeps its full mark until someone changes it." });
      if (c.reporting === "self") flags.push({ t: "warn", text: `The loan's standing is reported by ${c.borrower} itself; no third party attests to it.` });
      return { leg, o: null, credit: c, name: `Loan to ${c.borrower}`, where: `${BORROWER[c.kind]} · ${c.termDays} days · ${c.collateral}`, share, cap: leg.cap / BPS, usd: usdPos, apy: c.rateBps / BPS, range: null, exitUsd: 0, cover: null, paused, flags };
    }
    if (!o) {
      flags.push({ t: "crit", text: "This opportunity is no longer listed (under $5K or gone). The leg is idle until it returns." });
      const short = leg.opp.replace(/^([a-z0-9-]+):(?:[a-z]+:)?(0x[0-9a-f]{4})[0-9a-f]{32}([0-9a-f]{4})$/i, "$1 pool $2…$3");
      return { leg, o, name: short, where: "not listed now", share, cap: leg.cap / BPS, usd: usdPos, apy: null, range: null, exitUsd: 0, cover: null, paused, flags };
    }
    // what can leave now: a lending position up to the market's cash; an LP position in full, at the pool price
    const exitUsd = o.kind === "supply" ? Math.min(usdPos, o.exitNow ?? 0) : usdPos;
    const cover = o.kind === "supply" && o.exitNow != null && usdPos > 0 ? o.exitNow / usdPos : null;
    if (d.pause.includes("exit-blocked") && o.status === "crit" && o.kind === "supply") paused.push("exit-blocked");
    if (d.pause.includes("frozen") && o.notes.some((n) => n.startsWith("Frozen"))) paused.push("frozen");
    if (d.pause.includes("oracle") && o.notes.some((n) => /oracle/i.test(n))) paused.push("oracle");
    if (d.pause.includes("volume") && o.turnover != null && o.turnover >= 3) paused.push("volume");
    for (const p of paused) flags.push({ t: "warn", text: `Paused by rule: ${PAUSE[p].label}. ${PAUSE[p].why}` });
    if (o.status === "crit" && !paused.includes("exit-blocked")) flags.push({ t: "crit", text: o.statusText + ": " + (o.notes[0] ?? "") });
    if (cover != null && cover < d.exitCover) flags.push({ t: cover < 1 ? "crit" : "warn", text: `At full capacity this leg would be ${cover < 1 ? "larger than" : `${(1 / cover * 100).toFixed(0)}% of`} the market's withdrawable cash; the rule asks for ${d.exitCover}× cover.` });
    const ofMarket = o.size > 0 && usdPos > 0 ? usdPos / o.size : null;
    if (ofMarket != null && ofMarket > 0.2) flags.push({ t: ofMarket > 0.5 ? "crit" : "warn", text: `At full capacity this leg would be ${(ofMarket * 100).toFixed(0)}% of the ${o.kind === "lp" ? "pool" : "market"} (${o.kind === "lp" ? "pool" : "market"} size today). Its own entry would move the ${o.kind === "lp" ? "price" : "rate"}.` });
    if (o.farm) flags.push(o.farm.on
      ? { t: "info", text: `Farm: ${o.farm.apr != null ? `${(o.farm.apr * 100).toFixed(1)}% a year` : "rewards"} in ${o.farm.reward}, shown but never added to the strategy's yield. The farm's owner can change it at any time; emergency exit costs ${o.farm.emergencyFeeBps / 100}%.` }
      : { t: "warn", text: `Farm rewards are off${o.farm.since ? ` since ${new Date(o.farm.since).toISOString().slice(0, 10)}` : ""}: this leg earns the pool's trading fees only, through one more contract, with a ${o.farm.emergencyFeeBps / 100}% emergency-exit fee.` });
    if (o.kind === "lp") flags.push({ t: "info", text: `Exposed to ${o.assets.join(" and ")} prices${o.ilAtMove != null && o.priceMove != null ? `; the price moved ${(o.priceMove * 100).toFixed(0)}% in dawns' last ${Math.round(o.rangeHours)} h of readings, where an LP trailed holding by ${(o.ilAtMove * 100).toFixed(1)}%` : ""}.` });
    if (o.apy == null) flags.push({ t: "info", text: o.apyBasis });
    return { leg, o, name: o.name, where: `${o.pname} · ${o.kind === "supply" ? "lending" : "liquidity"} · ${o.chain}`, share, cap: leg.cap / BPS, usd: usdPos, apy: o.apy, range: o.apyRange, exitUsd, cover, paused, flags };
  });

  // a paused leg takes no new capital: its weight sits in reserve and earns nothing
  const active = legs.filter((l) => (l.o || l.credit) && !l.paused.length);
  const measured = active.filter((l) => l.apy != null);
  const measuring = active.filter((l) => l.apy == null).map((l) => l.name);
  const gross = active.length && !measured.length ? null : measured.reduce((s, l) => s + l.share * (l.apy ?? 0), 0);
  const lo = measured.reduce((s, l) => s + l.share * (l.range?.[0] ?? l.apy ?? 0), 0);
  const hi = measured.reduce((s, l) => s + l.share * (l.range?.[1] ?? l.apy ?? 0), 0);
  // incentives: what farm legs pay in the protocol's token, shown next to the yield and never added to it
  const rewards = active.reduce((s, l) => s + l.share * (l.o?.farm?.on ? l.o.farm.apr ?? 0 : 0), 0);
  const perfFee = gross != null ? gross * d.fees.performanceBps / BPS : 0;
  const mgmtFee = d.fees.managementBps / BPS;
  const net = gross != null ? gross - perfFee - mgmtFee : null;

  const reserve = d.reserveBps / BPS;
  const exitNow = capUsd ? reserve + legs.reduce((s, l) => s + l.exitUsd, 0) / capUsd : reserve + legs.filter((l) => l.o?.kind === "lp").reduce((s, l) => s + l.share, 0);

  const pmap = new Map<string, { id: string; name: string; share: number }>();
  const amap = new Map<string, number>();
  for (const l of legs) {
    if (l.credit) {
      const p = pmap.get(l.leg.opp) ?? { id: l.leg.opp, name: l.credit.borrower, share: 0 };
      p.share += l.share; pmap.set(l.leg.opp, p);
      amap.set("KAS (lent)", (amap.get("KAS (lent)") ?? 0) + l.share);
      continue;
    }
    if (!l.o) continue;
    const p = pmap.get(l.o.protocol) ?? { id: l.o.protocol, name: l.o.pname, share: 0 };
    p.share += l.share; pmap.set(l.o.protocol, p);
    for (const a of l.o.assets) amap.set(a, (amap.get(a) ?? 0) + l.share / l.o.assets.length);
  }
  const byProtocol = [...pmap.values()].sort((a, b) => b.share - a.share);
  const byAsset = [...amap.entries()].map(([sym, share]) => ({ sym, share })).sort((a, b) => b.share - a.share);

  const topP = byProtocol[0];
  const credit = legs.filter((l) => l.credit);
  const creditShare = credit.reduce((s, l) => s + l.share, 0);
  const checks: Check[] = [
    { key: "slots", ok: d.legs.length <= MAX_LEGS, t: "crit", label: `${d.legs.length} of ${MAX_LEGS} destination slots`, detail: "The NAV covenant has four destinations, each with a hard cap." },
    { key: "sum", ok: d.legs.reduce((s, l) => s + l.target, 0) + d.reserveBps === BPS, t: "crit", label: "Targets and reserve add up to 100%", detail: "Every KAS is either in a leg or in reserve." },
    { key: "listed", ok: legs.every((l) => l.o || l.credit), t: "crit", label: "Every leg is a listed opportunity", detail: "Listed means over $5K and read on-chain in the last snapshot." },
    { key: "protocol", ok: !topP || topP.share * BPS <= d.maxProtocolBps, t: "warn", label: `At most ${(d.maxProtocolBps / 100).toFixed(0)}% in one protocol`, detail: topP ? `${topP.name}: ${(topP.share * 100).toFixed(0)}%.` : "No legs yet." },
    { key: "cover", ok: legs.every((l) => l.cover == null || l.cover >= d.exitCover), t: "warn", label: `Lending legs covered ${d.exitCover}× by withdrawable cash`, detail: capUsd ? "At full capacity, against each market's cash right now." : "Needs a KAS price." },
    { key: "size", ok: legs.every((l) => !l.o || !l.usd || l.usd <= 0.2 * l.o.size), t: "warn", label: "No leg over 20% of its market or pool", detail: capUsd ? "At full capacity, against each market's or pool's size today." : "Needs a KAS price." },
    { key: "open", ok: legs.every((l) => !l.paused.length), t: "warn", label: "No leg paused by its rules right now", detail: legs.filter((l) => l.paused.length).map((l) => l.o?.name).join(", ") || "All legs can take capital." },
    { key: "measured", ok: !measuring.length, t: "info", label: "Every leg has a measured yield", detail: measuring.length ? `Measuring: ${measuring.join(", ")}.` : "From on-chain rates and swap volume." },
    { key: "reserve", ok: d.reserveBps >= 1_000 || d.vault.type === "fixed", t: "warn", label: "Reserve of 10% or more for an open-term vault", detail: "Redemptions are paid from KAS in the vault; the rest waits for a recall." },
    ...(credit.length ? [
      d.vault.type === "fixed"
        ? { key: "credit-term", ok: credit.every((l) => l.credit!.termDays <= d.vault.termDays), t: "crit" as Status, label: "Every loan is due before the vault matures", detail: `Longest loan ${Math.max(...credit.map((l) => l.credit!.termDays))} days; vault term ${d.vault.termDays} days.` }
        : { key: "credit-term", ok: false, t: "warn" as Status, label: "Loans in an open-term vault", detail: `${(creditShare * 100).toFixed(0)}% is lent for up to ${Math.max(...credit.map((l) => l.credit!.termDays))} days: withdrawals beyond the ${(d.reserveBps / 100).toFixed(0)}% reserve wait for repayment. A fixed term matches loans better.` },
      { key: "credit-secured", ok: credit.every((l) => l.credit!.collateral === "secured"), t: "warn" as Status, label: "Every loan is secured", detail: credit.filter((l) => l.credit!.collateral !== "secured").map((l) => l.credit!.borrower).join(", ") || "Collateral held under each loan agreement." },
      { key: "credit-markdown", ok: credit.every((l) => l.credit!.markdownBps > 0), t: "warn" as Status, label: "Overdue loans are marked down on a schedule", detail: "Without one, a default shows only when someone admits it." },
      { key: "credit-attested", ok: credit.every((l) => l.credit!.reporting === "attested"), t: "info" as Status, label: "Loan standing attested by a third party", detail: credit.filter((l) => l.credit!.reporting !== "attested").map((l) => `${l.credit!.borrower}: self-reported`).join(", ") || "Attested." },
    ] : []),
  ];
  const worst = checks.filter((c) => !c.ok).map((c) => c.t);
  const [status, statusText]: [Status, string] = worst.includes("crit") ? ["crit", "Does not hold"] : worst.includes("warn") ? ["warn", "Holds with warnings"] : ["good", "Holds"];

  return { legs, capacityUsd: capUsd, gross, rewards, perfFee, mgmtFee, net, measuring, range: gross != null && legs.length ? [lo, hi] : null,
    exitNow: Math.min(1, exitNow), byProtocol, byAsset, checks, status, statusText };
}

// ---------------------------------------------------------------------------
// where each term is enforced
// ---------------------------------------------------------------------------
export type Enforcer = "covenant" | "keeper" | "monitor" | "trust" | "not yet";
export interface Term { term: string; value: string; by: Enforcer; how: string }

export function enforcement(d: StrategyDoc, ev: Evaluation): Term[] {
  const pctB = (b: number) => `${(b / 100).toFixed(b % 100 ? 1 : 0)}%`;
  const igra = ev.legs.some((l) => l.o?.chain === "igra" || l.o?.chain === "kasplex");
  return [
    ...d.legs.flatMap((l, i): Term[] => l.credit ? [
      { term: `Slot ${i}: loan to ${l.credit.borrower}`, value: `target ${pctB(l.target)}, cap ${pctB(l.cap)}`, by: "not yet", how: "Credit vault covenant (designed, testnet next): only the borrower's registered address can receive, never above the cap, and repayments can only return to the vault." },
      { term: `Repayment by ${l.credit.borrower}`, value: `${pctB(l.credit.rateBps)} a year, ${l.credit.termDays} days`, by: "trust", how: "A loan agreement, off-chain. No contract can make a borrower pay; dawns shows every repayment that reaches the vault and flags a late one." },
      { term: `Markdown if ${l.credit.borrower} is late`, value: l.credit.markdownBps ? `after ${l.credit.graceDays} d, −${pctB(l.credit.markdownBps)} per 30 d` : "none", by: l.credit.markdownBps ? "not yet" : "trust", how: l.credit.markdownBps ? "The credit covenant marks an overdue loan down by this schedule itself, so no valuer can hold a defaulted loan at full value (designed)." : "Without a schedule the mark is whatever the valuer says." },
    ] : [{
      term: `Slot ${i}: ${ev.legs[i]?.o?.name ?? l.opp}`, value: `target ${pctB(l.target)}, cap ${pctB(l.cap)}`,
      by: igra ? "not yet" : "covenant",
      how: igra ? "The covenant caps each destination slot, but a slot is a Kaspa L1 address. Reaching an Igra market needs the bridge payload rule, so today this cap is a plan, not a guard." : "dest and cap in the mandate; allocate refuses anything above the cap.",
    }]),
    { term: "Reserve", value: pctB(d.reserveBps), by: "covenant", how: "reserveFloorBps: an allocation that leaves less in the vault is refused." },
    { term: "Per-protocol limit", value: pctB(d.maxProtocolBps), by: "monitor", how: "dawns checks the split; the covenant sees slots, not protocols." },
    { term: "Exit cover", value: `${d.exitCover}×`, by: "monitor", how: "Checked against each market's withdrawable cash every snapshot." },
    { term: "Pause rules", value: d.pause.map((p) => PAUSE[p].label).join(", ") || "none", by: "monitor", how: "dawns flags the leg; the guardian can halt new allocations, which the covenant enforces." },
    { term: "Live vault terms", value: "fixed at launch", by: "covenant", how: "A vault's mandate is compiled into its address: a new strategy version never changes a running vault. It applies to vaults launched after it takes effect." },
    { term: "Notice before a new version", value: `${d.noticeDays} days`, by: "monitor", how: "dawns lists a new version as current only after the notice; until then the page shows what will change." },
    { term: "Rebalance drift", value: pctB(d.driftBps), by: "keeper", how: "The allocator rebalances when a leg drifts this far; per-move and per-epoch limits bound it." },
    { term: "Exit fee", value: pctB(d.vault.exitFeeBps), by: "covenant", how: "exitFeeBps in redeem; the fee stays with the remaining holders." },
    ...(d.vault.type === "fixed" ? [
      { term: "Maturity", value: `${d.vault.termDays} days`, by: "covenant" as Enforcer, how: "redeem refuses before maturity (a DAA score fixed at launch)." },
      { term: "Deposit window", value: `${d.vault.depositDays} days`, by: "covenant" as Enforcer, how: "deposit refuses after depositUntil." },
    ] : []),
    { term: "Capacity", value: `${d.vault.capacityKas.toLocaleString("en-US")} KAS`, by: "keeper", how: "The keeper stops sweeping deposits at capacity; the covenant has no cap on NAV yet." },
    { term: "Access", value: d.vault.access, by: d.vault.access === "permissionless" ? "covenant" : "not yet", how: d.vault.access === "permissionless" ? "Anyone's account can deposit." : "An allow-list needs an owner check in deposit (next covenant version)." },
    { term: "Performance fee", value: pctB(d.fees.performanceBps), by: "not yet", how: "Charged on yield above the high-water mark by minting shares to the strategist: needs a fee path in the covenant." },
    ...(d.fees.managementBps ? [{ term: "Management fee", value: pctB(d.fees.managementBps), by: "not yet" as Enforcer, how: "Same fee path, charged on time." }] : []),
    { term: "Redemption window", value: d.vault.redemptionDays ? `up to ${d.vault.redemptionDays} days` : "instant from reserve", by: "keeper", how: "Paid from reserve at once; beyond it, within the window after a recall." },
  ];
}

/** The mandate parameters a NAV v1.1 vault would be launched with. Destinations stay empty until each leg has an L1 address. */
export function toMandate(d: StrategyDoc, hash: string) {
  return {
    covenant: "dawns-nav/1.1",
    strategy: hash,
    destinations: d.legs.map((l, i) => ({ slot: i, opportunity: l.opp, capBps: l.cap, address: null as string | null })),
    reserveFloorBps: d.reserveBps,
    exitFeeBps: d.vault.exitFeeBps,
    maturity: d.vault.type === "fixed" ? `launch + ${d.vault.termDays} days` : 0,
    depositUntil: d.vault.type === "fixed" ? `launch + ${d.vault.depositDays} days` : "never closes",
    maxMarkStepBps: 1_000,
  };
}

// ---------------------------------------------------------------------------
// what changes between two versions
// ---------------------------------------------------------------------------
export interface Change { what: string; from: string; to: string; t: "up" | "down" | "neutral" }
export function diffDocs(a: StrategyDoc, b: StrategyDoc, name: (opp: string) => string = (x) => x): Change[] {
  const pctB = (x: number) => `${(x / 100).toFixed(x % 100 ? 1 : 0)}%`;
  const out: Change[] = [];
  const num = (what: string, x: number, y: number, fmt: (n: number) => string, higherIsRiskier = false) => {
    if (x !== y) out.push({ what, from: fmt(x), to: fmt(y), t: (y > x) === higherIsRiskier ? "down" : "up" });
  };
  if (a.name !== b.name) out.push({ what: "Name", from: a.name, to: b.name, t: "neutral" });
  if (a.thesis !== b.thesis) out.push({ what: "Thesis", from: "previous text", to: "rewritten", t: "neutral" });
  for (const l of a.legs) {
    const m = b.legs.find((x) => x.opp === l.opp);
    if (!m) out.push({ what: `Leg removed: ${name(l.opp)}`, from: `${pctB(l.target)} (cap ${pctB(l.cap)})`, to: "—", t: "neutral" });
    else {
      if (m.target !== l.target) out.push({ what: `${name(l.opp)} target`, from: pctB(l.target), to: pctB(m.target), t: "neutral" });
      if (m.cap !== l.cap) out.push({ what: `${name(l.opp)} hard cap`, from: pctB(l.cap), to: pctB(m.cap), t: m.cap > l.cap ? "down" : "up" });
      if (l.credit && m.credit) {
        const a1 = l.credit, b1 = m.credit, who = `Loan to ${b1.borrower}`;
        if (a1.rateBps !== b1.rateBps) out.push({ what: `${who}: rate`, from: pctB(a1.rateBps), to: pctB(b1.rateBps), t: "neutral" });
        if (a1.termDays !== b1.termDays) out.push({ what: `${who}: term`, from: `${a1.termDays} days`, to: `${b1.termDays} days`, t: b1.termDays > a1.termDays ? "down" : "up" });
        if (a1.collateral !== b1.collateral) out.push({ what: `${who}: collateral`, from: a1.collateral, to: b1.collateral, t: b1.collateral === "secured" ? "up" : "down" });
        if (a1.markdownBps !== b1.markdownBps || a1.graceDays !== b1.graceDays) out.push({ what: `${who}: markdown`, from: `${a1.graceDays} d, ${pctB(a1.markdownBps)}`, to: `${b1.graceDays} d, ${pctB(b1.markdownBps)}`, t: b1.markdownBps >= a1.markdownBps && b1.graceDays <= a1.graceDays ? "up" : "down" });
        if (a1.reporting !== b1.reporting) out.push({ what: `${who}: reporting`, from: a1.reporting, to: b1.reporting, t: b1.reporting === "attested" ? "up" : "down" });
      }
    }
  }
  for (const m of b.legs) if (!a.legs.some((l) => l.opp === m.opp)) out.push({ what: `Leg added: ${name(m.opp)}`, from: "—", to: `${pctB(m.target)} (cap ${pctB(m.cap)})`, t: "neutral" });
  num("Reserve", a.reserveBps, b.reserveBps, pctB);
  num("Most in one protocol", a.maxProtocolBps, b.maxProtocolBps, pctB, true);
  num("Lending cash cover", a.exitCover, b.exitCover, (x) => `${x}×`);
  num("Rebalance drift", a.driftBps, b.driftBps, pctB, true);
  for (const p of Object.keys(PAUSE) as PauseRule[]) {
    const x = a.pause.includes(p), y = b.pause.includes(p);
    if (x !== y) out.push({ what: `Pause on ${PAUSE[p].label.toLowerCase()}`, from: x ? "on" : "off", to: y ? "on" : "off", t: y ? "up" : "down" });
  }
  num("Performance fee", a.fees.performanceBps, b.fees.performanceBps, pctB, true);
  num("Management fee", a.fees.managementBps, b.fees.managementBps, pctB, true);
  num("Notice period", a.noticeDays, b.noticeDays, (x) => `${x} days`);
  if (a.vault.type !== b.vault.type) out.push({ what: "Vault type", from: a.vault.type === "fixed" ? "fixed term" : "open term", to: b.vault.type === "fixed" ? "fixed term" : "open term", t: "neutral" });
  if (a.vault.access !== b.vault.access) out.push({ what: "Access", from: a.vault.access, to: b.vault.access, t: "neutral" });
  num("Capacity", a.vault.capacityKas, b.vault.capacityKas, (x) => `${x.toLocaleString("en-US")} KAS`, true);
  num("Exit fee", a.vault.exitFeeBps, b.vault.exitFeeBps, pctB, true);
  num("Term", a.vault.termDays, b.vault.termDays, (x) => (x ? `${x} days` : "open"), true);
  num("Deposit window", a.vault.depositDays, b.vault.depositDays, (x) => (x ? `${x} days` : "—"));
  num("Redemption window", a.vault.redemptionDays, b.vault.redemptionDays, (x) => (x ? `≤ ${x} days` : "from reserve"), true);
  return out;
}

/** How a published strategy can become a vault today (dawns vaults run on Kaspa L1 covenants only). */
export function launchPath(d: StrategyDoc, ev: Evaluation): { kind: "credit" | "nav" | "fixed"; note: string } {
  const loans = d.legs.filter((l) => l.credit).length;
  if (loans && loans === d.legs.length) return { kind: "credit", note: loans <= 3 ? "ready: launch as a credit vault" : "credit vault holds 3 loans at most" };
  const k = d.vault.type === "fixed" ? "fixed" : "nav";
  if (ev.legs.some((l) => l.o?.chain === "igra" || l.o?.chain === "kasplex")) return { kind: k, note: "markets on Igra/Kasplex: dawns vaults run on Kaspa L1" };
  return { kind: k, note: "needs a curator" };
}
