import "server-only";
import { sql, ensureSchema, getMeta, setMeta } from "./db";
import { getIntelRaw } from "./intel-db";
import { buildIntel, type Intel } from "./intel";
import type { Snapshot, Opportunity } from "./types";

/**
 * The Dawns Signal: once a week, the five biggest measured changes in Kaspa DeFi, each
 * one line with its number and a link to the reading behind it. Drafted automatically
 * from dawns' own daily records; nothing is published until someone edits and approves
 * it in /admin/signal.
 */

export interface SignalItem { key: string; head: string; line: string; href: string | null; tone: "up" | "down" | "warn" | "calm" }
export interface SignalData { week: string; asOf: number; title: string; intro: string; items: SignalItem[] }
export interface SignalIssue { id: string; data: SignalData; status: "draft" | "published"; created_at: string; published_at: string | null; telegram_at: string | null }

const pctS = (v: number, d = 1) => `${(v * 100).toFixed(d)}%`;
const pp = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(1)}pp`;
const usdS = (v: number) => { const a = Math.abs(v); return `$${a >= 1e6 ? `${(a / 1e6).toFixed(1)}M` : a >= 1e3 ? `${(a / 1e3).toFixed(0)}K` : a.toFixed(0)}`; };
const oppHref = (o: { id: string }) => `/opportunities/${encodeURIComponent(o.id)}`;

/** ISO week of a moment: "2026-W40". */
export function isoWeek(t: number) {
  const d = new Date(t);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const y = d.getUTCFullYear();
  const jan4 = new Date(Date.UTC(y, 0, 4));
  const w = 1 + Math.round(((d.getTime() - jan4.getTime()) / 86_400_000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return `${y}-W${String(w).padStart(2, "0")}`;
}

/** Every measured change worth a line this week, each with a weight: the five heaviest make the issue. */
export function candidates(intel: Intel, s: Snapshot): (SignalItem & { w: number })[] {
  const out: (SignalItem & { w: number })[] = [];
  const m = intel.market;
  const byId = new Map(s.opportunities.map((o) => [o.id, o] as const));
  if (m.tvlThen && m.tvlThen > 0) {
    const ch = m.tvlNow / m.tvlThen - 1;
    out.push({ key: "tvl", head: `Kaspa DeFi value ${ch >= 0 ? "up" : "down"} ${pctS(Math.abs(ch))}`, line: `${usdS(m.tvlThen)} → ${usdS(m.tvlNow)} across the protocols dawns reads${m.kasThen && m.kasNow ? `, with KAS ${m.kasNow >= m.kasThen ? "up" : "down"} ${pctS(Math.abs(m.kasNow / m.kasThen - 1))}` : ""}.`, href: "/intelligence", tone: ch >= 0 ? "up" : "down", w: Math.abs(ch) * 2 });
  }
  if (m.vol7 != null && m.volPrev7) {
    const ch = m.vol7 / m.volPrev7 - 1;
    out.push({ key: "volume", head: `DEX volume ${ch >= 0 ? "up" : "down"} ${pctS(Math.abs(ch), 0)} on the week`, line: `${usdS(m.volPrev7)} → ${usdS(m.vol7)} of swaps read on-chain.`, href: "/intelligence", tone: ch >= 0 ? "up" : "down", w: Math.abs(ch) });
  }
  if (m.utilNow != null && m.utilThen != null && Math.abs(m.utilNow - m.utilThen) >= 0.02) {
    out.push({ key: "util", head: `Lending utilization ${pp(m.utilNow - m.utilThen)}`, line: `${pctS(m.utilThen, 0)} → ${pctS(m.utilNow, 0)} of supplied capital lent out: the higher it runs, the harder it is to withdraw.`, href: "/intelligence", tone: m.utilNow > m.utilThen ? "warn" : "calm", w: Math.abs(m.utilNow - m.utilThen) * 5 });
  }
  for (const [list, dir] of [[intel.yieldUp, "up"], [intel.yieldDown, "down"]] as const) {
    const x = list[0];
    if (x && x.then != null && x.now != null) {
      const o = byId.get(x.id);
      out.push({ key: `yield-${dir}:${x.id}`, head: `${x.name} on ${x.pname}: yield ${dir === "up" ? "rising" : "falling"}`, line: `Native yield ${pctS(x.then, 2)} → ${pctS(x.now, 2)}${o?.kind === "supply" && o.exitShare != null ? `; ${Math.round(o.exitShare * 100)}% of the market can leave now` : ""}.`, href: oppHref(x), tone: dir === "up" ? "up" : "down", w: Math.abs(x.now - x.then) / Math.max(0.01, x.then) });
    }
  }
  for (const [list, dir] of [[intel.flows.into, "in"], [intel.flows.out, "out"]] as const) {
    const x = list[0];
    const what = x ? (x.kind === "supply" ? `${dir === "in" ? "supplied to" : "withdrawn from"} ${x.assets[0]} lending on ${x.pname}` : `${dir === "in" ? "added to" : "removed from"} ${x.name} on ${x.pname}`) : "";
    if (x && x.size > 0) out.push({ key: `flow-${dir}:${x.id}`, head: `${usdS(x.value)} ${what}`, line: `Measured by quantity at today's prices, so price moves do not count as flows: ${pctS(Math.abs(x.value) / x.size, 0)} of what is there now.`, href: oppHref(x), tone: dir === "in" ? "up" : "down", w: Math.min(3, Math.abs(x.value) / x.size) });
  }
  const blocked = s.opportunities.filter((o) => o.kind === "supply" && o.status === "crit");
  if (blocked.length) out.push({ key: "blocked", head: `${blocked.length} lending market${blocked.length > 1 ? "s" : ""} where suppliers can't all leave`, line: `${blocked.map((o) => `${o.assets[0]} on ${o.pname}`).join(", ")}: the highest rates, because the cash is lent out.`, href: "/opportunities", tone: "warn", w: 0.6 });
  // an emerging opportunity already named as this week's riser is not a second item
  const named = new Set(out.map((x) => x.key.split(":").slice(1).join(":")).filter(Boolean));
  const em = intel.emerging.filter((id) => !named.has(id)).map((id) => byId.get(id)).filter((o): o is Opportunity => !!o);
  if (em.length) out.push({ key: "emerging", head: `Emerging: ${em[0].name} on ${em[0].pname}`, line: `Yield rising while the way out stays open${em.length > 1 ? `; ${em.length - 1} more like it on the Intelligence page` : ""}.`, href: oppHref(em[0]), tone: "up", w: 0.5 });
  return out.sort((a, b) => b.w - a.w);
}

export function draftFrom(intel: Intel, s: Snapshot): SignalData {
  const items = candidates(intel, s).slice(0, 5).map((x): SignalItem => ({ key: x.key, head: x.head, line: x.line, href: x.href, tone: x.tone }));
  const week = isoWeek(s.asOf);
  return {
    week, asOf: s.asOf, title: `The Dawns Signal · ${week.replace("-W", ", week ")}`,
    intro: `${items.length} things that changed in Kaspa DeFi this week, each measured on-chain by dawns.`,
    items,
  };
}

/** Make (or remake, while still a draft) this week's issue from today's data. */
export async function draftSignal(s: Snapshot, force = false): Promise<string> {
  await ensureSchema();
  const intel = buildIntel(await getIntelRaw(), s);
  const data = draftFrom(intel, s);
  const q = sql();
  const r = (await q.query(force
    ? "insert into signal_issues (id, data) values ($1, $2::jsonb) on conflict (id) do update set data = excluded.data, updated_at = now() where signal_issues.status = 'draft' returning id"
    : "insert into signal_issues (id, data) values ($1, $2::jsonb) on conflict do nothing returning id", [data.week, JSON.stringify(data)])) as unknown[];
  return r.length ? `drafted ${data.week}` : `${data.week} exists`;
}

/** The cron's weekly draft: Monday from 08:00 Athens, once. */
export async function maybeWeeklySignal(s: Snapshot) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Athens", weekday: "short", hour: "2-digit", hourCycle: "h23" }).formatToParts(new Date(s.asOf)).map((x) => [x.type, x.value]));
  if (p.weekday !== "Mon" || Number(p.hour) < 8) return "not yet";
  const week = isoWeek(s.asOf);
  if ((await getMeta("weekly_signal")) === week) return "done";
  await setMeta("weekly_signal", week);
  return draftSignal(s);
}

export async function getIssue(id: string): Promise<SignalIssue | null> {
  await ensureSchema();
  return ((await sql().query("select id, data, status, created_at, published_at, telegram_at from signal_issues where id = $1", [id])) as SignalIssue[])[0] ?? null;
}
export async function listIssues(published = true, limit = 12): Promise<SignalIssue[]> {
  await ensureSchema();
  return (await sql().query(`select id, data, status, created_at, published_at, telegram_at from signal_issues ${published ? "where status = 'published'" : ""} order by id desc limit $1`, [limit])) as SignalIssue[];
}

/** The issue as plain text for X (a thread: one post per item) and for Telegram (one message). */
export function asThread(d: SignalData, site: string): string[] {
  return [
    `${d.title}\n\n${d.intro}`,
    ...d.items.map((x, i) => `${String(i + 1).padStart(2, "0")} · ${x.head}\n\n${x.line}${x.href ? `\n\n${site}${x.href}` : ""}`),
    `Every figure is read on-chain, with how it was calculated.\n\n${site}/signal/${d.week}`,
  ];
}
