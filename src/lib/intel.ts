import type { Opportunity, Snapshot } from "./types";

/**
 * Intelligence: what moved in the last days, from dawns' own readings every 10 minutes.
 * Pure: `buildIntel` takes the daily rows (read by intel-db.ts) and the current snapshot.
 *
 * Capital flows are measured in quantities, not dollars, so a price move is not mistaken
 * for money arriving or leaving:
 *   lending  (tokens supplied now − tokens supplied then) × today's price
 *   pools    (reserves now − reserves then) × today's token prices
 * Protocols that are neither show their TVL change, which includes price.
 */

const DAY = 86_400_000;

export interface IntelRaw {
  markets: { protocol: string; market: string; day: number; apy: number; supplied: number; cash: number; util: number; qty: number | null }[];
  pools: { protocol: string; pair: string; day: number; usd: number; r0: number; r1: number }[];
  vol: { pair: string; day: number; usd: number; swaps: number }[];
  tvl: { protocol: string; day: number; v: number }[];
  eco: { day: number; v: number; kas: number | null }[];
  volStart: number | null;          // ms: first indexed swap
}

export type Tone = "up" | "down" | "warn" | "calm";
export interface Tag { key: string; text: string; tone: Tone; why: string }

export interface OppIntel {
  id: string;
  apy7: number | null; apy30: number | null; apyDays: number;
  series: number[];                  // daily native yield, oldest first
  apyThen: number | null; apyNow: number | null;
  flow: number | null;               // USD, quantity-based
  exitThen: number | null; exitNow: number | null;   // withdrawable share (lending)
  span: number;                      // days between "then" and now
  tags: Tag[];
}
export interface ProtoFlow { id: string; name: string; letter: string; lending: number; liquidity: number; tvlChange: number | null; tvlNow: number; measured: boolean }
export interface Mover { id: string; name: string; pname: string; assets: string[]; kind: Opportunity["kind"]; value: number; size: number; then: number | null; now: number | null; series: number[] }

export interface Intel {
  asOf: number;
  days: number;                      // days of history dawns holds
  span: number;                      // days the 7-day comparison actually spans
  byOpp: Record<string, OppIntel>;
  flows: { total: number; lending: number; liquidity: number; byProtocol: ProtoFlow[]; into: Mover[]; out: Mover[] };
  yieldUp: Mover[]; yieldDown: Mover[];
  emerging: string[];
  market: {
    dates: number[]; tvl: number[]; volDates: number[]; vol: number[]; utilDates: number[]; util: number[];
    tvlNow: number; tvlThen: number | null; kasNow: number | null; kasThen: number | null;
    vol7: number | null; volPrev7: number | null; volDays: number;
    utilNow: number | null; utilThen: number | null;
  };
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const dayOf = (t: number) => Math.floor(t / DAY) * DAY;

/** The reading about `back` days before today, or the earliest there is. */
function pickThen<T extends { day: number }>(rows: T[], today: number, back = 7): T | null {
  const past = rows.filter((r) => r.day < today);
  if (!past.length) return null;
  const want = today - back * DAY;
  return past.filter((r) => r.day >= want).sort((a, b) => a.day - b.day)[0] ?? past.sort((a, b) => b.day - a.day)[0];
}

export function buildIntel(raw: IntelRaw, s: Snapshot): Intel {
  const today = dayOf(s.asOf);
  const spanOf = (d: number) => Math.max(0, Math.round((s.asOf - (d + DAY / 2)) / DAY * 10) / 10);
  const allDays = [...new Set([...raw.markets.map((m) => m.day), ...raw.pools.map((p) => p.day), ...raw.tvl.map((t) => t.day)])].sort((a, b) => a - b);
  const days = allDays.length;
  const byOpp: Record<string, OppIntel> = {};
  const volStartDay = raw.volStart != null ? dayOf(raw.volStart) + DAY : null;   // the first day is partial

  const group = <T,>(rows: T[], key: (r: T) => string) => {
    const m = new Map<string, T[]>();
    for (const r of rows) { const k = key(r); (m.get(k) ?? m.set(k, []).get(k)!).push(r); }
    for (const v of m.values()) (v as { day: number }[]).sort((a, b) => a.day - b.day);
    return m;
  };
  const mk = group(raw.markets, (r) => `${r.protocol}:${r.market}`);
  const pl = group(raw.pools, (r) => `${r.protocol}:${r.pair.toLowerCase()}`);
  const vl = group(raw.vol, (r) => r.pair.toLowerCase());

  /* ---- per market: yield, flow, exit ---- */
  const protoLend = new Map<string, number>();
  const marketFlow = new Map<string, { flow: number; size: number }>();
  for (const p of s.protocols) for (const m of p.lending?.markets ?? []) {
    const rows = mk.get(`${p.id}:${m.symbol}`) ?? [];
    const then = pickThen(rows.filter((r) => r.qty != null), today);
    const px = m.suppliedUsd && m.supplied ? m.suppliedUsd / m.supplied : m.price;
    const flow = then && then.qty != null ? (m.supplied - then.qty) * px : null;
    if (flow != null) protoLend.set(p.id, (protoLend.get(p.id) ?? 0) + flow);
    const id = `${p.id}:${m.symbol}`;
    const series = rows.map((r) => r.apy);
    const thenY = pickThen(rows, today);
    const near = thenY ? rows.filter((r) => Math.abs(r.day - thenY.day) <= DAY) : [];
    const exitNow = m.suppliedUsd ? Math.min(1, m.cashUsd / m.suppliedUsd) : null;
    const exitThen = thenY && thenY.supplied ? Math.min(1, thenY.cash / thenY.supplied) : null;
    byOpp[id] = finish({
      id, apy7: mean(series.slice(-7)), apy30: mean(series.slice(-30)), apyDays: series.length, series,
      apyThen: mean(near.map((r) => r.apy)), apyNow: mean(series.slice(-2).concat([m.supplyApy])),
      flow, exitThen, exitNow, span: thenY ? spanOf(thenY.day) : 0, tags: [],
    }, m.suppliedUsd, "supply");
    if (flow != null) marketFlow.set(id, { flow, size: m.suppliedUsd });
  }

  /* ---- per pool: fee yield by day, flow ---- */
  const protoLiq = new Map<string, number>();
  for (const p of s.protocols) for (const pool of p.dex?.pools ?? []) {
    const key = pool.pair.toLowerCase();
    const id = `${p.id}:${key}`;
    const rows = pl.get(id) ?? [];
    const feeRate = pool.kind === "v3" ? (pool.fee != null ? pool.fee / 1e6 : null) : p.dex!.feeRate;
    const lpShare = pool.lpShare ?? p.dex!.lpShare ?? 1;
    const volByDay = new Map((vl.get(key) ?? []).map((v) => [v.day, v.usd]));
    const daily = feeRate == null || volStartDay == null ? [] : rows
      .filter((r) => r.day >= volStartDay && r.day < today && r.usd > 0)
      .map((r) => ({ day: r.day, apy: ((volByDay.get(r.day) ?? 0) * feeRate * lpShare * 365) / r.usd }));
    const series = daily.map((d) => d.apy);
    // flow at today's token prices; a side without a price falls back to half the pool's value
    const px0 = pool.tk[0].px ?? (pool.reserves[0] ? pool.usd / 2 / pool.reserves[0] : 0);
    const px1 = pool.tk[1].px ?? (pool.reserves[1] ? pool.usd / 2 / pool.reserves[1] : 0);
    const then = pickThen(rows, today);
    const flow = then ? (pool.reserves[0] - then.r0) * px0 + (pool.reserves[1] - then.r1) * px1 : null;
    if (flow != null) protoLiq.set(p.id, (protoLiq.get(p.id) ?? 0) + flow);
    const thenY = pickThen(daily, today);
    const near = thenY ? daily.filter((r) => Math.abs(r.day - thenY.day) <= DAY) : [];
    byOpp[id] = finish({
      id, apy7: mean(series.slice(-7)), apy30: mean(series.slice(-30)), apyDays: series.length, series,
      apyThen: near.length ? mean(near.map((r) => r.apy)) : null, apyNow: mean(series.slice(-3)),
      flow, exitThen: null, exitNow: null, span: then ? spanOf(then.day) : 0, tags: [],
    }, pool.usd, "lp");
  }
  for (const o of s.opportunities) if (o.farm) { const lp = byOpp[`${o.protocol}:${o.pair?.toLowerCase()}`]; if (lp) byOpp[o.id] = { ...lp, id: o.id }; }

  /* ---- protocols ---- */
  const tv = group(raw.tvl, (r) => r.protocol);
  const byProtocol: ProtoFlow[] = s.protocols.map((p) => {
    const then = pickThen(tv.get(p.id) ?? [], today);
    const measured = protoLend.has(p.id) || protoLiq.has(p.id);
    return { id: p.id, name: p.name, letter: p.letter, lending: protoLend.get(p.id) ?? 0, liquidity: protoLiq.get(p.id) ?? 0, tvlChange: then ? p.tvl - then.v : null, tvlNow: p.tvl, measured };
  }).filter((x) => Math.abs(x.measured ? x.lending + x.liquidity : x.tvlChange ?? 0) >= 50)
    .sort((a, b) => Math.abs(b.measured ? b.lending + b.liquidity : b.tvlChange ?? 0) - Math.abs(a.measured ? a.lending + a.liquidity : a.tvlChange ?? 0));
  const lending = [...protoLend.values()].reduce((a, b) => a + b, 0);
  const liquidity = [...protoLiq.values()].reduce((a, b) => a + b, 0);

  /* ---- movers among listed opportunities (farms are the same pool) ---- */
  const opps = s.opportunities.filter((o) => !o.farm);
  const mover = (o: Opportunity, value: number): Mover => { const x = byOpp[o.id]; return { id: o.id, name: o.name, pname: o.pname, assets: o.assets, kind: o.kind, value, size: o.size, then: x?.apyThen ?? null, now: x?.apyNow ?? null, series: x?.series ?? [] }; };
  const withFlow = opps.filter((o) => byOpp[o.id]?.flow != null && Math.abs(byOpp[o.id].flow!) >= 500);
  const into = withFlow.filter((o) => byOpp[o.id].flow! > 0).sort((a, b) => byOpp[b.id].flow! - byOpp[a.id].flow!).slice(0, 6).map((o) => mover(o, byOpp[o.id].flow!));
  const out = withFlow.filter((o) => byOpp[o.id].flow! < 0).sort((a, b) => byOpp[a.id].flow! - byOpp[b.id].flow!).slice(0, 6).map((o) => mover(o, byOpp[o.id].flow!));
  const dy = (o: Opportunity) => { const x = byOpp[o.id]; return x?.apyThen != null && x.apyNow != null ? x.apyNow - x.apyThen : null; };
  const moved = opps.filter((o) => byOpp[o.id]?.tags.some((t) => t.key === "yield-up" || t.key === "yield-down"));
  const yieldUp = moved.filter((o) => dy(o)! > 0).sort((a, b) => dy(b)! - dy(a)!).slice(0, 6).map((o) => mover(o, dy(o)!));
  const yieldDown = moved.filter((o) => dy(o)! < 0).sort((a, b) => dy(a)! - dy(b)!).slice(0, 6).map((o) => mover(o, dy(o)!));
  const emerging = opps.filter((o) => {
    const t = byOpp[o.id]?.tags.map((x) => x.key) ?? [];
    return o.status === "good" && t.includes("yield-up") && !t.includes("out") && !t.includes("exit-tight") && (o.apy ?? 0) >= 0.005;
  }).sort((a, b) => dy(b)! - dy(a)!).map((o) => o.id);

  /* ---- the market as a whole ---- */
  const eco = raw.eco.filter((r) => r.day < today);
  const ecoThen = pickThen(raw.eco, today);
  const vByDay = new Map<number, number>();
  for (const v of raw.vol) if (volStartDay != null && v.day >= volStartDay && v.day < today) vByDay.set(v.day, (vByDay.get(v.day) ?? 0) + v.usd);
  const vd = [...vByDay.entries()].sort((a, b) => a[0] - b[0]);
  const last7 = vd.slice(-7), prev7 = vd.slice(-14, -7);
  const uByDay = new Map<number, { s: number; b: number }>();
  for (const m of raw.markets) { const u = uByDay.get(m.day) ?? { s: 0, b: 0 }; u.s += m.supplied; u.b += m.supplied * m.util; uByDay.set(m.day, u); }
  const ud = [...uByDay.entries()].filter(([, u]) => u.s > 0).sort((a, b) => a[0] - b[0]);
  const lend = s.protocols.flatMap((p) => p.lending?.markets ?? []);
  const supNow = lend.reduce((a, m) => a + m.suppliedUsd, 0);
  const utilThenRow = pickThen(ud.map(([day, u]) => ({ day, v: u.b / u.s })), today);

  return {
    asOf: s.asOf, days, span: Math.max(0, ...Object.values(byOpp).map((x) => x.span)),
    byOpp,
    flows: { total: lending + liquidity, lending, liquidity, byProtocol, into, out },
    yieldUp, yieldDown, emerging,
    market: {
      dates: [...eco.map((r) => r.day), s.asOf], tvl: [...eco.map((r) => r.v), s.eco.tvl],
      volDates: vd.map(([d]) => d), vol: vd.map(([, v]) => v),
      utilDates: ud.map(([d]) => d), util: ud.map(([, u]) => u.b / u.s),
      tvlNow: s.eco.tvl, tvlThen: ecoThen?.v ?? null, kasNow: s.kasUsd, kasThen: ecoThen?.kas ?? null,
      vol7: last7.length ? last7.reduce((a, [, v]) => a + v, 0) : null,
      volPrev7: prev7.length === 7 ? prev7.reduce((a, [, v]) => a + v, 0) : null, volDays: last7.length,
      utilNow: supNow ? lend.reduce((a, m) => a + m.borrowedUsd, 0) / supNow : null, utilThen: utilThenRow?.v ?? null,
    },
  };
}

/** The "Dawns view": plain tags, each from one measured change. Never a score. */
function finish(x: OppIntel, size: number, kind: Opportunity["kind"]): OppIntel {
  const tags: Tag[] = [];
  const d = x.span >= 1.5 ? `${Math.round(x.span)} days` : null;
  if (d && x.apyThen != null && x.apyNow != null) {
    const ch = x.apyNow - x.apyThen;
    const rel = x.apyThen > 0 ? ch / x.apyThen : ch > 0 ? Infinity : 0;
    const f = (v: number) => `${(v * 100).toFixed(v < 0.1 ? 2 : 1)}%`;
    if (Math.abs(ch) >= 0.0025 && Math.abs(rel) >= 0.15)
      tags.push(ch > 0 ? { key: "yield-up", text: "Yield rising", tone: "up", why: `${f(x.apyThen)} → ${f(x.apyNow)} in ${d}` }
        : { key: "yield-down", text: "Yield falling", tone: "down", why: `${f(x.apyThen)} → ${f(x.apyNow)} in ${d}` });
  }
  if (d && x.flow != null && size > 0 && Math.abs(x.flow) >= 1000 && Math.abs(x.flow) >= 0.1 * size) {
    const k = Math.abs(x.flow) >= 1e6 ? `$${(Math.abs(x.flow) / 1e6).toFixed(1)}M` : `$${(Math.abs(x.flow) / 1e3).toFixed(0)}K`;
    tags.push(x.flow > 0 ? { key: "in", text: "Capital arriving", tone: "up", why: `${k} ${kind === "supply" ? "supplied" : "added"} in ${d}, at today's prices` }
      : { key: "out", text: "Capital leaving", tone: "down", why: `${k} ${kind === "supply" ? "withdrawn" : "removed"} in ${d}, at today's prices` });
  }
  if (d && x.exitThen != null && x.exitNow != null && Math.abs(x.exitNow - x.exitThen) >= 0.1) {
    const f = (v: number) => `${Math.round(v * 100)}%`;
    tags.push(x.exitNow < x.exitThen ? { key: "exit-tight", text: "Exit tightening", tone: "warn", why: `Withdrawable ${f(x.exitThen)} → ${f(x.exitNow)} of the market in ${d}` }
      : { key: "exit-open", text: "Exit easing", tone: "up", why: `Withdrawable ${f(x.exitThen)} → ${f(x.exitNow)} of the market in ${d}` });
  }
  if (!tags.length) tags.push(d ? { key: "steady", text: "Steady", tone: "calm", why: `No change in yield, capital or exit above dawns' thresholds in ${d}` }
    : { key: "new", text: "Measuring", tone: "calm", why: "Less than two days of dawns readings" });
  return { ...x, tags };
}
