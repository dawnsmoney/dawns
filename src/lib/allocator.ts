import type { Opportunity } from "./types";

/**
 * Advisory allocator. Turns a simple policy into a split across live opportunities.
 * Pure and deterministic: the same opportunities and policy always give the same plan.
 * It never moves funds.
 */
export type Risk = "low" | "medium" | "high";
export type ExitNeed = "instant" | "days" | "weeks";
export type Avoid = "lp" | "lending" | "v3";
export interface Policy { risk: Risk; exit: ExitNeed; amount: number; avoid: Avoid[] }

export const DEFAULT_POLICY: Policy = { risk: "medium", exit: "days", amount: 10_000, avoid: [] };

export function parsePolicy(x: unknown): Policy | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  const risk = ["low", "medium", "high"].includes(String(o.risk)) ? (o.risk as Risk) : null;
  const exit = ["instant", "days", "weeks"].includes(String(o.exit)) ? (o.exit as ExitNeed) : null;
  const amount = Number(o.amount);
  const avoid = Array.isArray(o.avoid) ? (o.avoid.filter((a) => ["lp", "lending", "v3"].includes(String(a))) as Avoid[]) : [];
  if (!risk || !exit || !Number.isFinite(amount) || amount < 100 || amount > 1e9) return null;
  return { risk, exit, amount: Math.round(amount), avoid: [...new Set(avoid)] };
}

/** A plan the user chose to follow: what dawns watches for them. */
export interface FollowedLine { id: string; protocol: string; name: string; kind: "supply" | "lp"; usd: number; apy: number }
export interface FollowedPlan { at: string; lines: FollowedLine[] }
export function parseFollowed(x: unknown): FollowedPlan | null {
  if (!x || typeof x !== "object") return null;
  const lines = (x as { lines?: unknown }).lines;
  if (!Array.isArray(lines) || lines.length > 20) return null;
  const ok = lines.every((l) => l && typeof l.id === "string" && l.id.length < 200 && typeof l.protocol === "string" && typeof l.name === "string" && (l.kind === "supply" || l.kind === "lp") && Number.isFinite(l.usd) && Number.isFinite(l.apy));
  if (!ok) return null;
  return { at: new Date().toISOString(), lines: lines.map((l) => ({ id: l.id, protocol: l.protocol, name: String(l.name).slice(0, 80), kind: l.kind, usd: Math.round(l.usd), apy: Number(l.apy) })) };
}

export interface PlanLine { id: string; name: string; pname: string; protocol: string; kind: Opportunity["kind"]; assets: string[]; apy: number; usd: number; share: number; why: string; exit: string }
export interface Plan {
  lines: PlanLine[];
  cash: { usd: number; share: number; why: string } | null;
  excluded: { name: string; pname: string; why: string }[];
  blended: number;        // yield on the whole amount, cash included
  notes: string[];
}

const STABLE = /^(usdc|usdt|usd₮|usdt0|usdc\.e|dai)$/i;
const isStable = (a: string) => STABLE.test(a);
const KAS = /^(w?i?kas|wikas|ikas|wkas)$/i;
const isCore = (a: string) => STABLE.test(a) || KAS.test(a);
/** Most of the amount that may sit in liquidity pools, by exit window: what you get back depends on the pool price. */
const LP_MAX: Record<ExitNeed, number> = { instant: 0.3, days: 0.6, weeks: 1 };
const pctS = (x: number, d = 1) => `${(x * 100).toFixed(d)}%`;
const usdS = (x: number) => (x >= 1e6 ? `$${(x / 1e6).toFixed(2)}M` : x >= 1e3 ? `$${(x / 1e3).toFixed(1)}K` : `$${Math.round(x)}`);

const CAPS: Record<Risk, { perLine: number; perProtocol: number; poolShare: number; maxLines: number }> = {
  low: { perLine: 0.5, perProtocol: 0.6, poolShare: 0.05, maxLines: 4 },
  medium: { perLine: 0.35, perProtocol: 0.5, poolShare: 0.1, maxLines: 6 },
  high: { perLine: 0.5, perProtocol: 0.7, poolShare: 0.15, maxLines: 6 },
};
/** How many times the position the market's withdrawable cash must cover. */
export const EXIT_COVER: Record<ExitNeed, number> = { instant: 3, days: 1.5, weeks: 1 };

export function allocate(opps: Opportunity[], p: Policy): Plan {
  const caps = CAPS[p.risk];
  const excluded: Plan["excluded"] = [];
  const out = (o: Opportunity, why: string) => excluded.push({ name: o.name, pname: o.pname, why });

  type C = { o: Opportunity; score: number; cap: number };
  const cands: C[] = [];
  for (const o of opps) {
    if (o.status === "crit") { out(o, "Exit blocked: suppliers cannot withdraw now"); continue; }
    if (o.notes.some((n) => n.startsWith("Frozen"))) { out(o, "Frozen: not accepting deposits"); continue; }
    if (o.apy == null) { out(o, "Yield not measured yet"); continue; }
    if (o.apy < 0.005) { out(o, `Pays ${pctS(o.apy, 2)}: not worth the risk`); continue; }
    if (o.kind === "lp" && p.avoid.includes("lp")) { out(o, "You chose to avoid providing liquidity"); continue; }
    if (o.kind === "supply" && p.avoid.includes("lending")) { out(o, "You chose to avoid lending"); continue; }
    if (o.kind === "lp" && p.avoid.includes("v3") && o.notes.some((n) => n.startsWith("Concentrated"))) { out(o, "You chose to avoid concentrated liquidity"); continue; }
    const allStable = o.assets.every(isStable);
    if (p.risk === "low" && !allStable) { out(o, "Low risk: stablecoins only"); continue; }
    if (p.risk === "medium" && o.kind === "lp" && ((o.ilAtMove ?? 0) >= 0.05 || (o.turnover ?? 0) >= 3 || o.status !== "good")) { out(o, o.status !== "good" ? `Medium risk: marked "${o.statusText}"` : "Medium risk: price swings too large for this pool"); continue; }
    if (p.exit === "instant" && o.kind === "lp" && !o.assets.every(isCore)) { out(o, "You may need the money at any moment: only pools of KAS and stablecoins"); continue; }
    if (p.exit === "instant" && o.status === "warn" && o.kind === "supply") { out(o, "You need instant exits and this market is tight"); continue; }

    // how much of the amount this line can take
    let cap = Math.min(caps.perLine * p.amount, caps.poolShare * o.size);
    if (o.kind === "supply" && o.exitNow != null) cap = Math.min(cap, o.exitNow / EXIT_COVER[p.exit]);
    if (cap < Math.max(50, p.amount * 0.02)) { out(o, o.kind === "supply" ? `Only ${usdS(o.exitNow ?? 0)} can be withdrawn: too little room for your exit need` : "Pool too small for a meaningful position"); continue; }

    // yield after an allowance for price exposure and warnings
    const lpCost = o.kind === "lp" ? 2 * (o.ilAtMove ?? 0.02) : 0;
    const score = o.apy - lpCost - (o.status === "warn" ? 0.02 : 0);
    if (score <= 0) { out(o, "Price exposure outweighs the fee yield"); continue; }
    cands.push({ o, score, cap });
  }

  // best risk-adjusted yields first; fill each up to its caps, respecting a per-protocol cap
  const picked = cands.sort((a, b) => b.score - a.score).slice(0, caps.maxLines);
  for (const c of cands.slice(caps.maxLines)) out(c.o, "Better options within your rules take the room");
  const byProtocol = new Map<string, number>();
  const lines: PlanLine[] = [];
  let left = p.amount;
  // weights ∝ score, filled in rounds so capped lines hand their room to the others
  const alloc = new Map<string, number>();
  for (let round = 0; round < 8 && left > 1; round++) {
    const lpUsed = picked.filter((c) => c.o.kind === "lp").reduce((s, c) => s + (alloc.get(c.o.id) ?? 0), 0);
    const lpRoom = LP_MAX[p.exit] * p.amount - lpUsed;
    const open = picked.filter((c) => (alloc.get(c.o.id) ?? 0) < c.cap - 0.5 && (byProtocol.get(c.o.protocol) ?? 0) < caps.perProtocol * p.amount - 0.5 && (c.o.kind !== "lp" || lpRoom > 0.5));
    const wsum = open.reduce((s, c) => s + c.score, 0);
    if (!open.length || wsum <= 0) break;
    let used = 0;
    const lpWant = open.filter((c) => c.o.kind === "lp").reduce((s, c) => s + (left * c.score) / wsum, 0);
    const lpScale = lpWant > lpRoom ? lpRoom / lpWant : 1;
    for (const c of open) {
      const want = ((left * c.score) / wsum) * (c.o.kind === "lp" ? lpScale : 1);
      const room = Math.min(c.cap - (alloc.get(c.o.id) ?? 0), caps.perProtocol * p.amount - (byProtocol.get(c.o.protocol) ?? 0));
      const give = Math.max(0, Math.min(want, room));
      alloc.set(c.o.id, (alloc.get(c.o.id) ?? 0) + give);
      byProtocol.set(c.o.protocol, (byProtocol.get(c.o.protocol) ?? 0) + give);
      used += give;
    }
    left -= used;
    if (used < 1) break;
  }
  for (const c of picked) {
    const usd = Math.floor(alloc.get(c.o.id) ?? 0);
    if (usd < 1) continue;
    const o = c.o;
    const why = o.kind === "supply"
      ? `${pctS(o.apy!)} paid by borrowers. ${usdS(o.exitNow ?? 0)} can be withdrawn now, ${((o.exitNow ?? 0) / usd).toFixed(1)}× this position.`
      : `${pctS(o.apy!)} from trading fees (${o.apyBasis}). ${o.ilAtMove != null ? `Recent price swings would cost about ${pctS(o.ilAtMove)} against holding.` : "Price swing history is still short."}`;
    const exit = o.kind === "supply" ? `Withdraw any time while cash is available (${o.exitShare != null ? pctS(o.exitShare, 0) : "?"} of the market now)` : "Withdraw any time, at the pool's price";
    lines.push({ id: o.id, name: o.name, pname: o.pname, protocol: o.protocol, kind: o.kind, assets: o.assets, apy: o.apy!, usd, share: usd / p.amount, why, exit });
  }
  lines.sort((a, b) => b.usd - a.usd);
  const placed = lines.reduce((s, l) => s + l.usd, 0);
  const cashUsd = p.amount - placed;
  const cash = cashUsd >= 1 ? { usd: cashUsd, share: cashUsd / p.amount, why: lines.length ? `Kaspa DeFi is still small: within your rules only ${usdS(placed)} fits without owning too much of a pool or market, or crowding its exit.` : "Nothing in Kaspa DeFi fits your rules right now. Keeping it in your wallet is the safe choice." } : null;
  const blended = lines.reduce((s, l) => s + l.usd * l.apy, 0) / p.amount;

  const notes = [
    `At most ${pctS(caps.perProtocol, 0)} in any one protocol and ${pctS(caps.perLine, 0)} in any one position.`,
    `No position is larger than ${pctS(caps.poolShare, 0)} of its pool or market, so you can leave without moving the price.`,
    ...(LP_MAX[p.exit] < 1 ? [`At most ${pctS(LP_MAX[p.exit], 0)} in liquidity pools: what you get back from a pool depends on its price when you leave.`] : []),
    p.exit === "instant" ? "Lending markets must hold at least 3× your position in withdrawable cash. Pools only if both tokens are KAS or stablecoins." : p.exit === "days" ? "Lending markets must hold at least 1.5× your position in withdrawable cash." : "Lending markets must hold at least your position in withdrawable cash.",
    "Yields are native only (borrowers and traders). Token incentives are not counted.",
  ];
  return { lines, cash, excluded, blended, notes };
}
