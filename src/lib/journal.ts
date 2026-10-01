import "server-only";
import { sql, hasDb } from "./db";
import { proofs, proofHeadline } from "./proof";
import type { Snapshot } from "./types";

/**
 * The daily paper journal (admin only). Once a day dawns hands Claude a digest of its
 * own readings — markets, yields, liquidity, signals, reserves — and Claude writes a
 * short brief and up to three ideas. "paper_enter" ideas open a paper position in a
 * 1,000-unit book; each later day it earns that day's recorded native yield, less the
 * entry/exit cost Claude estimated. Price moves are not counted. No money moves.
 */

export const BOOK = 1000;
const MODEL = () => process.env.JOURNAL_MODEL || "claude-sonnet-5-5";
const RUN_AFTER_UTC_HOUR = 6;

export interface Idea {
  id: string; day: string;
  oppId: string | null; action: "paper_enter" | "watch";
  title: string; thesis: string; sizePct: number; horizonDays: number;
  expectedApy: number | null; costBps: number; exitIf: string; risks: string[];
  confidence: "low" | "medium" | "high";
}
export interface Entry {
  day: string; created_at: string; model: string | null;
  brief: string | null; ideas: Idea[]; closes: { ideaId: string; reason: string }[]; reviews: { ideaId: string; note: string }[];
  usage: { input_tokens?: number; output_tokens?: number } | null; error: string | null;
  digest: Digest | null;
}
type OppRow = { id: string; protocol: string; name: string; kind: string; chain: string; apy: number | null; apyRange: [number, number] | null; sizeUsd: number; exitNowUsd: number | null; exitShare: number | null; vol24: number | null; priceMove7d: number | null; ilAtMove: number | null; status: string; statusText: string; farmApr: number | null };
export interface Digest {
  asOf: string; kasUsd: number | null; kas24: number | null;
  ecosystem: { tvl: number; dexLiq: number; lendingLiq: number; lendingUtil: number | null };
  protocols: { id: string; name: string; kind: string; tvl: number; d24: number | null; d7: number | null }[];
  opportunities: OppRow[];
  signals: { t: string; text: string }[];
  reserves: { id: string; name: string; label: string; value: string }[];
}

const r2 = (x: number | null | undefined, d = 4) => (x == null || !isFinite(x) ? null : Number(x.toFixed(d)));

/** What Claude sees: dawns' own readings, trimmed to what a decision needs. */
export function digestOf(s: Snapshot): Digest {
  return {
    asOf: new Date(s.asOf).toISOString(), kasUsd: r2(s.kasUsd, 5), kas24: r2(s.kas24),
    ecosystem: { tvl: Math.round(s.eco.tvl), dexLiq: Math.round(s.eco.dexLiq), lendingLiq: Math.round(s.eco.lendingLiq), lendingUtil: r2(s.eco.lendingUtil) },
    protocols: s.protocols.map((p) => ({ id: p.id, name: p.name, kind: p.kind, tvl: Math.round(p.tvl), d24: r2(p.d24), d7: r2(p.d7) })),
    opportunities: s.opportunities.map((o) => ({
      id: o.id, protocol: o.pname, name: o.name, kind: o.kind, chain: o.chain, apy: r2(o.apy), apyRange: o.apyRange ? [r2(o.apyRange[0])!, r2(o.apyRange[1])!] : null,
      sizeUsd: Math.round(o.size), exitNowUsd: o.exitNow == null ? null : Math.round(o.exitNow), exitShare: r2(o.exitShare), vol24: o.vol24 == null ? null : Math.round(o.vol24),
      priceMove7d: r2(o.priceMove), ilAtMove: r2(o.ilAtMove), status: o.status, statusText: o.statusText, farmApr: r2(o.farm?.apr ?? null),
    })),
    signals: s.signals.slice(0, 30).map((g) => ({ t: g.t, text: `${g.strong} ${g.rest}`.trim() })),
    reserves: proofs(s).map((p) => { const h = proofHeadline(p); return { id: p.id, name: p.name, label: h.label, value: h.value }; }),
  };
}

// ---------------------------------------------------------------------------
// storage
// ---------------------------------------------------------------------------
let ready = false;
async function ensure() {
  if (ready) return;
  await sql().query(`create table if not exists journal (
    day date primary key, created_at timestamptz not null default now(), model text,
    digest jsonb, brief text, ideas jsonb not null default '[]', closes jsonb not null default '[]', reviews jsonb not null default '[]',
    usage jsonb, error text)`);
  ready = true;
}

export async function entries(limit = 60): Promise<Entry[]> {
  if (!hasDb()) return [];
  await ensure();
  const rows = (await sql().query(`select to_char(day, 'YYYY-MM-DD') as day, created_at, model, digest, brief, ideas, closes, reviews, usage, error from journal order by day desc limit $1`, [limit])) as Entry[];
  return rows;
}

// ---------------------------------------------------------------------------
// the paper book: open, accrue, close
// ---------------------------------------------------------------------------
export interface Position {
  idea: Idea; status: "open" | "closed"; closedOn: string | null; closeReason: string | null;
  days: number; ret: number; pnl: number; lastApy: number | null; missingDays: number;
}

/** Every paper position from the journal, with its return so far (native yield less costs; price moves not counted). */
export function book(es: Entry[]): Position[] {
  const asc = [...es].filter((e) => e.digest).sort((a, b) => a.day.localeCompare(b.day));
  const closes = new Map<string, { day: string; reason: string }>();
  for (const e of asc) for (const c of e.closes ?? []) if (!closes.has(c.ideaId)) closes.set(c.ideaId, { day: e.day, reason: c.reason });
  const out: Position[] = [];
  for (const e of asc) for (const idea of e.ideas ?? []) {
    if (idea.action !== "paper_enter" || !idea.oppId) continue;
    const later = asc.filter((x) => x.day > idea.day);
    const manual = closes.get(idea.id);
    let held = 0, ret = -idea.costBps / 10_000, missing = 0, lastApy: number | null = null, closedOn: string | null = null, reason: string | null = null;
    for (const x of later) {
      const o = x.digest?.opportunities.find((y) => y.id === idea.oppId);
      const apy = o?.apy ?? null;
      if (apy == null) missing++; else { ret += apy / 365; lastApy = apy; }
      held++;
      if (manual && x.day >= manual.day) { closedOn = x.day; reason = manual.reason; break; }
      if (held >= idea.horizonDays) { closedOn = x.day; reason = "horizon reached"; break; }
    }
    if (!closedOn && manual && manual.day <= idea.day) { closedOn = manual.day; reason = manual.reason; }
    out.push({ idea, status: closedOn ? "closed" : "open", closedOn, closeReason: reason, days: held, ret, pnl: (BOOK * idea.sizePct / 100) * ret, lastApy, missingDays: missing });
  }
  return out.reverse();
}

// ---------------------------------------------------------------------------
// the daily run
// ---------------------------------------------------------------------------
const SYSTEM = `You are the analyst behind dawns.money's private paper journal for Kaspa DeFi (Igra and Kasplex L2s). Each day you get dawns' own on-chain readings and the paper book so far. You write for one reader: the founder, who will decide later whether any of this deserves real money.

Rules:
- Paper only. Nothing you write moves money.
- Use only the data given. Never invent numbers, protocols, events or history. If something would need data you don't have, say what would be needed.
- Yields are native yield only (fees and interest). Token incentives (farmApr) are context, never part of expected return.
- The markets are small. Size every paper position so it could leave in one day: its share of the 1,000-unit book, at today's KAS price, should stay well under 5% of the market's exitNowUsd (lending) or a small fraction of sizeUsd (pools). Say so when nothing fits.
- Smart-contract, bridge, oracle and liquidity risk usually matter more than a few points of yield. Weigh them first.
- At most 3 new ideas a day. "paper_enter" opens a paper position on one listed opportunity id; "watch" is anything worth tracking that isn't a position (oppId may be null). No idea at all is a fine answer on a quiet day.
- costBps is your estimate of entry plus exit cost (swap fees, slippage, gas) as basis points of the position.
- Review every open position briefly; close one (closes) when its thesis no longer holds. Positions close on their own at their horizon.
- The brief: plain, specific, under 220 words, markdown bullets allowed. Lead with what changed since yesterday and what it means.`;

const TOOL = {
  name: "record_journal",
  description: "Record today's journal entry.",
  input_schema: {
    type: "object",
    properties: {
      brief: { type: "string" },
      ideas: { type: "array", maxItems: 3, items: { type: "object", properties: {
        action: { type: "string", enum: ["paper_enter", "watch"] },
        oppId: { type: ["string", "null"] },
        title: { type: "string" }, thesis: { type: "string" },
        sizePct: { type: "number", minimum: 0, maximum: 30 },
        horizonDays: { type: "integer", minimum: 1, maximum: 30 },
        expectedApy: { type: ["number", "null"], description: "fraction, 0.08 = 8%" },
        costBps: { type: "number", minimum: 0 },
        exitIf: { type: "string" },
        risks: { type: "array", items: { type: "string" } },
        confidence: { type: "string", enum: ["low", "medium", "high"] },
      }, required: ["action", "oppId", "title", "thesis", "sizePct", "horizonDays", "expectedApy", "costBps", "exitIf", "risks", "confidence"] } },
      closes: { type: "array", items: { type: "object", properties: { ideaId: { type: "string" }, reason: { type: "string" } }, required: ["ideaId", "reason"] } },
      reviews: { type: "array", items: { type: "object", properties: { ideaId: { type: "string" }, note: { type: "string" } }, required: ["ideaId", "note"] } },
    },
    required: ["brief", "ideas", "closes", "reviews"],
  },
};

const today = () => new Date().toISOString().slice(0, 10);

/** Once a day after 06:00 UTC (or now, with force): write today's entry. */
export async function maybeDailyJournal(s: Snapshot, force = false): Promise<string> {
  if (!hasDb()) return "no database";
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return "ANTHROPIC_API_KEY not set";
  if (!force && new Date().getUTCHours() < RUN_AFTER_UTC_HOUR) return "waiting for the morning run";
  await ensure();
  const q = sql();
  const day = today();
  if (force) await q.query("delete from journal where day = $1", [day]);
  // claim the day first, so overlapping cron runs write it once
  const claimed = (await q.query("insert into journal (day, model) values ($1, $2) on conflict (day) do nothing returning day", [day, MODEL()])) as unknown[];
  if (!claimed.length) return "already written today";

  const digest = digestOf(s);
  await q.query("update journal set digest = $2 where day = $1", [day, JSON.stringify(digest)]);
  try {
    const past = (await entries(30)).filter((e) => e.day !== day);
    const prev = past.find((e) => !e.error);
    const open = book([{ day, created_at: "", model: null, brief: null, ideas: [], closes: [], reviews: [], usage: null, error: null, digest }, ...past]).filter((p) => p.status === "open");
    const user = [
      `Today is ${day}. The paper book is ${BOOK} units.`,
      `Today's readings:\n${JSON.stringify(digest)}`,
      prev ? `Yesterday's brief (${prev.day}):\n${prev.brief ?? ""}` : "This is the first entry.",
      prev?.digest ? `Yesterday's opportunities, to compare:\n${JSON.stringify(prev.digest.opportunities.map((o) => ({ id: o.id, apy: o.apy, sizeUsd: o.sizeUsd, exitNowUsd: o.exitNowUsd, status: o.status })))}` : "",
      open.length ? `Open paper positions:\n${JSON.stringify(open.map((p) => ({ ideaId: p.idea.id, oppId: p.idea.oppId, title: p.idea.title, thesis: p.idea.thesis, opened: p.idea.day, sizePct: p.idea.sizePct, horizonDays: p.idea.horizonDays, daysHeld: p.days, returnSoFar: r2(p.ret), lastApy: p.lastApy, exitIf: p.idea.exitIf })))}` : "No open paper positions.",
      "Write today's entry with record_journal.",
    ].filter(Boolean).join("\n\n");

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODEL(), max_tokens: 4000, system: SYSTEM, tools: [TOOL], tool_choice: { type: "tool", name: TOOL.name }, messages: [{ role: "user", content: user }] }),
      signal: AbortSignal.timeout(180_000),
    });
    const j = (await res.json().catch(() => null)) as { content?: { type: string; input?: Record<string, unknown> }[]; usage?: Entry["usage"]; error?: { message?: string } } | null;
    if (!res.ok || !j) throw new Error(`Anthropic API ${res.status}: ${j?.error?.message ?? "no response"}`);
    const out = j.content?.find((c) => c.type === "tool_use")?.input as { brief: string; ideas: Omit<Idea, "id" | "day">[]; closes: Entry["closes"]; reviews: Entry["reviews"] } | undefined;
    if (!out) throw new Error("no journal entry in the reply");

    const known = new Set(digest.opportunities.map((o) => o.id));
    const openIds = new Set(open.map((p) => p.idea.id));
    const ideas: Idea[] = (out.ideas ?? []).slice(0, 3).map((x, i) => ({
      ...x, id: `${day}-${i + 1}`, day,
      oppId: x.oppId && known.has(x.oppId) ? x.oppId : null,
      // a paper position needs a real market; otherwise it is only watched
      action: x.action === "paper_enter" && x.oppId && known.has(x.oppId) ? "paper_enter" : "watch",
      sizePct: Math.max(0, Math.min(30, Number(x.sizePct) || 0)),
      horizonDays: Math.max(1, Math.min(30, Math.round(Number(x.horizonDays) || 7))),
      costBps: Math.max(0, Number(x.costBps) || 0),
      risks: Array.isArray(x.risks) ? x.risks.slice(0, 6).map(String) : [],
    }));
    await q.query("update journal set brief = $2, ideas = $3, closes = $4, reviews = $5, usage = $6, error = null where day = $1",
      [day, String(out.brief ?? "").slice(0, 6000), JSON.stringify(ideas), JSON.stringify((out.closes ?? []).filter((c) => openIds.has(c.ideaId))), JSON.stringify((out.reviews ?? []).filter((c) => openIds.has(c.ideaId))), JSON.stringify(j.usage ?? null)]);
    return `written: ${ideas.length} ideas, ${(out.closes ?? []).length} closes`;
  } catch (e) {
    const msg = (e as Error).message.slice(0, 500);
    await q.query("update journal set error = $2 where day = $1", [day, msg]);
    return `error: ${msg}`;
  }
}
