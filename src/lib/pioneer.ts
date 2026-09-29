import "server-only";
import { sql, ensureSchema } from "./db";
import { progressOf } from "./testing";

/**
 * The Dawns Pioneer program. Points recognise early use of dawns: exploring the market,
 * coming back to it, bringing people who use it, and finding what dawns does not list
 * yet. They are not money, cannot be transferred or sold, and are not a claim on any
 * token. What they will unlock (Pro intelligence, early vault access) is decided later.
 *
 * Every award is one ledger row keyed by (user, kind, ref), so it can only happen once.
 * Awards that follow from what an account already did (joined, made a watchlist,
 * followed a plan, linked Telegram, brought an active user) are derived again on every
 * read by `syncPoints`, so they need no hook in the routes that do those things.
 */

/** Accounts created before this date are Pioneers for good. */
export const PIONEER_UNTIL = Date.parse(process.env.PIONEER_UNTIL ?? "2027-01-01T00:00:00Z");

export type Kind = "join" | "watchlist" | "plan" | "telegram" | "intel" | "opp" | "visit" | "referral" | "find" | "tn_in" | "tn_out" | "bug" | "survey";
export const RULES: { kind: Kind; label: string; pts: number; how: string }[] = [
  { kind: "join", label: "Join as a Pioneer", pts: 1000, how: "Sign in with a wallet before the early phase ends. Once." },
  { kind: "watchlist", label: "Start a watchlist", pts: 100, how: "Watch a protocol or an opportunity. Once." },
  { kind: "plan", label: "Follow a plan", pts: 100, how: "Build an allocation and follow it. Once." },
  { kind: "telegram", label: "Link Telegram alerts", pts: 100, how: "Get your plan's alerts in Telegram. Once." },
  { kind: "intel", label: "Come back to Intelligence", pts: 50, how: "Each day you open Intelligence signed in." },
  { kind: "opp", label: "Read an opportunity", pts: 25, how: "Each opportunity you open for the first time, up to 20." },
  { kind: "visit", label: "Share what you found", pts: 150, how: "Each new visitor who arrives through your link, up to 5 a day." },
  { kind: "referral", label: "Bring someone who uses dawns", pts: 1000, how: "When a person who signed up through your link has used dawns on 3 different days, or made a watchlist or a plan." },
  { kind: "find", label: "Find an opportunity", pts: 1000, how: "When dawns accepts a market, pool or vault you submitted." },
  { kind: "tn_in", label: "Test a vault: deposit", pts: 200, how: "Your first deposit into a testnet vault. Test KAS has no value. Once." },
  { kind: "tn_out", label: "Test a vault: withdraw", pts: 200, how: "Your first withdrawal from a testnet vault. Once." },
  { kind: "bug", label: "Report a real problem", pts: 500, how: "When dawns confirms something you reported was broken or misleading." },
  { kind: "survey", label: "Tell dawns what you saw", pts: 100, how: "Answer the three questions at the end of the tester path. Once." },
];
const PTS = Object.fromEntries(RULES.map((r) => [r.kind, r.pts])) as Record<Kind, number>;
const OPP_CAP = 20, VISITS_PER_DAY = 5;

const ALPHA = "abcdefghjkmnpqrstuvwxyz23456789";
export const isCode = (c: unknown): c is string => typeof c === "string" && /^[a-hj-km-np-z2-9]{7}$/.test(c);
const newCode = () => [...crypto.getRandomValues(new Uint8Array(7))].map((b) => ALPHA[b % ALPHA.length]).join("");
const day = () => new Date().toISOString().slice(0, 10);

/** Record an award once. True when it is new. */
export async function award(userId: string, kind: Kind, ref: string, note?: string): Promise<boolean> {
  const r = (await sql().query("insert into points (user_id, kind, ref, pts, note) values ($1, $2, $3, $4, $5) on conflict do nothing returning pts",
    [userId, kind, ref.slice(0, 120), PTS[kind], note?.slice(0, 200) ?? null])) as unknown[];
  return r.length > 0;
}

/** The account's share code, made on first use. */
export async function codeOf(userId: string): Promise<string> {
  const q = sql();
  const have = (await q.query("select code from pioneer_codes where user_id = $1", [userId])) as { code: string }[];
  if (have[0]) return have[0].code;
  for (let i = 0; i < 5; i++) {
    const c = newCode();
    const r = (await q.query("insert into pioneer_codes (user_id, code) values ($1, $2) on conflict do nothing returning code", [userId, c])) as { code: string }[];
    if (r[0]) return r[0].code;
    const again = (await q.query("select code from pioneer_codes where user_id = $1", [userId])) as { code: string }[];
    if (again[0]) return again[0].code;
  }
  throw new Error("Could not make a share code.");
}

/** A new account that arrived through someone's link. Never your own. */
export async function linkReferral(newUserId: string, code: string) {
  if (!isCode(code)) return;
  const q = sql();
  const owner = ((await q.query("select user_id from pioneer_codes where code = $1", [code])) as { user_id: string }[])[0]?.user_id;
  if (!owner || owner === newUserId) return;
  await q.query("insert into referrals (user_id, referrer, code) values ($1, $2, $3) on conflict do nothing", [newUserId, owner, code]);
}

/** A page view that arrived through a share link: the link's owner earns for a new visitor, a few a day. */
export async function onReferralVisit(code: string, vid: string, path: string | null, viewerId: string | null) {
  if (!isCode(code)) return;
  const q = sql();
  const owner = ((await q.query("select user_id from pioneer_codes where code = $1", [code])) as { user_id: string }[])[0]?.user_id;
  if (!owner || owner === viewerId) return;
  const d = day();
  const fresh = (await q.query("insert into referral_visits (code, vid, day, path) values ($1, $2, $3, $4) on conflict do nothing returning vid", [code, vid, d, path])) as unknown[];
  if (!fresh.length) return;
  const today = ((await q.query("select count(*)::int as n from points where user_id = $1 and kind = 'visit' and ref like $2", [owner, `${d}:%`])) as { n: number }[])[0]?.n ?? 0;
  if (today < VISITS_PER_DAY) await award(owner, "visit", `${d}:${vid}`, path ?? undefined);
}

/** Awards from product events the page reports for a signed-in account. */
export async function onEvent(userId: string, name: string, props: Record<string, unknown>) {
  if (name === "intel_day") await award(userId, "intel", day());
  else if (name === "opportunity_open" && typeof props.id === "string") {
    const n = ((await sql().query("select count(*)::int as n from points where user_id = $1 and kind = 'opp'", [userId])) as { n: number }[])[0]?.n ?? 0;
    if (n < OPP_CAP) await award(userId, "opp", props.id);
  }
}

/** Has this account really used dawns? Three different days of signed-in use, or a watchlist, or a plan. */
async function active(userId: string) {
  const r = (await sql().query(`select
      (select count(distinct date_trunc('day', t)) from app_events where user_id = $1) as days,
      (select count(*) from watch_rules where user_id = $1) as watch,
      (select count(*) from profiles where user_id = $1 and plan is not null) as plans`, [userId])) as { days: string; watch: string; plans: string }[];
  const x = r[0];
  return !!x && (Number(x.days) >= 3 || Number(x.watch) > 0 || Number(x.plans) > 0);
}

/** Derive the awards that follow from what the account has already done. */
export async function syncPoints(userId: string) {
  await ensureSchema();
  const q = sql();
  const f = ((await q.query(`select u.created_at,
      exists (select 1 from watch_rules where user_id = u.id) as watch,
      exists (select 1 from profiles where user_id = u.id and plan is not null) as plan,
      exists (select 1 from telegram_chats where user_id = u.id) as tg
    from users u where u.id = $1`, [userId])) as { created_at: string; watch: boolean; plan: boolean; tg: boolean }[])[0];
  if (!f) return;
  if (Date.parse(f.created_at) < PIONEER_UNTIL) await award(userId, "join", "join");
  if (f.watch) await award(userId, "watchlist", "first");
  if (f.plan) await award(userId, "plan", "first");
  if (f.tg) await award(userId, "telegram", "first");
  // testnet vaults: test KAS has no value, so trying a deposit and a withdrawal is testing, not investing
  const p = await progressOf(userId).catch(() => null);
  if (p?.nav_in || p?.credit_in) await award(userId, "tn_in", "first");
  if (p?.nav_out) await award(userId, "tn_out", "first");
  // people this account brought: activate each once they have used dawns
  const mine = (await q.query("select user_id from referrals where referrer = $1 and activated_at is null", [userId])) as { user_id: string }[];
  for (const r of mine) {
    if (await active(r.user_id)) {
      await q.query("update referrals set activated_at = now() where user_id = $1", [r.user_id]);
      await award(userId, "referral", r.user_id);
    }
  }
}

export interface PioneerView {
  total: number; pioneer: boolean; joined: string; code: string;
  byKind: { kind: Kind; label: string; pts: number; count: number }[];
  recent: { kind: Kind; label: string; pts: number; note: string | null; t: string }[];
  visits: number; referred: number; activated: number;
  finds: { id: string; protocol: string; target: string; status: string; note: string | null; created_at: string }[];
}

export async function pioneerOf(userId: string): Promise<PioneerView> {
  await syncPoints(userId);
  const q = sql();
  const code = await codeOf(userId);
  const [u, kinds, recent, v, refs, finds] = await Promise.all([
    q.query("select created_at from users where id = $1", [userId]),
    q.query("select kind, sum(pts)::int as pts, count(*)::int as n from points where user_id = $1 group by kind", [userId]),
    q.query("select kind, pts, note, t from points where user_id = $1 order by t desc limit 30", [userId]),
    q.query("select count(*)::int as n from referral_visits where code = $1", [code]),
    q.query("select count(*)::int as n, count(activated_at)::int as a from referrals where referrer = $1", [userId]),
    q.query("select id, protocol, target, status, note, created_at from finds where user_id = $1 order by created_at desc limit 20", [userId]),
  ]) as [{ created_at: string }[], { kind: Kind; pts: number; n: number }[], { kind: Kind; pts: number; note: string | null; t: string }[], { n: number }[], { n: number; a: number }[], PioneerView["finds"]];
  const label = (k: Kind) => RULES.find((r) => r.kind === k)?.label ?? k;
  const joined = u[0]?.created_at ?? new Date().toISOString();
  return {
    total: kinds.reduce((s, k) => s + k.pts, 0), pioneer: Date.parse(joined) < PIONEER_UNTIL, joined, code,
    byKind: kinds.map((k) => ({ kind: k.kind, label: label(k.kind), pts: k.pts, count: k.n })).sort((a, b) => b.pts - a.pts),
    recent: recent.map((r) => ({ ...r, label: label(r.kind) })),
    visits: v[0]?.n ?? 0, referred: refs[0]?.n ?? 0, activated: refs[0]?.a ?? 0, finds,
  };
}

/** Accepted finds, newest first, credited to the finder's first wallet (shortened). */
export async function acceptedFinds(limit = 12) {
  await ensureSchema();
  return (await sql().query(`select f.id, f.protocol, f.target, f.asset, f.opp, f.reviewed_at,
      (select address from wallets w where w.user_id = f.user_id order by created_at limit 1) as by
    from finds f where f.status = 'accepted' order by f.reviewed_at desc limit $1`, [limit])) as { id: string; protocol: string; target: string; asset: string | null; opp: string | null; reviewed_at: string; by: string | null }[];
}
