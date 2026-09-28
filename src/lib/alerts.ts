import "server-only";
import { sql, insertJson, getMeta, setMeta } from "./db";
import { send, esc, SITE } from "./telegram";
import { dawnReport } from "./report";
import type { Signal, Snapshot, Status } from "./types";
import { parsePolicy, type FollowedPlan } from "./allocator";
import { planChecks, watchChecks, type WatchEntryLite } from "./plan-alerts";

/* ---------- 1. history ---------- */
export async function recordSnapshot(s: Snapshot) {
  const at = new Date(s.asOf).toISOString();
  await insertJson("snapshots",
    [["taken_at", "timestamptz"], ["kas_usd", "float8"], ["eco_tvl", "float8"], ["dex_liq", "float8"], ["igra_block", "bigint"], ["kasplex_block", "bigint"], ["build_ms", "int"], ["errors", "jsonb"]],
    [{ taken_at: at, kas_usd: s.kasUsd, eco_tvl: s.eco.tvl, dex_liq: s.eco.dexLiq, igra_block: s.blocks.igra?.block ?? null, kasplex_block: s.blocks.kasplex?.block ?? null, build_ms: s.buildMs, errors: s.errors }]);
  await insertJson("protocol_metrics",
    [["taken_at", "timestamptz"], ["protocol", "text"], ["tvl", "float8"], ["llama_tvl", "float8"], ["borrowed", "float8"], ["source", "text"], ["status", "text"]],
    s.protocols.map((p) => ({ taken_at: at, protocol: p.id, tvl: p.tvl, llama_tvl: p.llamaTvl, borrowed: p.borrowed, source: p.source, status: p.status })));
  await insertJson("market_metrics",
    [["taken_at", "timestamptz"], ["protocol", "text"], ["market", "text"], ["supplied_usd", "float8"], ["borrowed_usd", "float8"], ["cash_usd", "float8"], ["util", "float8"], ["supply_apy", "float8"], ["borrow_apr", "float8"], ["oracle_price", "float8"], ["market_price", "float8"], ["oracle_ok", "boolean"], ["frozen", "boolean"]],
    s.protocols.flatMap((p) => (p.lending?.markets ?? []).map((m) => ({
      taken_at: at, protocol: p.id, market: m.symbol, supplied_usd: m.suppliedUsd, borrowed_usd: m.borrowedUsd, cash_usd: m.cashUsd, util: m.utilization,
      supply_apy: m.supplyApy, borrow_apr: m.borrowApr, oracle_price: m.oracleOk ? m.price : null, market_price: m.marketPrice, oracle_ok: m.oracleOk, frozen: m.frozen,
    }))));
  await insertJson("pool_metrics",
    [["taken_at", "timestamptz"], ["protocol", "text"], ["chain", "text"], ["pair", "text"], ["symbols", "text"], ["usd", "float8"], ["reserve0", "float8"], ["reserve1", "float8"]],
    s.protocols.flatMap((p) => (p.dex?.pools ?? []).slice(0, 15).map((x) => ({ taken_at: at, protocol: p.id, chain: x.chain, pair: x.pair, symbols: x.symbols.join("/"), usd: x.usd, reserve0: x.reserves[0], reserve1: x.reserves[1] }))));
  if (s.bridge) {
    const b = s.bridge;
    await insertJson("bridge_metrics",
      [["taken_at", "timestamptz"], ["igra_block", "bigint"], ["locked_kas", "float8"], ["ikas_supply", "float8"], ["coverage", "float8"], ["in_window_kas", "float8"], ["exits_total", "int"], ["total_burned_kas", "float8"]],
      [{ taken_at: at, igra_block: b.block, locked_kas: b.lockedKas, ikas_supply: b.ikasSupply, coverage: b.coverage, in_window_kas: b.inWindowKas, exits_total: b.exitsTotal, total_burned_kas: b.totalBurnedKas }]);
  }
}

/* ---------- 2. signal lifecycle ---------- */
export type AlertKind = "new" | "worse" | "resolved";
export interface AlertEvent { kind: AlertKind; key: string; protocol: string | null; t: Status; strong: string; rest: string }

const RANK: Record<Status, number> = { good: 0, info: 1, warn: 2, crit: 3 };
const RESOLVE_AFTER_MIN = 30;   // a signal must be gone this long before it counts as resolved
const REOPEN_QUIET_H = 6;       // a signal that comes back within this window does not alert again
/** What is worth a push: warnings, critical signals, and large bridge exits. */
const alertable = (g: { t: Status; rule: string | null }) => g.t === "crit" || g.t === "warn" || (g.rule === "large" && g.t === "info");

type Row = { key: string; protocol: string | null; severity: Status; rule: string | null; strong: string; rest: string; last_seen: string; resolved_at: string | null };

export async function diffSignals(s: Snapshot): Promise<AlertEvent[]> {
  const q = sql();
  const now = new Date(s.asOf);
  const rows = (await q.query("select key, protocol, severity, rule, strong, rest, last_seen, resolved_at from signals_log")) as Row[];
  const firstRun = rows.length === 0;
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const events: AlertEvent[] = [];
  const seen = new Set<string>();

  for (const g of dedupe(s.signals)) {
    seen.add(g.key);
    const r = byKey.get(g.key);
    const ev = (kind: AlertKind) => ({ kind, key: g.key, protocol: g.p, t: g.t, strong: g.strong, rest: g.rest });
    if (!r) {
      if (!firstRun && alertable(g)) events.push(ev("new"));
    } else if (r.resolved_at) {
      const quiet = now.getTime() - new Date(r.resolved_at).getTime() < REOPEN_QUIET_H * 3600_000;
      if (!quiet && alertable(g)) events.push(ev("new"));
    } else if (RANK[g.t] > RANK[r.severity] && alertable(g)) {
      events.push(ev("worse"));
    }
  }
  await insertJson("signals_log",
    [["key", "text"], ["protocol", "text"], ["severity", "text"], ["rule", "text"], ["strong", "text"], ["rest", "text"], ["first_seen", "timestamptz"], ["last_seen", "timestamptz"]],
    dedupe(s.signals).map((g) => ({ key: g.key, protocol: g.p, severity: g.t, rule: g.rule, strong: g.strong, rest: g.rest, first_seen: now.toISOString(), last_seen: now.toISOString() })),
    `on conflict (key) do update set severity = excluded.severity, strong = excluded.strong, rest = excluded.rest, last_seen = excluded.last_seen,
       resolved_at = null, first_seen = case when signals_log.resolved_at is not null then excluded.first_seen else signals_log.first_seen end`);

  // resolve signals that have been gone long enough
  const cutoff = new Date(now.getTime() - RESOLVE_AFTER_MIN * 60_000);
  for (const r of rows) {
    if (r.resolved_at || seen.has(r.key) || new Date(r.last_seen) > cutoff) continue;
    await q.query("update signals_log set resolved_at = $2 where key = $1", [r.key, now.toISOString()]);
    if (alertable({ t: r.severity, rule: r.rule }) && r.rule !== "tvl" && r.rule !== "large" && !r.key.includes(":admin-action:")) events.push({ kind: "resolved", key: r.key, protocol: r.protocol, t: "good", strong: r.strong, rest: "" });
  }
  return events;
}
function dedupe(list: Signal[]) {
  const m = new Map<string, Signal>();
  for (const g of list) { const x = m.get(g.key); if (!x || RANK[g.t] > RANK[x.t]) m.set(g.key, g); }
  return [...m.values()];
}

/* ---------- 3. delivery ---------- */
const ICON: Record<Status, string> = { crit: "🔴", warn: "🟠", info: "🔵", good: "🟢" };
const link = (p: string | null) => (p === "igra-bridge" ? `${SITE}/bridge` : p ? `${SITE}/protocols/${p}` : SITE);

export function formatAlert(e: AlertEvent, names: Record<string, string>) {
  const who = e.protocol === "igra-bridge" ? "Igra bridge" : e.protocol ? names[e.protocol] ?? e.protocol : "Kaspa DeFi";
  if (e.kind === "resolved") return `${ICON.good} <b>Cleared</b> · ${esc(who)}\nNo longer true: ${esc(e.strong)}.\n<a href="${link(e.protocol)}">Open on dawns</a>`;
  const head = e.kind === "worse" ? "Escalated" : e.t === "crit" ? "Critical" : e.t === "warn" ? "Warning" : "Notice";
  return `${ICON[e.t]} <b>${head}</b> · ${esc(who)}\n<b>${esc(e.strong)}</b>${esc(e.rest)}\n<a href="${link(e.protocol)}">See the numbers</a>`;
}

export async function deliver(events: AlertEvent[], s: Snapshot) {
  if (!events.length) return { sent: 0, failed: 0 };
  const q = sql();
  const names = Object.fromEntries(s.protocols.map((p) => [p.id, p.name]));
  // explicit subscriptions, plus every protocol in a linked user's followed plan
  const subs = (await q.query(`select chat_id, protocol from telegram_subs
    union select c.chat_id, l->>'protocol' from telegram_chats c join profiles p on p.user_id = c.user_id
      cross join lateral jsonb_array_elements(coalesce(p.plan->'lines', '[]'::jsonb)) l`)) as { chat_id: string; protocol: string }[];
  let sent = 0, failed = 0;
  for (const e of events) {
    const chats = [...new Set(subs.filter((x) => x.protocol === "all" || x.protocol === e.protocol).map((x) => x.chat_id))];
    for (const chat of chats) {
      const dup = (await q.query(
        "select 1 from alerts_sent where chat_id = $1 and signal_key = $2 and kind = $3 and sent_at > now() - interval '6 hours' limit 1",
        [chat, e.key, e.kind])) as unknown[];
      if (dup.length) continue;
      try {
        await send(chat, formatAlert(e, names));
        await q.query("insert into alerts_sent (chat_id, signal_key, kind) values ($1, $2, $3)", [chat, e.key, e.kind]);
        sent++;
      } catch (err) {
        failed++;
        // the user blocked the bot or deleted the chat: stop sending there
        if ((err as { code?: number }).code === 403) await q.query("delete from telegram_chats where chat_id = $1", [chat]);
      }
    }
  }
  return { sent, failed };
}

/* ---------- 4. morning report (07:00 Athens) ---------- */
export async function maybeDailyReport(s: Snapshot) {
  const now = new Date(s.asOf);
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Athens", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(now).map((p) => [p.type, p.value]));
  const today = `${parts.year}-${parts.month}-${parts.day}`;
  if (Number(parts.hour) < 7) return "not yet";
  if ((await getMeta("daily_report")) === today) return "done";
  await setMeta("daily_report", today); // claim first so parallel ticks cannot double-post
  const text = `<pre>${esc(dawnReport(s))}</pre>`;
  const targets: (string | number)[] = [];
  if (process.env.TELEGRAM_CHANNEL_ID) targets.push(process.env.TELEGRAM_CHANNEL_ID);
  const rows = (await sql().query("select chat_id from telegram_chats where daily")) as { chat_id: string }[];
  targets.push(...rows.map((r) => r.chat_id));
  let n = 0;
  for (const t of targets) { try { await send(t, text); n++; } catch { /* keep going */ } }
  return `sent ${n}`;
}

/* ---------- 5. alerts on each user's followed plan ---------- */
export async function planAlerts(s: Snapshot) {
  const q = sql();
  // every linked chat whose user follows a plan or keeps Watch rules
  const rows = (await q.query(`select c.chat_id, c.user_id, p.plan, p.policy from telegram_chats c left join profiles p on p.user_id = c.user_id
    where c.user_id is not null and (p.plan is not null or exists (select 1 from watch_rules w where w.user_id = c.user_id))`)) as { chat_id: string; user_id: string; plan: FollowedPlan | null; policy: unknown }[];
  const byUser = new Map<string, { plan: FollowedPlan | null; policy: unknown; chats: string[]; watch: Record<string, WatchEntryLite> }>();
  for (const r of rows) {
    const u = byUser.get(r.user_id) ?? { plan: r.plan, policy: r.policy, chats: [], watch: {} };
    u.chats.push(r.chat_id); byUser.set(r.user_id, u);
  }
  if (byUser.size) {
    const w = (await q.query("select user_id, protocol, entry from watch_rules where user_id = any($1)", [[...byUser.keys()]])) as { user_id: string; protocol: string; entry: WatchEntryLite }[];
    for (const r of w) byUser.get(r.user_id)!.watch[r.protocol] = r.entry;
  }
  const poolThen = new Map(((await q.query(`select distinct on (pair) lower(pair) as pair, usd from pool_metrics
    where taken_at between now() - interval '25 hours' and now() - interval '23 hours'
    order by pair, abs(extract(epoch from taken_at - (now() - interval '24 hours')))`)) as { pair: string; usd: number }[]).map((r) => [r.pair, Number(r.usd)]));
  const now = new Date(s.asOf);
  let sent = 0;
  for (const [userId, u] of byUser) {
    const checks = [...(u.plan ? planChecks(s, u.plan, parsePolicy(u.policy)) : []), ...watchChecks(s, u.watch, poolThen)];
    const prev = (await q.query("select key, severity, strong, last_seen, resolved_at from user_signals where user_id = $1", [userId])) as { key: string; severity: Status; strong: string; last_seen: string; resolved_at: string | null }[];
    const byKey = new Map(prev.map((r) => [r.key, r]));
    const events: AlertEvent[] = [];
    for (const c of checks) {
      const r = byKey.get(c.key);
      const quiet = r?.resolved_at && now.getTime() - new Date(r.resolved_at).getTime() < REOPEN_QUIET_H * 3600_000;
      if (!r || (r.resolved_at && !quiet)) events.push({ kind: "new", key: `u:${userId}:${c.key}`, protocol: null, t: c.t, strong: c.strong, rest: c.rest });
      else if (!r.resolved_at && RANK[c.t] > RANK[r.severity]) events.push({ kind: "worse", key: `u:${userId}:${c.key}`, protocol: null, t: c.t, strong: c.strong, rest: c.rest });
    }
    await insertJson("user_signals",
      [["user_id", "text"], ["key", "text"], ["severity", "text"], ["strong", "text"], ["rest", "text"], ["first_seen", "timestamptz"], ["last_seen", "timestamptz"]],
      checks.map((c) => ({ user_id: userId, key: c.key, severity: c.t, strong: c.strong, rest: c.rest, first_seen: now.toISOString(), last_seen: now.toISOString() })),
      "on conflict (user_id, key) do update set severity = excluded.severity, strong = excluded.strong, rest = excluded.rest, last_seen = excluded.last_seen, resolved_at = null");
    const seen = new Set(checks.map((c) => c.key));
    const cutoff = now.getTime() - RESOLVE_AFTER_MIN * 60_000;
    for (const r of prev) {
      if (r.resolved_at || seen.has(r.key) || new Date(r.last_seen).getTime() > cutoff) continue;
      await q.query("update user_signals set resolved_at = $3 where user_id = $1 and key = $2", [userId, r.key, now.toISOString()]);
      if (r.severity === "crit" || r.severity === "warn") events.push({ kind: "resolved", key: `u:${userId}:${r.key}`, protocol: null, t: "good", strong: r.strong, rest: "" });
    }
    for (const e of events) for (const chat of u.chats) {
      const dup = (await q.query("select 1 from alerts_sent where chat_id = $1 and signal_key = $2 and kind = $3 and sent_at > now() - interval '6 hours' limit 1", [chat, e.key, e.kind])) as unknown[];
      if (dup.length) continue;
      const isWatch = e.key.includes(":w:");
      const head = e.kind === "resolved" ? `🟢 <b>Cleared</b> · ${isWatch ? "your rule" : "your plan"}` : `${ICON[e.t]} <b>${e.kind === "worse" ? "Escalated" : isWatch ? "Your rule" : "Your plan"}</b>`;
      const body = e.kind === "resolved" ? `No longer true: ${esc(e.strong)}.` : `<b>${esc(e.strong)}</b>${esc(e.rest)}`;
      try {
        await send(chat, `${head}\n${body}\n<a href="${SITE}${isWatch ? "/watchlist" : "/allocate"}">${isWatch ? "Your watchlist" : "Review your plan"}</a>`);
        await q.query("insert into alerts_sent (chat_id, signal_key, kind) values ($1, $2, $3)", [chat, e.key, e.kind]);
        sent++;
      } catch { /* chat gone; the protocol alert path cleans it up */ }
    }
  }
  return `${byUser.size} users checked, ${sent} alerts sent`;
}
