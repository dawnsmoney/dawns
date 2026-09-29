import "server-only";
import { sql, hasDb, ensureSchema } from "../db";
import { parseDoc, strategyHash, strategyId, DEFAULT_DOC, type StrategyDoc } from "./model";

/**
 * Where strategies come from: dawns' reference strategies (in code, so they are
 * reviewed like code) and the ones strategists publish (Neon, one row per hash).
 */
export type VersionStatus = "current" | "scheduled" | "superseded";
export interface StoredStrategy {
  id: string; hash: string; doc: StrategyDoc; strategist: string; by: "dawns" | "strategist"; createdAt: string;
  family: string; version: number; parent: string | null; effectiveAt: string; status: VersionStatus; listed: boolean;
}

const ref = (d: Partial<StrategyDoc> & Pick<StrategyDoc, "name" | "thesis" | "legs" | "reserveBps">): StoredStrategy => {
  const p = parseDoc({ ...DEFAULT_DOC, ...d, vault: { ...DEFAULT_DOC.vault, ...d.vault }, fees: { ...DEFAULT_DOC.fees, ...d.fees } });
  if ("error" in p) throw new Error(`reference strategy ${d.name}: ${p.error}`);
  const id = strategyId(p.doc);
  return { id, hash: strategyHash(p.doc), doc: p.doc, strategist: "dawns", by: "dawns", createdAt: "2026-09-28", family: id, version: 1, parent: null, effectiveAt: "2026-09-28T00:00:00Z", status: "current", listed: true };
};

export const REFERENCE: StoredStrategy[] = [
  ref({
    name: "Stablecoin lending, exits first",
    thesis: "Dollar lending on Kaskad, split across USDC and USDT so neither market carries the vault. New capital stops the moment a market's suppliers cannot leave, and 30% stays in reserve for redemptions.",
    legs: [{ opp: "kaskad:USDC", target: 3_500, cap: 5_000 }, { opp: "kaskad:USDT", target: 3_500, cap: 5_000 }],
    reserveBps: 3_000, maxProtocolBps: 7_000, exitCover: 3, fees: { performanceBps: 1_000, managementBps: 0 },
  }),
  ref({
    name: "KAS core liquidity",
    thesis: "Stay close to KAS: fees from the two WiKAS pairs with the most real volume, one against USDC and one against ZEAL. Half the exposure is KAS itself; the rest a dollar and a DEX token. Sized small, because the pools are.",
    legs: [{ opp: "zealousswap:0x7826f5421c324590b1c21d22231c48ad059cbe45", target: 3_500, cap: 4_500 }, { opp: "zealousswap:0xa18a9d28a5ef040d8dbccd61a2ca7fc8d5306d95", target: 3_500, cap: 4_500 }],
    reserveBps: 3_000, maxProtocolBps: 8_000, exitCover: 1, fees: { performanceBps: 1_500, managementBps: 0 },
    vault: { type: "nav", access: "permissionless", capacityKas: 25_000, exitFeeBps: 50, termDays: 0, depositDays: 0, redemptionDays: 3 },
  }),
  ref({
    name: "KAS pair fees, 90-day term",
    thesis: "Trading fees from three KAS pairs on two DEXes. Volatile and exposed to small tokens, so it runs as a 90-day fixed term: deposits for 14 days, no redemptions before maturity.",
    legs: [
      { opp: "zealousswap:0x2dfdc939c60da7906e7117a3d6dc6bd6bcd881c9", target: 2_500, cap: 3_000 },
      { opp: "zealousswap:0xa18a9d28a5ef040d8dbccd61a2ca7fc8d5306d95", target: 2_500, cap: 3_000 },
      { opp: "krokoswap-v3:0xd662bf33bc4b790f1454b43cb76fa37670745a95", target: 2_000, cap: 2_500 },
    ],
    reserveBps: 3_000, maxProtocolBps: 6_000, exitCover: 1, fees: { performanceBps: 2_000, managementBps: 0 },
    vault: { type: "fixed", access: "permissionless", capacityKas: 50_000, exitFeeBps: 0, termDays: 90, depositDays: 14, redemptionDays: 0 },
  }),
  ref({
    name: "Private credit, three borrowers (testnet)",
    thesis: "Short loans to three named borrowers, each capped, with 30% of the vault kept liquid. Repayments can only return to the vault; a loan late past its week of grace is written down 25% a month by rule. The borrowers are invented test names: it exists to show a strategy becoming a credit vault on testnet-10.",
    legs: [
      { opp: "credit:aster-liquidity-test", target: 3_000, cap: 4_000, credit: { borrower: "Aster Liquidity (test)", kind: "market-maker", rateBps: 1_000, termDays: 30, collateral: "secured", collateralNote: "stablecoins at a custodian, 110%", graceDays: 7, markdownBps: 2_500, reporting: "attested" } },
      { opp: "credit:brightwater-prime-test", target: 2_500, cap: 3_000, credit: { borrower: "Brightwater Prime (test)", kind: "prime-broker", rateBps: 1_200, termDays: 60, collateral: "secured", collateralNote: "receivables", graceDays: 7, markdownBps: 2_500, reporting: "attested" } },
      { opp: "credit:calder-trading-test", target: 1_500, cap: 2_000, credit: { borrower: "Calder Trading (test)", kind: "fund", rateBps: 800, termDays: 14, collateral: "unsecured", collateralNote: "", graceDays: 7, markdownBps: 2_500, reporting: "self" } },
    ],
    reserveBps: 3_000, maxProtocolBps: 10_000, exitCover: 1, fees: { performanceBps: 0, managementBps: 0 },
    vault: { type: "nav", access: "permissionless", capacityKas: 10_000, exitFeeBps: 25, termDays: 0, depositDays: 0, redemptionDays: 0 },
  }),
];

type Row = { id: string; hash: string; doc: unknown; strategist: string; created_at: string; family: string | null; version: number | null; parent: string | null; effective_at: string | null; listed: boolean };
const COLS = "id, hash, doc, strategist, created_at, family, version, parent, effective_at, listed";
const iso = (x: unknown) => new Date(x as string).toISOString();

/** Rows of one family, oldest first, with each version's status worked out from the clock. */
export function withStatus(rows: Row[], now = Date.now()): StoredStrategy[] {
  const out: StoredStrategy[] = [];
  for (const r of rows) {
    const p = parseDoc(r.doc);
    if ("error" in p || strategyHash(p.doc) !== r.hash) continue;
    out.push({ id: r.id, hash: r.hash, doc: p.doc, strategist: r.strategist, by: "strategist", createdAt: iso(r.created_at).slice(0, 10),
      family: r.family ?? r.id, version: r.version ?? 1, parent: r.parent, effectiveAt: iso(r.effective_at ?? r.created_at), status: "superseded", listed: r.listed });
  }
  out.sort((a, b) => a.version - b.version);
  const live = out.filter((x) => Date.parse(x.effectiveAt) <= now);
  const cur = live[live.length - 1];
  for (const x of out) x.status = x === cur ? "current" : Date.parse(x.effectiveAt) > now ? "scheduled" : "superseded";
  return out;
}

async function rows(where: string, args: unknown[]): Promise<Row[]> {
  await ensureSchema();
  return (await sql().query(`select ${COLS} from strategies where ${where} order by created_at`, args)) as Row[];
}
const byFamily = (rs: Row[]) => {
  const m = new Map<string, Row[]>();
  for (const r of rs) { const f = r.family ?? r.id; m.set(f, [...(m.get(f) ?? []), r]); }
  return [...m.values()].map((x) => withStatus(x));
};

export interface Family { current: StoredStrategy; next: StoredStrategy | null; versions: StoredStrategy[] }
const familyOf = (vs: StoredStrategy[]): Family | null => {
  const current = vs.find((x) => x.status === "current");
  return current ? { current, next: vs.find((x) => x.status === "scheduled") ?? null, versions: vs } : null;
};

/** Every listed strategy family, at its version in force, newest first after dawns' references. */
export async function listFamilies(): Promise<Family[]> {
  const refs = REFERENCE.map((r) => ({ current: r, next: null, versions: [r] }));
  if (!hasDb()) return refs;
  try {
    const fams = byFamily(await rows("listed", [])).map(familyOf).filter((x): x is Family => !!x);
    return [...refs, ...fams.sort((a, b) => b.current.effectiveAt.localeCompare(a.current.effectiveAt))];
  } catch { return refs; }
}
export const listStrategies = async () => (await listFamilies()).map((f) => f.current);

/** One version, with its whole family (every version, including unlisted ones: a link keeps working). */
export async function getStrategy(id: string): Promise<{ st: StoredStrategy; family: Family } | null> {
  const r = REFERENCE.find((x) => x.id === id);
  if (r) return { st: r, family: { current: r, next: null, versions: [r] } };
  if (!hasDb() || !/^[0-9a-f]{12}$/.test(id)) return null;
  const one = await rows("id = $1", [id]);
  if (!one[0]) return null;
  const vs = withStatus(await rows("coalesce(family, id) = $1", [one[0].family ?? one[0].id]));
  const st = vs.find((x) => x.id === id);
  const fam = familyOf(vs);
  return st && fam ? { st, family: fam } : null;
}

/**
 * Publish. A first version is in force at once; a new version of a family takes effect
 * after the notice period of the version in force, and only its strategist may publish it.
 * The document is re-parsed and re-hashed here; the client's hash is never trusted.
 */
export async function publishStrategy(doc: StrategyDoc, userId: string, strategist: string, parentId?: string | null) {
  const hash = strategyHash(doc), id = hash.slice(0, 12);
  if (REFERENCE.some((s) => s.id === id)) return { id, existed: true };
  await ensureSchema();
  const q = sql();
  const exists = (await q.query("select id from strategies where id = $1", [id])) as { id: string }[];
  if (exists.length) return { id, existed: true };
  const n = (await q.query("select count(*)::int as n from strategies where user_id = $1", [userId])) as { n: number }[];
  if ((n[0]?.n ?? 0) >= 50) throw new Error("50 strategy versions per strategist for now.");
  if (!parentId) {
    await q.query("insert into strategies (id, hash, doc, user_id, strategist, family, version, parent, effective_at) values ($1, $2, $3, $4, $5, $1, 1, null, now())",
      [id, hash, JSON.stringify(doc), userId, strategist]);
    return { id, existed: false, effectiveAt: new Date().toISOString() };
  }
  const par = (await q.query("select id, user_id, coalesce(family, id) as family from strategies where id = $1", [parentId])) as { id: string; user_id: string; family: string }[];
  if (!par[0]) throw new Error("The version you started from does not exist.");
  if (par[0].user_id !== userId) throw new Error("Only the strategist who published this strategy can publish a new version of it.");
  const vs = withStatus(await rows("coalesce(family, id) = $1", [par[0].family]));
  const cur = vs.find((x) => x.status === "current");
  const sched = vs.find((x) => x.status === "scheduled");
  if (sched) throw new Error(`Version ${sched.version} is already scheduled for ${sched.effectiveAt.slice(0, 10)}. Withdraw it before publishing another.`);
  if (!cur) throw new Error("This strategy has no version in force.");
  const version = Math.max(...vs.map((x) => x.version)) + 1;
  const effectiveAt = new Date(Date.now() + cur.doc.noticeDays * 86_400_000).toISOString();
  await q.query("insert into strategies (id, hash, doc, user_id, strategist, family, version, parent, effective_at, listed) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
    [id, hash, JSON.stringify(doc), userId, strategist, par[0].family, version, cur.id, effectiveAt, cur.listed]);
  return { id, existed: false, effectiveAt, version };
}

/** The strategist withdraws a version that has not taken effect yet. */
export async function withdrawScheduled(id: string, userId: string) {
  await ensureSchema();
  const r = (await sql().query("delete from strategies where id = $1 and user_id = $2 and effective_at > now() and version > 1 returning id", [id, userId])) as { id: string }[];
  if (!r.length) throw new Error("Only a version that has not taken effect yet can be withdrawn, by its strategist.");
}

/** List or unlist a whole family (its links keep working). */
export async function setListed(family: string, userId: string, listed: boolean) {
  await ensureSchema();
  const r = (await sql().query("update strategies set listed = $3 where coalesce(family, id) = $1 and user_id = $2 returning id", [family, userId, listed])) as { id: string }[];
  if (!r.length) throw new Error("Only the strategist can change this.");
}

export async function ownerOf(id: string): Promise<string | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const r = (await sql().query("select user_id from strategies where id = $1", [id])) as { user_id: string }[];
  return r[0]?.user_id ?? null;
}

// ---------------------------------------------------------------------------
// strategists
// ---------------------------------------------------------------------------
export interface StrategistView { address: string; by: "dawns" | "strategist"; since: string; families: Family[] }
export async function getStrategist(address: string): Promise<StrategistView | null> {
  if (address === "dawns") return { address, by: "dawns", since: "2026-09-28", families: REFERENCE.map((r) => ({ current: r, next: null, versions: [r] })) };
  if (!hasDb()) return null;
  const fams = byFamily(await rows("strategist = $1", [address])).map(familyOf).filter((x): x is Family => !!x);
  if (!fams.length) return null;
  const since = fams.flatMap((f) => f.versions.map((v) => v.createdAt)).sort()[0];
  return { address, by: "strategist", since, families: fams };
}
export async function listStrategists(): Promise<{ address: string; strategies: number; versions: number }[]> {
  const out = [{ address: "dawns", strategies: REFERENCE.length, versions: REFERENCE.length }];
  if (!hasDb()) return out;
  try {
    await ensureSchema();
    const r = (await sql().query("select strategist as address, count(distinct coalesce(family, id))::int as strategies, count(*)::int as versions from strategies where listed group by strategist order by min(created_at)")) as { address: string; strategies: number; versions: number }[];
    return [...out, ...r];
  } catch { return out; }
}

// ---------------------------------------------------------------------------
// daily evaluation: the record a strategist is judged on until vaults run the strategy
// ---------------------------------------------------------------------------
export async function recordStrategyDaily(ev: (doc: StrategyDoc) => { net: number | null; gross: number | null; exitNow: number; status: string }) {
  await ensureSchema();
  const day = new Date().toISOString().slice(0, 10);
  const q = sql();
  const done = (await q.query("select count(*)::int as n from strategy_daily where day = $1", [day])) as { n: number }[];
  if ((done[0]?.n ?? 0) > 0) return "already recorded today";
  const fams = [...REFERENCE.map((r) => ({ current: r })), ...byFamily(await rows("true", [])).map(familyOf).filter((x): x is Family => !!x)];
  for (const f of fams) {
    const e = ev(f.current.doc);
    await q.query("insert into strategy_daily (day, family, id, net, gross, exit_now, status) values ($1, $2, $3, $4, $5, $6, $7) on conflict do nothing",
      [day, f.current.family, f.current.id, e.net, e.gross, e.exitNow, e.status]);
  }
  return `${fams.length} strategies`;
}

export async function dailyOf(families: string[]): Promise<{ day: string; family: string; id: string; net: number | null; exit: number; status: string }[]> {
  if (!hasDb() || !families.length) return [];
  try {
    await ensureSchema();
    const r = (await sql().query("select day, family, id, net, exit_now, status from strategy_daily where family = any($1) and day > now() - interval '180 days' order by day", [families])) as { day: string; family: string; id: string; net: number | null; exit_now: number; status: string }[];
    return r.map((x) => ({ day: iso(x.day).slice(0, 10), family: x.family, id: x.id, net: x.net, exit: x.exit_now, status: x.status }));
  } catch { return []; }
}
