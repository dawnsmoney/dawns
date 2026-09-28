import "server-only";
import type { Opportunity, Snapshot, Status } from "./types";
import type { Asset } from "./assets/types";
import { CHAIN_NAME, STANDARD_NAME, assetPath, valueCredible } from "./assets/types";
import { analyse, dimensions } from "./assets/analysis";
import { significant } from "./assets/view";
import { getAssets } from "./assets";
import { sql, getMeta, setMeta } from "./db";
import { usd, pct } from "./format";

/**
 * Share cards: a 1200×630 image of one asset or opportunity reading, for X and Telegram.
 * Drafts are picked once a day by a fixed rule (or made on demand in /admin/cards). Their
 * numbers are frozen when drafted, so what you review is what gets posted. Nothing is
 * published until an admin approves it.
 */
export type CardKind = "asset" | "opp";
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
  const notes = o.notes.filter((n) => !/^Yield:|incentives are not included/i.test(n));
  return {
    data: {
      kind: "opp", ref: o.id, kicker: "OPPORTUNITY", title: o.name, sub: `${o.pname} · ${o.chain === "igra" ? "Igra" : "Kasplex L2"}`,
      tiles, grade: { t: o.status, label: o.statusText }, path: "/opportunities", asOf: s.asOf, block: s.blocks.igra?.block ?? null,
      foot: "Native yield only · incentives never added in",
    },
    reading: joinFindings(notes.length ? notes : [`${o.statusText}. ${o.apyBasis}.`]),
  };
}

/** Today in Athens (YYYY-MM-DD) and the hour, the same clock as the morning report. */
function athens(t: number) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Athens", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}
const rid = () => `c_${[...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, "0")).join("")}`;

/** Look up one asset or opportunity and build its card from the live data. */
export async function cardFor(kind: CardKind, ref: string, s: Snapshot, assets?: Asset[]) {
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
  return save(athens(Date.now()).day, kind, ref, c, "manual", true);
}

/**
 * The daily pick, by a fixed rule so no project is singled out by hand:
 * - assets: the 3 most traded over 7 days (with a real market, value that could be realized),
 *   skipping any featured in the last 7 days;
 * - opportunities of at least $25K: the largest, the highest native yield, and one with a
 *   warning, skipping any featured in the last 3 days.
 */
export function pickDaily(s: Snapshot, assets: Asset[], recent: Set<string>) {
  const flow = (a: Asset) => Math.max(a.vol7 ?? 0, (a.vol24 ?? 0) * 7);
  const as = assets
    .filter((a) => a.standard !== "native" && significant(a) && a.price != null && valueCredible(a) && flow(a) > 0 && !recent.has(`asset:${a.id}`))
    .sort((x, y) => flow(y) - flow(x)).slice(0, 3);
  const pool = s.opportunities.filter((o) => o.size >= 25_000 && !recent.has(`opp:${o.id}`));
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
  const { day, hour } = athens(s.asOf);
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
