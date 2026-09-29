import "server-only";
import type { Opportunity, Snapshot, Status } from "./types";
import type { Asset } from "./assets/types";
import { CHAIN_NAME, STANDARD_NAME, assetPath, valueCredible } from "./assets/types";
import { analyse, dimensions } from "./assets/analysis";
import { significant } from "./assets/view";
import { getAssets } from "./assets";
import { sql, getMeta, setMeta } from "./db";
import { usd, pct } from "./format";
import { buildIntel } from "./intel";
import { getIntelRaw } from "./intel-db";

/**
 * Share cards: a 1200×630 image of one asset or opportunity reading, for X and Telegram.
 * Drafts are picked once a day by a fixed rule (or made on demand in /admin/cards). Their
 * numbers are frozen when drafted, so what you review is what gets posted. Nothing is
 * published until an admin approves it.
 */
export type CardKind = "asset" | "opp" | "count" | "plan" | "week";
export interface CardTile { title: string; big: string; small: string; t: Status }
export interface CardData {
  kind: CardKind; ref: string;
  kicker: string;                // "DAWNS READING" | "OPPORTUNITY"
  title: string; sub: string;
  tiles: CardTile[];             // up to 4
  grade: { t: Status; label: string };
  path: string;                  // the page the card points to
  asOf: number;                  // ms: when the numbers were read
  block: number | null;          // Igra block of the snapshot
  foot: string;
  lead?: string;                 // left of the footer (default: "Every number traceable on-chain")
  readingLabel?: string;         // default "WHAT WE FOUND"
  /** post text for X / Telegram; {reading} and {url} are filled in when copied */
  caption?: string;
}
export interface CardDraft { id: string; day: string; kind: CardKind; ref: string; data: CardData; reading: string; status: "draft" | "approved" | "skipped" | "sent"; origin: string; updated_at: string; sent_at: string | null }

const RANK: Record<Status, number> = { crit: 0, warn: 1, info: 2, good: 3 };
const MAX_READING = 300;

/** Up to two findings, most serious first, short enough for the card. */
function joinFindings(lines: string[]): string {
  let out = "";
  for (const l of lines) {
    const next = out ? `${out} ${l}` : l;
    if (next.length > MAX_READING) break;
    out = next;
    if (out.length > MAX_READING * 0.55) break;
  }
  return out || (lines[0] ?? "").slice(0, MAX_READING);
}

export function assetCard(a: Asset, s: Snapshot): { data: CardData; reading: string } {
  const r = analyse(a);
  const tiles = dimensions(a, r).slice(0, 4).map(({ title, big, small, t }) => ({ title, big, small, t }));
  const flags = [...r.flags].sort((x, y) => RANK[x[0]] - RANK[y[0]]).map((f) => f[1]);
  return {
    data: {
      kind: "asset", ref: a.id, kicker: "DAWNS READING", title: a.symbol, sub: `${STANDARD_NAME[a.standard]} · ${CHAIN_NAME[a.chain]}`,
      tiles, grade: r.grade, path: assetPath(a.id), asOf: s.asOf, block: s.blocks.igra?.block ?? null,
      foot: "Research, not advice",
      caption: `DAWNS READING · ${a.symbol}\n\n{reading}\n\nFull profile, every number traceable: {url}\nResearch, not advice.`,
    },
    reading: joinFindings(flags),
  };
}

export function oppCard(o: Opportunity, s: Snapshot): { data: CardData; reading: string } {
  const tiles: CardTile[] = [
    { title: "Native yield", big: o.apy != null ? pct(o.apy) : "Measuring", small: o.apyShort, t: o.apy != null ? "good" : "info" },
    { title: o.kind === "lp" ? "In the pool" : "Supplied", big: usd(o.size), small: o.kind === "lp" ? "value of both sides" : "in the market", t: "info" },
  ];
  if (o.kind === "supply") {
    const sh = o.exitShare;
    tiles.push({ title: "Withdrawable now", big: o.exitNow != null ? usd(o.exitNow) : "—", small: sh != null ? `${pct(sh, 0)} of supplied` : "cash in the market", t: sh == null ? "info" : sh < 0.05 ? "crit" : sh < 0.2 ? "warn" : "good" });
    if (o.apyRange) tiles.push({ title: "Rate range", big: `${pct(o.apyRange[0])}–${pct(o.apyRange[1])}`, small: `last ${Math.round(o.rangeHours)} h`, t: "info" });
  } else {
    tiles.push({ title: "Traded, 24h", big: o.vol24 != null ? usd(o.vol24) : "—", small: o.turnover != null ? `${o.turnover.toFixed(1)}× the pool` : "measuring", t: o.turnover != null && o.turnover >= 3 ? "warn" : "info" });
    if (o.priceMove != null) tiles.push({ title: "Price range, 7d", big: pct(o.priceMove, 0), small: o.ilAtMove != null ? `LP trails holding by ${pct(o.ilAtMove, 1)}` : "move within the week", t: o.ilAtMove != null && o.ilAtMove >= 0.05 ? "warn" : "info" });
  }
  const f = o.farm;
  if (f?.on && f.apr != null) {
    const inc: CardTile = { title: "Incentives", big: pct(f.apr), small: `paid in ${f.reward}, not added in`, t: "warn" };
    if (tiles.length >= 4) tiles[3] = inc; else tiles.push(inc);
  }
  const notes = o.notes.filter((n) => !/^Yield:|incentives are not included|^Farm rewards:/i.test(n));
  const risk = notes[0] ?? "No flags raised by dawns' checks today.";
  const exitLine = o.kind === "supply"
    ? `• Withdrawable now: ${o.exitNow != null ? usd(o.exitNow) : "unknown"}${o.exitShare != null ? ` (${pct(o.exitShare, 0)} of supplied)` : ""}`
    : `• Liquidity: ${usd(o.size)} in the pool${o.vol24 != null ? `, ${usd(o.vol24)} traded in 24h` : ""}`;
  const caption = [
    "DAWNS // KASPA CAPITAL REPORT", "",
    `${o.name} · ${o.pname}`, "",
    `• ${o.kind === "lp" ? "In the pool" : "Supplied"}: ${usd(o.size)}`,
    `• Native yield: ${o.apy != null ? pct(o.apy) : "still measuring"}`,
    ...(f?.on && f.apr != null ? [`• Incentives: ${pct(f.apr)} in ${f.reward}, shown separately, never added in`] : []),
    `• Source of yield: ${o.apyBasis}`,
    `• Main risk: ${risk}`,
    exitLine, "",
    "The interesting part isn't the yield. It's why the yield exists.", "",
    "Dawns reading: {reading}", "",
    "{url}", "Research, not advice.",
  ].join("\n");
  return {
    data: {
      kind: "opp", ref: o.id, kicker: "OPPORTUNITY", title: o.name, sub: `${o.pname} · ${o.chain === "igra" ? "Igra" : "Kasplex L2"}`,
      tiles, grade: { t: o.status, label: o.statusText }, path: "/opportunities", asOf: s.asOf, block: s.blocks.igra?.block ?? null,
      foot: "Native yield only · incentives never added in",
      caption,
    },
    reading: joinFindings(notes.length ? notes : [`${o.statusText}. ${o.apyBasis}.`]),
  };
}

/**
 * The weekly count: how many listed opportunities have a yield source dawns has measured
 * on-chain, how many can't be left right now, how many pay token incentives on top.
 */
export function countCard(s: Snapshot): { data: CardData; reading: string } {
  const all = s.opportunities;
  const traced = all.filter((o) => o.apy != null).length;
  const blocked = all.filter((o) => o.status === "crit").length;
  const flagged = all.filter((o) => o.status === "warn").length;
  const farms = all.filter((o) => o.farm?.on).length;
  const reading = `Dawns lists ${all.length} Kaspa DeFi opportunities of $5K or more. ${traced} have a yield source dawns has measured on-chain${traced < all.length ? `; the other ${all.length - traced} are still being measured or have an unknown fee` : ""}. ${blocked ? `${blocked} can't be left right now. ` : ""}${farms ? `${farms} pay token incentives, shown separately and never added to the yield.` : ""}`.trim();
  return {
    data: {
      kind: "count", ref: `week:${athens(s.asOf).day}`, kicker: "DAWNS // WEEKLY COUNT", title: `${traced} of ${all.length} opportunities`, sub: "yield source traced on-chain",
      tiles: [
        { title: "Listed", big: String(all.length), small: "Kaspa DeFi, $5K or more", t: "info" },
        { title: "Yield traced", big: String(traced), small: "source measured on-chain", t: "good" },
        { title: "Flagged", big: String(flagged), small: "tight, volatile or unusual", t: flagged ? "warn" : "good" },
        { title: "Exit blocked", big: String(blocked), small: "can't be left right now", t: blocked ? "crit" : "good" },
      ],
      grade: { t: "info", label: "Every Monday" }, path: "/opportunities", asOf: s.asOf, block: s.blocks.igra?.block ?? null,
      foot: "Research, not advice",
      caption: [
        "DAWNS // KASPA CAPITAL COUNT", "",
        "We checked every Kaspa DeFi opportunity of $5K or more.", "",
        `• Listed: ${all.length}`, `• Yield source measured on-chain: ${traced}`, `• Flagged: ${flagged}`, `• Exit blocked right now: ${blocked}`,
        ...(farms ? [`• Paying token incentives: ${farms} (never added to the yield)`] : []), "",
        "A high APY is easy to find. A yield you can explain is not.", "",
        "{url}",
      ].join("\n"),
    },
    reading,
  };
}

/**
 * This week in Kaspa capital, from Intelligence: net new capital counted in token quantities
 * (so a price move is not mistaken for money arriving), where it arrived and left, and the
 * yields that moved. Null until dawns holds a few days of its own readings.
 */
export async function weekCard(s: Snapshot): Promise<{ data: CardData; reading: string } | null> {
  const I = buildIntel(await getIntelRaw(), s);
  if (I.days < 3) return null;
  const sg = (v: number) => `${v >= 0 ? "+" : "−"}${usd(Math.abs(v))}`;
  const span = Math.max(1, Math.round(I.span));
  const within = `last ${span} day${span > 1 ? "s" : ""}`;
  const f = I.flows, inn = f.into[0], out = f.out[0];
  const yu = I.yieldUp[0], yd = I.yieldDown[0];
  const m = I.market;
  const volChange = m.vol7 != null && m.volPrev7 ? m.vol7 / m.volPrev7 - 1 : null;
  const tiles: CardTile[] = [
    { title: "Net new capital", big: sg(f.total), small: `${sg(f.lending)} lending · ${sg(f.liquidity)} pools`, t: f.total >= 0 ? "good" : "warn" },
    inn ? { title: "Most arrived", big: sg(inn.value), small: `${inn.name} · ${inn.pname}`, t: "good" } : { title: "Most arrived", big: "—", small: "nothing over $500", t: "info" },
    out ? { title: "Most left", big: sg(out.value), small: `${out.name} · ${out.pname}`, t: "warn" } : { title: "Most left", big: "—", small: "nothing over $500", t: "info" },
    yu && yu.now != null && yu.then != null ? { title: "Yield rising", big: pct(yu.now), small: `${yu.name}, from ${pct(yu.then)}`, t: "good" }
      : yd && yd.now != null && yd.then != null ? { title: "Yield falling", big: pct(yd.now), small: `${yd.name}, from ${pct(yd.then)}`, t: "warn" }
      : { title: "Traded, 7 days", big: m.vol7 != null ? usd(m.vol7) : "—", small: volChange != null ? `${volChange >= 0 ? "+" : "−"}${pct(Math.abs(volChange), 0)} on the week before` : "on the DEXs dawns reads", t: "info" },
  ];
  const parts = [
    `${sg(f.total)} of net new capital over the ${within}: lending ${sg(f.lending)}, pools ${sg(f.liquidity)}, counted in tokens at today's prices.`,
    inn ? `Most arrived in ${inn.name} (${inn.pname}).` : "",
    out ? `Most left ${out.name} (${out.pname}).` : "",
    yu && yu.now != null && yu.then != null ? `Native yield rose on ${yu.name}, ${pct(yu.then)} to ${pct(yu.now)}.` : yd && yd.now != null && yd.then != null ? `Native yield fell on ${yd.name}, ${pct(yd.then)} to ${pct(yd.now)}.` : "",
  ].filter(Boolean);
  const list = (xs: typeof f.into) => xs.slice(0, 2).map((x) => `${x.name} ${sg(x.value)}`).join(", ") || "nothing over $500";
  const ylist = (xs: typeof I.yieldUp) => xs.filter((x) => x.now != null && x.then != null).slice(0, 2).map((x) => `${x.name} ${pct(x.then!)} → ${pct(x.now!)}`).join(", ") || "none beyond ±15%";
  return {
    data: {
      kind: "week", ref: `intel:${athens(s.asOf).day}`, kicker: "THIS WEEK IN KASPA CAPITAL", title: `${sg(f.total)} net new capital`, sub: `Kaspa DeFi · ${within}`,
      tiles, grade: { t: "info", label: "Every Thursday" }, path: "/intelligence", asOf: s.asOf, block: s.blocks.igra?.block ?? null,
      foot: "Research, not advice",
      caption: [
        "DAWNS // THIS WEEK IN KASPA CAPITAL", "",
        `• Net new capital (${within}): ${sg(f.total)}`, `• Arriving: ${list(f.into)}`, `• Leaving: ${list(f.out)}`,
        `• Yield rising: ${ylist(I.yieldUp)}`, `• Yield falling: ${ylist(I.yieldDown)}`,
        ...(m.vol7 != null ? [`• Traded on Kaspa DEXs, 7 days: ${usd(m.vol7)}${volChange != null ? ` (${volChange >= 0 ? "+" : "−"}${pct(Math.abs(volChange), 0)} on the week before)` : ""}`] : []), "",
        "Counted in tokens, not dollars: a price move is not money arriving.", "",
        "{url}",
      ].join("\n"),
    },
    reading: joinFindings(parts),
  };
}

/** Today in Athens (YYYY-MM-DD) and the hour, the same clock as the morning report. */
function athens(t: number) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Athens", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  const weekday = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Athens", weekday: "short" }).format(new Date(t));
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), weekday };
}
const rid = () => `c_${[...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, "0")).join("")}`;

/** Look up one asset or opportunity and build its card from the live data. */
export async function cardFor(kind: CardKind, ref: string, s: Snapshot, assets?: Asset[]) {
  if (kind === "count") return countCard(s);
  if (kind === "week") return weekCard(s);
  if (kind === "plan") return null;
  if (kind === "opp") { const o = s.opportunities.find((x) => x.id === ref); return o ? oppCard(o, s) : null; }
  const a = (assets ?? (await getAssets())).find((x) => x.id === ref);
  return a ? assetCard(a, s) : null;
}

async function save(day: string, kind: CardKind, ref: string, c: { data: CardData; reading: string }, origin: string, replace: boolean) {
  const rows = (await sql().query(
    `insert into card_drafts (id, day, kind, ref, data, reading, origin) values ($1, $2, $3, $4, $5::jsonb, $6, $7)
     on conflict (day, kind, ref) do ${replace ? "update set data = excluded.data, reading = excluded.reading, status = 'draft', updated_at = now(), sent_at = null" : "nothing"}
     returning id`,
    [rid(), day, kind, ref, JSON.stringify(c.data), c.reading, origin])) as { id: string }[];
  return rows[0]?.id ?? null;
}

/** A card made on demand from /admin/cards: replaces today's card for the same subject. */
export async function makeCard(kind: CardKind, ref: string, s: Snapshot) {
  const c = await cardFor(kind, ref, s);
  if (!c) return null;
  return save(athens(Date.now()).day, kind, c.data.ref, c, "manual", true);
}

/**
 * The daily pick, by a fixed rule so no project is singled out by hand:
 * - assets: the 3 most traded over 7 days (with a real market, value that could be realized),
 *   skipping any featured in the last 7 days;
 * - opportunities of at least $25K: the largest, the highest native yield, and one with a
 *   warning, skipping any featured in the last 3 days;
 * - on Mondays, the weekly count (see countCard); on Thursdays, this week in Kaspa capital (weekCard).
 */
export function pickDaily(s: Snapshot, assets: Asset[], recent: Set<string>) {
  const flow = (a: Asset) => Math.max(a.vol7 ?? 0, (a.vol24 ?? 0) * 7);
  const as = assets
    .filter((a) => a.standard !== "native" && significant(a) && a.price != null && valueCredible(a) && flow(a) > 0 && !recent.has(`asset:${a.id}`))
    .sort((x, y) => flow(y) - flow(x)).slice(0, 3);
  const pool = s.opportunities.filter((o) => !o.farm && o.size >= 25_000 && !recent.has(`opp:${o.id}`));
  const picks = [
    [...pool].sort((x, y) => y.size - x.size)[0],
    [...pool].filter((o) => o.apy != null).sort((x, y) => (y.apy ?? 0) - (x.apy ?? 0))[0],
    pool.find((o) => o.status === "crit" || o.status === "warn"),
  ].filter((o): o is Opportunity => !!o);
  const opps = [...new Map(picks.map((o) => [o.id, o])).values()];
  return { assets: as, opps };
}

/** From the cron tick: once a day after 07:00 Athens, draft today's cards. Never posts anything. */
export async function maybeDailyCards(s: Snapshot) {
  const { day, hour, weekday } = athens(s.asOf);
  if (hour < 7) return "not yet";
  if ((await getMeta("daily_cards")) === day) return "done";
  await setMeta("daily_cards", day); // claim first so parallel ticks cannot double-draft
  const rows = (await sql().query(
    `select kind, ref from card_drafts where (kind = 'asset' and day > $1::date - 7) or (kind = 'opp' and day > $1::date - 3)`, [day])) as { kind: string; ref: string }[];
  const recent = new Set(rows.map((r) => `${r.kind}:${r.ref}`));
  const assets = await getAssets();
  const { assets: as, opps } = pickDaily(s, assets, recent);
  let n = 0;
  for (const a of as) if (await save(day, "asset", a.id, assetCard(a, s), "daily", false)) n++;
  for (const o of opps) if (await save(day, "opp", o.id, oppCard(o, s), "daily", false)) n++;
  if (weekday === "Thu") { const c = await weekCard(s); if (c && await save(day, "week", c.data.ref, c, "daily", false)) n++; }
  if (weekday === "Mon") { const c = countCard(s); if (await save(day, "count", c.data.ref, c, "daily", false)) n++; }
  return `drafted ${n}`;
}

export async function getDraft(id: string): Promise<CardDraft | null> {
  const r = (await sql().query("select id, to_char(day, 'YYYY-MM-DD') as day, kind, ref, data, reading, status, origin, updated_at, sent_at from card_drafts where id = $1", [id])) as CardDraft[];
  return r[0] ?? null;
}

export async function recentDrafts(days = 7): Promise<CardDraft[]> {
  return (await sql().query(
    `select id, to_char(day, 'YYYY-MM-DD') as day, kind, ref, data, reading, status, origin, updated_at, sent_at from card_drafts
     where day > current_date - $1::int order by day desc, kind, created_at`, [days])) as CardDraft[];
}
