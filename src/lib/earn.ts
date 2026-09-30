import type { Opportunity, Snapshot } from "./types";
import type { Intel, Tag } from "./intel";

/**
 * dawns Earn: the opportunities dawns already reads, sorted for someone who holds one
 * asset and knows how soon they may need it back. Nothing here is a score: an option
 * is listed or not by plain rules, and every exclusion says why.
 */

export type Have = "kas" | "usdc" | "usdt";
export type Win = "any" | "days" | "lock";

export const HAVES: { key: Have; label: string; match: (sym: string) => boolean }[] = [
  { key: "kas", label: "KAS", match: (s) => /^(w?i?kas|wkas|ikas|kas)$/i.test(s) },
  { key: "usdc", label: "USDC", match: (s) => /^usdc(\.e)?$/i.test(s) },
  { key: "usdt", label: "USDT", match: (s) => /^usdt$/i.test(s) },
];
export const WINS: { key: Win; label: string; short: string }[] = [
  { key: "any", label: "Any time", short: "any time" },
  { key: "days", label: "Within days", short: "within days" },
  { key: "lock", label: "I can lock it", short: "after a lock" },
];
export const isHave = (x: unknown): x is Have => HAVES.some((h) => h.key === x);
export const isWin = (x: unknown): x is Win => WINS.some((w) => w.key === x);

/** Share of a lending market that must be withdrawable for each window. */
const EXIT_FLOOR: Record<Win, number> = { any: 0.25, days: 0.05, lock: 0 };
const DAY = 86_400;

export interface Line { head: string; sub: string }
export interface EarnOption {
  id: string; href: string; kind: Opportunity["kind"];
  name: string; pname: string; chain: Opportunity["chain"]; assets: string[];
  apy: number | null; source: string;
  incentive: { apr: number; reward: string } | null;
  tags: Tag[];
  leave: Line; risk: Line;
}
export interface Excluded { id: string; href: string; name: string; pname: string; apy: number | null; why: string }

const pct = (x: number, d = 1) => `${(x * 100).toFixed(d)}%`;
const usd = (v: number) => { const a = Math.abs(v); return `$${a >= 1e6 ? `${(a / 1e6).toFixed(1)}M` : a >= 1e3 ? `${(a / 1e3).toFixed(1)}K` : a.toFixed(0)}`; };
const days = (sec: number) => (sec >= 2 * DAY ? `${Math.round(sec / DAY)} days` : `${Math.round(sec / 3600)} hours`);
export const earnName = (o: Opportunity) => o.name.replace(/ liquidity$/, " pool");
export const earnHref = (id: string) => `/earn/${encodeURIComponent(id)}`;
const concentrated = (o: Opportunity) => o.notes.some((n) => /concentrated/i.test(n)) || /-v3:/i.test(o.id);
const frozen = (o: Opportunity) => o.notes.some((n) => /^frozen/i.test(n)) || /frozen/i.test(o.statusText);

export function lines(o: Opportunity, have: Have, tags: Tag[]): { leave: Line; risk: Line } {
  const h = HAVES.find((x) => x.key === have)!;
  if (o.kind === "supply") {
    const sh = o.exitShare ?? 0;
    const leave: Line = sh >= 0.9
      ? { head: "Any time", sub: `${o.exitNow != null ? usd(o.exitNow) : "Most of it"} could be withdrawn now, with interest.` }
      : { head: `${pct(sh, 0)} could leave today`, sub: `${o.exitNow != null ? usd(o.exitNow) : "Part"} is withdrawable now; the rest comes back as borrowers repay.` };
    const worst = o.notes.find((n) => !/^Yield:|incentives/i.test(n));
    const risk: Line = { head: "Lent to borrowers", sub: `Your ${o.assets[0]} is lent out at interest; withdrawals need cash in the market.${worst ? ` ${worst}` : ""}` };
    return { leave, risk };
  }
  const other = o.assets.find((a) => !h.match(a)) ?? o.assets[1] ?? o.assets[0];
  const lock = o.farm?.lockSec ?? 0;
  const leave: Line = lock > 0
    ? { head: `After ${days(lock)} staked`, sub: `Leaving early costs ${(o.farm!.emergencyFeeBps / 100).toFixed(1)}% of the staked LP.` }
    : { head: "Any time, at the pool price", sub: `${usd(o.size)} in the pool${o.vol24 != null ? `; ${usd(o.vol24)} traded in the last 24 hours` : ""}.` };
  const leaving = tags.find((t) => t.key === "out");
  let risk: Line;
  if (concentrated(o)) risk = { head: "Earns only in range", sub: "Concentrated liquidity: if the price leaves your range, fees stop until you move it." };
  else risk = {
    head: `Half becomes ${other}`,
    sub: o.priceMove != null
      ? `${other} moved ${pct(o.priceMove, 0)} within 7 days${o.ilAtMove != null ? `; an LP trailed simply holding by ${pct(o.ilAtMove, 1)}` : ""}.`
      : `Your deposit follows the price of ${other} as well as ${h.label}.`,
  };
  if (leaving) risk = { ...risk, sub: `${risk.sub} Capital leaving: ${leaving.why}.` };
  return { leave, risk };
}

/** The options for an asset and an exit window, and what was left out and why. */
export function earnFor(s: Snapshot, intel: Intel | null, have: Have, win: Win): { options: EarnOption[]; excluded: Excluded[] } {
  const h = HAVES.find((x) => x.key === have)!;
  const options: EarnOption[] = [], excluded: Excluded[] = [];
  for (const o of s.opportunities) {
    if (!o.assets.some(h.match)) continue;
    const tags = intel?.byOpp[o.id]?.tags.filter((t) => t.key !== "new") ?? [];
    const x = { id: o.id, href: earnHref(o.id), name: earnName(o), pname: o.pname, apy: o.apy };
    if (o.kind === "supply" && frozen(o)) { excluded.push({ ...x, why: `Frozen: ${o.pname} accepts no new deposits.${o.notes.filter((n) => !/^frozen/i.test(n))[0] ? ` ${o.notes.filter((n) => !/^frozen/i.test(n))[0]}` : ""}` }); continue; }
    if (o.kind === "supply" && (o.exitShare ?? 0) < EXIT_FLOOR[win]) {
      excluded.push({ ...x, why: `Only ${pct(o.exitShare ?? 0, 1)} of what suppliers put in could leave today: the rate is high because the cash is lent out.` });
      continue;
    }
    if (o.farm && !o.farm.on) { excluded.push({ ...x, why: `The farm's ${o.farm.reward} rewards have stopped.` }); continue; }
    if (o.farm && o.farm.lockSec > 0 && (win === "any" || (win === "days" && o.farm.lockSec > 7 * DAY))) {
      excluded.push({ ...x, why: `Staked LP is locked for ${days(o.farm.lockSec)}.` });
      continue;
    }
    if (o.apy == null && !o.farm) { excluded.push({ ...x, why: "dawns has not measured a yield here yet (it needs a full day of swaps)." }); continue; }
    const { leave, risk } = lines(o, have, tags);
    options.push({
      ...x, kind: o.kind, chain: o.chain, assets: o.assets, source: o.apyShort,
      incentive: o.farm?.on && o.farm.apr != null ? { apr: o.farm.apr, reward: o.farm.reward } : null,
      tags, leave, risk,
    });
  }
  options.sort((a, b) => (b.apy ?? -1) - (a.apy ?? -1));
  return { options, excluded };
}
