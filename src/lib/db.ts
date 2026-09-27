import "server-only";
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

/** Neon Postgres: dawns' own history. Connected through Vercel Storage (DATABASE_URL). */
const URL = process.env.DATABASE_URL ?? process.env.POSTGRES_URL ?? null;
export const hasDb = () => !!URL;

let _sql: NeonQueryFunction<false, false> | null = null;
export function sql() {
  if (!URL) throw new Error("DATABASE_URL is not set");
  _sql ??= neon(URL);
  return _sql;
}

const SCHEMA = [
  `create table if not exists snapshots (
    taken_at timestamptz primary key, kas_usd double precision, eco_tvl double precision, dex_liq double precision,
    igra_block bigint, kasplex_block bigint, build_ms int, errors jsonb)`,
  `create table if not exists protocol_metrics (
    taken_at timestamptz not null, protocol text not null, tvl double precision, llama_tvl double precision,
    borrowed double precision, source text, status text, primary key (protocol, taken_at))`,
  `create table if not exists market_metrics (
    taken_at timestamptz not null, protocol text not null, market text not null,
    supplied_usd double precision, borrowed_usd double precision, cash_usd double precision, util double precision,
    supply_apy double precision, borrow_apr double precision, oracle_price double precision, market_price double precision,
    oracle_ok boolean, frozen boolean, primary key (protocol, market, taken_at))`,
  `create table if not exists pool_metrics (
    taken_at timestamptz not null, protocol text not null, chain text not null, pair text not null,
    symbols text, usd double precision, reserve0 double precision, reserve1 double precision, primary key (pair, taken_at))`,
  `create table if not exists bridge_metrics (
    taken_at timestamptz primary key, igra_block bigint, locked_kas double precision, ikas_supply double precision,
    coverage double precision, in_window_kas double precision, exits_total int, total_burned_kas double precision)`,
  `create table if not exists signals_log (
    key text primary key, protocol text, severity text not null, rule text, strong text, rest text,
    first_seen timestamptz not null, last_seen timestamptz not null, resolved_at timestamptz)`,
  `create table if not exists telegram_chats (
    chat_id bigint primary key, title text, daily boolean not null default false, created_at timestamptz not null default now())`,
  `create table if not exists telegram_subs (
    chat_id bigint not null references telegram_chats(chat_id) on delete cascade, protocol text not null,
    created_at timestamptz not null default now(), primary key (chat_id, protocol))`,
  `create table if not exists alerts_sent (
    chat_id bigint not null, signal_key text not null, kind text not null, sent_at timestamptz not null default now())`,
  `create index if not exists alerts_sent_idx on alerts_sent (chat_id, signal_key, sent_at desc)`,
  `create index if not exists protocol_metrics_t on protocol_metrics (taken_at)`,
  `create table if not exists meta (k text primary key, v text not null)`,
];

let ready: Promise<void> | null = null;
/** Create tables once per server instance. Every statement is idempotent. */
export function ensureSchema() {
  ready ??= (async () => {
    const q = sql();
    for (const s of SCHEMA) await q.query(s);
  })().catch((e) => { ready = null; throw e; });
  return ready;
}

/** Insert many rows in one round trip: rows travel as one JSON parameter. */
export async function insertJson(table: string, cols: [string, string][], rows: Record<string, unknown>[], conflict = "on conflict do nothing") {
  if (!rows.length) return;
  const names = cols.map((c) => c[0]).join(", ");
  const defs = cols.map(([n, t]) => `${n} ${t}`).join(", ");
  await sql().query(`insert into ${table} (${names}) select ${names} from jsonb_to_recordset($1::jsonb) as t(${defs}) ${conflict}`, [JSON.stringify(rows)]);
}

export async function getMeta(k: string) {
  const r = (await sql().query("select v from meta where k = $1", [k])) as { v: string }[];
  return r[0]?.v ?? null;
}
export async function setMeta(k: string, v: string) {
  await sql().query("insert into meta (k, v) values ($1, $2) on conflict (k) do update set v = excluded.v", [k, v]);
}
