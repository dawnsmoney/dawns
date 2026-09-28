import "server-only";
import { sql, hasDb, ensureSchema } from "../db";
import { parseDoc, strategyHash, strategyId, DEFAULT_DOC, type StrategyDoc } from "./model";

/**
 * Where strategies come from: dawns' reference strategies (in code, so they are
 * reviewed like code) and the ones strategists publish (Neon, one row per hash).
 */
export interface StoredStrategy { id: string; hash: string; doc: StrategyDoc; strategist: string; by: "dawns" | "strategist"; createdAt: string }

const ref = (d: Partial<StrategyDoc> & Pick<StrategyDoc, "name" | "thesis" | "legs" | "reserveBps">): StoredStrategy => {
  const p = parseDoc({ ...DEFAULT_DOC, ...d, vault: { ...DEFAULT_DOC.vault, ...d.vault }, fees: { ...DEFAULT_DOC.fees, ...d.fees } });
  if ("error" in p) throw new Error(`reference strategy ${d.name}: ${p.error}`);
  return { id: strategyId(p.doc), hash: strategyHash(p.doc), doc: p.doc, strategist: "dawns", by: "dawns", createdAt: "2026-09-28" };
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
];

type Row = { id: string; hash: string; doc: unknown; strategist: string; created_at: string };
const fromRow = (r: Row): StoredStrategy | null => {
  const p = parseDoc(r.doc);
  return "error" in p || strategyHash(p.doc) !== r.hash ? null : { id: r.id, hash: r.hash, doc: p.doc, strategist: r.strategist, by: "strategist", createdAt: String(r.created_at).slice(0, 10) };
};

export async function listStrategies(): Promise<StoredStrategy[]> {
  if (!hasDb()) return REFERENCE;
  try {
    await ensureSchema();
    const rows = (await sql().query("select id, hash, doc, strategist, created_at from strategies where listed order by created_at desc limit 200")) as Row[];
    return [...REFERENCE, ...rows.map(fromRow).filter((x): x is StoredStrategy => !!x)];
  } catch { return REFERENCE; }
}

export async function getStrategy(id: string): Promise<StoredStrategy | null> {
  const r = REFERENCE.find((s) => s.id === id);
  if (r) return r;
  if (!hasDb() || !/^[0-9a-f]{12}$/.test(id)) return null;
  await ensureSchema();
  const rows = (await sql().query("select id, hash, doc, strategist, created_at from strategies where id = $1", [id])) as Row[];
  return rows[0] ? fromRow(rows[0]) : null;
}

/** Publish: the document is re-parsed and re-hashed here; the client's hash is never trusted. */
export async function publishStrategy(doc: StrategyDoc, userId: string, strategist: string) {
  const hash = strategyHash(doc), id = hash.slice(0, 12);
  if (REFERENCE.some((s) => s.id === id)) return { id, existed: true };
  await ensureSchema();
  const n = (await sql().query("select count(*)::int as n from strategies where user_id = $1", [userId])) as { n: number }[];
  if ((n[0]?.n ?? 0) >= 20) throw new Error("20 strategies per strategist for now.");
  const r = (await sql().query("insert into strategies (id, hash, doc, user_id, strategist) values ($1, $2, $3, $4, $5) on conflict (id) do nothing returning id",
    [id, hash, JSON.stringify(doc), userId, strategist])) as { id: string }[];
  return { id, existed: !r.length };
}
