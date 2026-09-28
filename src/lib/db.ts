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
  // first-party product events: no cookies, no IP; user id only when signed in
  `create table if not exists app_events (t timestamptz not null default now(), name text not null, path text, user_id text, props jsonb)`,
  `create index if not exists app_events_t on app_events (t desc)`,
  `alter table app_events add column if not exists vid text`,
  // event index (dawns' own reads of contract logs)
  `create table if not exists dex_events (
    chain text not null, tx text not null, log_index int not null, block bigint not null, t timestamptz not null,
    protocol text not null, pair text not null, kind text not null, usd double precision not null, label text,
    primary key (chain, tx, log_index))`,
  `create index if not exists dex_events_pt on dex_events (protocol, t desc)`,
  // the fee each V2 swap actually paid, from its reserves just before the swap (Sync − swap amounts)
  `create table if not exists fee_samples (
    chain text not null, tx text not null, log_index int not null, t timestamptz not null, protocol text not null, pair text not null, fee double precision not null,
    primary key (chain, tx, log_index))`,
  `create table if not exists lending_events (
    chain text not null, tx text not null, log_index int not null, block bigint not null, t timestamptz not null,
    protocol text not null, kind text not null, market text not null, account text, amount double precision, usd double precision not null,
    primary key (chain, tx, log_index))`,
  `create index if not exists lending_events_pt on lending_events (protocol, t desc)`,
  // Igra bridge exits and their Kaspa L1 payouts
  `create table if not exists bridge_exits (
    tx text primary key, request_id int, block bigint not null, requested_at timestamptz not null,
    payout_address text not null, amount_sompi bigint not null,
    paid_tx text, paid_at timestamptz, paid_sompi bigint, last_checked timestamptz, checks int not null default 0)`,
  `create index if not exists bridge_exits_open on bridge_exits (paid_tx, last_checked)`,
  // accounts: a user is one or more wallets that signed in
  `create table if not exists users (id text primary key, created_at timestamptz not null default now())`,
  `create table if not exists wallets (
    address text primary key, kind text not null, user_id text not null references users(id) on delete cascade,
    created_at timestamptz not null default now(), last_seen timestamptz)`,
  `create table if not exists sessions (
    token_hash text primary key, user_id text not null references users(id) on delete cascade,
    created_at timestamptz not null default now(), expires_at timestamptz not null)`,
  `create table if not exists auth_nonces (
    nonce text primary key, address text not null, message text not null, expires_at timestamptz not null, used boolean not null default false)`,
  `create table if not exists profiles (
    user_id text primary key references users(id) on delete cascade, policy jsonb not null, updated_at timestamptz not null default now())`,
  `alter table profiles add column if not exists plan jsonb`,
  `alter table telegram_chats add column if not exists user_id text`,
  `create table if not exists watch_rules (
    user_id text not null references users(id) on delete cascade, protocol text not null, entry jsonb not null,
    updated_at timestamptz not null default now(), primary key (user_id, protocol))`,
  // every Kaskad account that ever supplied or borrowed, and its latest position
  `create table if not exists kaskad_accounts (address text primary key, first_block bigint not null)`,
  `create table if not exists kaskad_positions (
    address text primary key, collateral_usd double precision not null, debt_usd double precision not null,
    hf double precision, lt double precision, updated_at timestamptz not null)`,
  `create table if not exists telegram_links (token text primary key, user_id text not null, expires_at timestamptz not null)`,
  // alerts computed for one user's followed plan
  `create table if not exists user_signals (
    user_id text not null, key text not null, severity text not null, strong text not null, rest text,
    first_seen timestamptz not null, last_seen timestamptz not null, resolved_at timestamptz, primary key (user_id, key))`,
  // asset index: one normalized record per asset (chain:standard:ref), and a daily series
  `create table if not exists assets (
    id text primary key, chain text not null, standard text not null, symbol text not null, data jsonb not null,
    updated_at timestamptz not null default now())`,
  `create table if not exists asset_daily (
    id text not null, day date not null, price double precision, holders double precision, mcap double precision,
    vol24 double precision, supply double precision, primary key (id, day))`,
  // the top holders of that day: address, share of supply, holder kind (holder flow, wallet moves)
  `alter table asset_daily add column if not exists top jsonb`,
  // NAV vault accounts: the Kaspa addresses whose personal deposit/redeem accounts the keeper watches
  `create table if not exists vault_accounts (vault text not null, address text not null, created_at timestamptz not null default now(), primary key (vault, address))`,
  // vault ledgers the keeper publishes (signed by the vault's allocator key), newer than the one in git
  `create table if not exists vault_ledgers (vault text primary key, doc jsonb not null, updated_at timestamptz not null default now())`,
  // ZKas block producers: blocks sampled per payout address per day
  `create table if not exists zkas_producers (day date not null, producer text not null, blocks int not null, primary key (day, producer))`,
  // share cards: drafts picked daily (or made on demand) with their numbers frozen, reviewed in /admin/cards
  `create table if not exists card_drafts (
    id text primary key, day date not null, kind text not null, ref text not null, data jsonb not null, reading text not null,
    status text not null default 'draft', origin text not null default 'daily',
    created_at timestamptz not null default now(), updated_at timestamptz not null default now(), sent_at timestamptz,
    unique (day, kind, ref))`,
  // strategies strategists publish: content-addressed (hash of the canonical document), signed in with a wallet
  `create table if not exists strategies (
    id text primary key, hash text not null unique, doc jsonb not null, user_id text not null, strategist text not null,
    listed boolean not null default true, created_at timestamptz not null default now())`,
  // versions: a family of strategy versions; a new version takes effect after the notice of the one in force
  `alter table strategies add column if not exists family text`,
  `alter table strategies add column if not exists version int`,
  `alter table strategies add column if not exists parent text`,
  `alter table strategies add column if not exists effective_at timestamptz`,
  `update strategies set family = id, version = 1, effective_at = created_at where family is null`,
  // staking vaults' exchange rates, once a day: their yield, measured
  `create table if not exists infinity_rates (day date not null, chain text not null, vault text not null, rate double precision not null, primary key (day, chain, vault))`,
  // dawns' daily evaluation of each strategy's version in force (not realized returns)
  `create table if not exists strategy_daily (day date not null, family text not null, id text not null, net double precision, gross double precision,
    exit_now double precision, status text, primary key (day, family))`,
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
