import "server-only";
import { parseAbiItem, type Address } from "viem";
import { clients, type ChainKey } from "./chain/clients";
import { KASKAD } from "./chain/kaskad";
import { IGRA_BRIDGE } from "./chain/bridge";
import { sql, insertJson, getMeta, setMeta } from "./db";
import type { PoolView, Snapshot } from "./types";

/* =====================================================================
 * 1. Contract events: DEX swaps and liquidity removals, Kaskad flows.
 *    Reads logs block range by block range; a cursor per chain in `meta`.
 * ===================================================================== */

const EV = {
  v2Swap: parseAbiItem("event Swap(address indexed sender, uint256 amount0In, uint256 amount1In, uint256 amount0Out, uint256 amount1Out, address indexed to)"),
  // ZealousSwap pairs emit the V2 Swap with an extra bool (topic 0x697a7825…)
  zSwap: parseAbiItem("event Swap(address indexed sender, uint256 amount0In, uint256 amount1In, uint256 amount0Out, uint256 amount1Out, address indexed to, bool flag)"),
  v3Swap: parseAbiItem("event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)"),
  v2Burn: parseAbiItem("event Burn(address indexed sender, uint256 amount0, uint256 amount1, address indexed to)"),
  sync: parseAbiItem("event Sync(uint112 reserve0, uint112 reserve1)"),
  v3Burn: parseAbiItem("event Burn(address indexed owner, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount, uint256 amount0, uint256 amount1)"),
};
const LEND = {
  supply: parseAbiItem("event Supply(address indexed reserve, address user, address indexed onBehalfOf, uint256 amount, uint16 indexed referralCode)"),
  withdraw: parseAbiItem("event Withdraw(address indexed reserve, address indexed user, address indexed to, uint256 amount)"),
  borrow: parseAbiItem("event Borrow(address indexed reserve, address user, address indexed onBehalfOf, uint256 amount, uint8 interestRateMode, uint256 borrowRate, uint16 indexed referralCode)"),
  repay: parseAbiItem("event Repay(address indexed reserve, address indexed user, address indexed repayer, uint256 amount, bool useATokens)"),
  liquidation: parseAbiItem("event LiquidationCall(address indexed collateralAsset, address indexed debtAsset, address indexed user, uint256 debtToCover, uint256 liquidatedCollateralAmount, address liquidator, bool receiveAToken)"),
};

const INDEX_VERSION = "3";      // 2: ZealousSwap swap event · 3: Sync for fee samples
const CHUNK = 50_000;          // blocks per getLogs call (both RPCs answer 50k in < 0.5 s)
const MAX_CHUNKS = 12;         // per chain per tick; a 7-day backfill finishes in one or two ticks
const BACKFILL_SEC = 7 * 86_400;

type PoolRef = { protocol: string; pool: PoolView };
const low = (a: string) => a.toLowerCase();

function poolIndex(s: Snapshot, chain: ChainKey) {
  const m = new Map<string, PoolRef>();
  for (const p of s.protocols) for (const pool of p.dex?.pools ?? []) if (pool.chain === chain) m.set(low(pool.pair), { protocol: p.id, pool });
  return m;
}
const amt = (raw: bigint, d: number) => Number(raw) / 10 ** d;
const abs = (x: bigint) => (x < BigInt(0) ? -x : x);

/** USD of a two-sided amount: the priced side, doubled when only one side has a price (removals). */
function valueBoth(pool: PoolView, a0: number, a1: number) {
  const [x, y] = pool.tk;
  if (x.px != null && y.px != null) return a0 * x.px + a1 * y.px;
  if (x.px != null) return 2 * a0 * x.px;
  if (y.px != null) return 2 * a1 * y.px;
  return 0;
}
/** USD of a swap: the priced leg only (value traded, counted once). */
function valueOne(pool: PoolView, a0: number, a1: number) {
  const [x, y] = pool.tk;
  if (x.px != null) return a0 * x.px;
  if (y.px != null) return a1 * y.px;
  return 0;
}

export async function indexEvents(s: Snapshot) {
  const out: Record<string, string> = {};
  for (const chain of ["igra", "kasplex"] as ChainKey[]) {
    try { out[chain] = await indexChain(s, chain); } catch (e) { out[chain] = `error: ${(e as Error).message.slice(0, 160)}`; }
  }
  return out;
}

async function indexChain(s: Snapshot, chain: ChainKey) {
  const c = clients[chain];
  const pools = poolIndex(s, chain);
  const kaskad = chain === "igra" ? s.protocols.find((p) => p.id === "kaskad" && p.lending) : undefined;
  const markets = new Map((kaskad?.lending?.markets ?? []).map((m) => [low(m.asset), m]));
  const head = await c.getBlock();
  const latest = Number(head.number);
  const key = `idx:${chain}`;
  let from: number;
  // bump INDEX_VERSION when the event set changes: the chain is re-read from the backfill start
  const fresh = (await getMeta(`idx_version:${chain}`)) === INDEX_VERSION;
  const cur = fresh ? await getMeta(key) : null;
  if (cur) from = Number(cur) + 1;
  else {
    const past = await c.getBlock({ blockNumber: BigInt(Math.max(1, latest - 100_000)) });
    const spb = Number(head.timestamp - past.timestamp) / Number(head.number - past.number) || 1;
    from = Math.max(1, latest - Math.round(BACKFILL_SEC / spb));
    const start = await c.getBlock({ blockNumber: BigInt(from) });
    await setMeta(`idx_start:${chain}`, String(Number(start.timestamp) * 1000));
    await setMeta(`idx_version:${chain}`, INDEX_VERSION);
  }
  let chunks = 0, dexRows = 0, lendRows = 0;
  while (from <= latest && chunks < MAX_CHUNKS) {
    const to = Math.min(from + CHUNK - 1, latest);
    const [bf, bt] = await Promise.all([c.getBlock({ blockNumber: BigInt(from) }), c.getBlock({ blockNumber: BigInt(to) })]);
    const tf = Number(bf.timestamp), tt = Number(bt.timestamp);
    const when = (bn: bigint) => new Date((to === from ? tf : tf + ((Number(bn) - from) / (to - from)) * (tt - tf)) * 1000).toISOString();
    const range = { fromBlock: BigInt(from), toBlock: BigInt(to) };

    const [dexLogs, lendLogs] = await Promise.all([
      pools.size ? c.getLogs({ events: [EV.v2Swap, EV.zSwap, EV.v3Swap, EV.v2Burn, EV.v3Burn, EV.sync], ...range }) : Promise.resolve([]),
      kaskad ? c.getLogs({ address: KASKAD.pool, events: Object.values(LEND), ...range }) : Promise.resolve([]),
    ]);

    const dex: Record<string, unknown>[] = [];
    const fees: Record<string, unknown>[] = [];
    const syncs = new Map<string, { r0: bigint; r1: bigint }>();
    for (const l of dexLogs) if (l.eventName === "Sync" && l.transactionHash && l.logIndex != null) { const a = (l.args ?? {}) as { reserve0?: bigint; reserve1?: bigint }; if (a.reserve0 != null && a.reserve1 != null) syncs.set(`${l.transactionHash}:${l.logIndex}:${low(l.address)}`, { r0: a.reserve0, r1: a.reserve1 }); }
    for (const l of dexLogs) {
      const ref = pools.get(low(l.address));
      if (!ref || !l.transactionHash || l.logIndex == null || l.blockNumber == null) continue;
      const { pool, protocol } = ref;
      const [d0, d1] = [pool.tk[0].d, pool.tk[1].d];
      const a = (l.args ?? {}) as Record<string, bigint>;
      let usd = 0, kind = "swap";
      if (l.eventName === "Swap" && "amount0In" in a) {
        usd = valueOne(pool, amt(a.amount0In + a.amount0Out, d0), amt(a.amount1In + a.amount1Out, d1));
        // UniV2 emits Sync (post-swap reserves) right before Swap: pre-swap reserves give the fee this swap paid
        const sy = syncs.get(`${l.transactionHash}:${l.logIndex - 1}:${low(l.address)}`);
        const zero = BigInt(0);
        if (sy) {
          let f: number | null = null;
          if (a.amount0In > zero && a.amount1Out > zero && a.amount1In === zero && a.amount0Out === zero) {
            const rin = Number(sy.r0 - a.amount0In), rout = Number(sy.r1 + a.amount1Out);
            f = 1 - (Number(a.amount1Out) * rin) / (Number(a.amount0In) * (rout - Number(a.amount1Out)));
          } else if (a.amount1In > zero && a.amount0Out > zero && a.amount0In === zero && a.amount1Out === zero) {
            const rin = Number(sy.r1 - a.amount1In), rout = Number(sy.r0 + a.amount0Out);
            f = 1 - (Number(a.amount0Out) * rin) / (Number(a.amount1In) * (rout - Number(a.amount0Out)));
          }
          if (f != null && Number.isFinite(f) && f >= 0 && f < 0.1 && usd >= 1) fees.push({ chain, tx: l.transactionHash, log_index: l.logIndex, t: when(l.blockNumber), protocol, pair: low(l.address), fee: f });
        }
      }
      else if (l.eventName === "Swap" && "amount0" in a) usd = valueOne(pool, amt(abs(a.amount0), d0), amt(abs(a.amount1), d1));
      else if (l.eventName === "Burn" && "amount0" in a) { kind = "remove"; usd = valueBoth(pool, amt(a.amount0, d0), amt(a.amount1, d1)); }
      else continue;
      if (!(usd > 0) || !Number.isFinite(usd)) continue;
      dex.push({ chain, tx: l.transactionHash, log_index: l.logIndex, block: Number(l.blockNumber), t: when(l.blockNumber), protocol, pair: low(l.address), kind, usd, label: pool.symbols.join("/") });
    }
    const lend: Record<string, unknown>[] = [];
    for (const l of lendLogs) {
      if (!l.transactionHash || l.logIndex == null || l.blockNumber == null) continue;
      const a = (l.args ?? {}) as Record<string, unknown>;
      const kind = ({ Supply: "supply", Withdraw: "withdraw", Borrow: "borrow", Repay: "repay", LiquidationCall: "liquidation" } as Record<string, string>)[l.eventName ?? ""];
      if (!kind) continue;
      const asset = String(kind === "liquidation" ? a.debtAsset : a.reserve);
      const m = markets.get(low(asset));
      if (!m) continue;
      const raw = (kind === "liquidation" ? a.debtToCover : a.amount) as bigint;
      const amount = amt(raw, m.decimals);
      const px = m.suppliedUsd && m.supplied ? m.suppliedUsd / m.supplied : m.price;
      const account = String(kind === "supply" || kind === "borrow" ? a.onBehalfOf : a.user);
      lend.push({ chain, tx: l.transactionHash, log_index: l.logIndex, block: Number(l.blockNumber), t: when(l.blockNumber), protocol: "kaskad", kind, market: m.symbol, account, amount, usd: amount * px });
    }
    await insertJson("dex_events", [["chain", "text"], ["tx", "text"], ["log_index", "int"], ["block", "bigint"], ["t", "timestamptz"], ["protocol", "text"], ["pair", "text"], ["kind", "text"], ["usd", "float8"], ["label", "text"]], dex);
    await insertJson("lending_events", [["chain", "text"], ["tx", "text"], ["log_index", "int"], ["block", "bigint"], ["t", "timestamptz"], ["protocol", "text"], ["kind", "text"], ["market", "text"], ["account", "text"], ["amount", "float8"], ["usd", "float8"]], lend);
    await insertJson("fee_samples", [["chain", "text"], ["tx", "text"], ["log_index", "int"], ["t", "timestamptz"], ["protocol", "text"], ["pair", "text"], ["fee", "float8"]], fees);
    await setMeta(key, String(to));
    await setMeta(`idx_at:${chain}`, String(tt * 1000));
    dexRows += dex.length; lendRows += lend.length; chunks++;
    from = to + 1;
  }
  return `${chunks} chunks, ${dexRows} dex + ${lendRows} lending events, ${Math.max(0, latest - from + 1)} blocks behind`;
}

/* =====================================================================
 * 2. Igra bridge exits (Blockscout decoded calls) and their L1 payouts.
 * ===================================================================== */

type BsTx = { hash: string; timestamp: string; block_number?: number; block?: number; status: string; method: string | null; decoded_input?: { parameters: { name: string; value: string }[] } };

export async function indexBridgeExits(s: Snapshot) {
  const q = sql();
  const known = new Set(((await q.query("select tx from bridge_exits")) as { tx: string }[]).map((r) => r.tx));
  const base = `${IGRA_BRIDGE.blockscout}/api/v2/addresses/${IGRA_BRIDGE.exitBridge}/transactions`;
  let params: Record<string, string | number> | null = { filter: "to" };
  let added = 0, pages = 0;
  while (params && pages < 20) {
    const url = `${base}?${new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]))}`;
    const r = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(15_000), headers: { accept: "application/json" } });
    if (!r.ok) throw new Error(`Blockscout ${r.status}`);
    const j = (await r.json()) as { items: BsTx[]; next_page_params: Record<string, string | number> | null };
    pages++;
    const rows = j.items
      .filter((t) => t.status === "ok" && t.method === "requestExit" && !known.has(t.hash))
      .map((t) => {
        const p = Object.fromEntries((t.decoded_input?.parameters ?? []).map((x) => [x.name, x.value]));
        return { tx: t.hash, block: t.block_number ?? t.block ?? 0, requested_at: t.timestamp, payout_address: String(p.kasPayoutAddress ?? ""), amount_sompi: Number(p.unlockAmountSompi ?? 0) };
      })
      .filter((r) => r.payout_address.startsWith("kaspa:") && r.amount_sompi > 0);
    await insertJson("bridge_exits", [["tx", "text"], ["block", "bigint"], ["requested_at", "timestamptz"], ["payout_address", "text"], ["amount_sompi", "bigint"]], rows);
    added += rows.length;
    if (j.items.every((t) => known.has(t.hash))) break;
    params = j.next_page_params;
  }
  // attach contract request ids where the reader saw them (same block, same amount)
  for (const e of s.bridge?.recentExits ?? [])
    await q.query("update bridge_exits set request_id = $1 where request_id is null and block = $2 and amount_sompi = $3", [e.id, e.block, Math.round(e.kas * 1e8)]);
  return `${added} new exits (${pages} pages)`;
}

type KasTx = {
  transaction_id: string; block_time: number; is_accepted: boolean;
  inputs: { previous_outpoint_address?: string }[] | null;
  outputs: { amount: number; script_public_key_address: string; index?: number }[] | null;
};

/**
 * An exit is paid when a Kaspa L1 transaction spends coins from the bridge Entry
 * address and sends exactly the unlock amount to the exit's payout address.
 */
export async function checkPayouts(limit = 60) {
  const q = sql();
  const due = (await q.query(
    `select tx, payout_address, amount_sompi::text as amount, extract(epoch from requested_at) * 1000 as at from bridge_exits
     where paid_tx is null and requested_at < now() - interval '2 minutes'
       and (last_checked is null or last_checked < now() - interval '20 minutes')
       and (requested_at > now() - interval '30 days' or checks < 3)
     order by last_checked asc nulls first, requested_at desc limit $1`, [limit])) as { tx: string; payout_address: string; amount: string; at: number }[];
  const byAddr = new Map<string, typeof due>();
  for (const d of due) byAddr.set(d.payout_address, [...(byAddr.get(d.payout_address) ?? []), d]);
  let paid = 0;
  for (const [addr, exits] of byAddr) {
    const earliest = Math.min(...exits.map((e) => Number(e.at))) - 3600_000;
    const txs: KasTx[] = [];
    for (let page = 0; page < 4; page++) {
      const r = await fetch(`${IGRA_BRIDGE.kaspaApi}/addresses/${addr}/full-transactions?limit=50&offset=${page * 50}&resolve_previous_outpoints=light`, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
      if (!r.ok) break;
      const batch = (await r.json()) as KasTx[];
      txs.push(...batch);
      if (batch.length < 50 || Math.min(...batch.map((t) => t.block_time)) < earliest) break;
    }
    const taken = (await q.query("select paid_tx, paid_sompi::text as amount from bridge_exits where payout_address = $1 and paid_tx is not null", [addr])) as { paid_tx: string; amount: string }[];
    const outs = txs
      .filter((t) => t.is_accepted !== false && (t.inputs ?? []).some((i) => i.previous_outpoint_address === IGRA_BRIDGE.entry))
      .flatMap((t) => (t.outputs ?? []).filter((o) => o.script_public_key_address === addr).map((o) => ({ tx: t.transaction_id, at: t.block_time, amount: String(o.amount) })))
      .sort((a, b) => a.at - b.at);
    // one L1 transaction can pay several exits: remove only the outputs already assigned
    for (const t of taken) { const i = outs.findIndex((o) => o.tx === t.paid_tx && o.amount === t.amount); if (i >= 0) outs.splice(i, 1); }
    const sorted = [...exits].sort((a, b) => Number(a.at) - Number(b.at));
    const hits = new Map<string, (typeof outs)[number]>();
    // pass 1: exact amount; pass 2: a smaller payout (the committee sometimes pays less, e.g. after a fee)
    for (const exact of [true, false])
      for (const e of sorted) {
        if (hits.has(e.tx)) continue;
        const want = Number(e.amount);
        const hit = outs.find((o) => o.at >= Number(e.at) - 600_000 && (exact ? o.amount === e.amount : Number(o.amount) < want && Number(o.amount) >= want * 0.5));
        if (hit) { hits.set(e.tx, hit); outs.splice(outs.indexOf(hit), 1); }
      }
    for (const e of sorted) {
      const hit = hits.get(e.tx);
      if (hit) {
        await q.query("update bridge_exits set paid_tx = $2, paid_at = to_timestamp($3 / 1000.0), paid_sompi = $4, last_checked = now(), checks = checks + 1 where tx = $1", [e.tx, hit.tx, hit.at, hit.amount]);
        paid++;
      } else await q.query("update bridge_exits set last_checked = now(), checks = checks + 1 where tx = $1", [e.tx]);
    }
  }
  return `${due.length} checked, ${paid} matched to L1 payouts`;
}

export type { Address };

/* =====================================================================
 * 3. Kaskad accounts and their positions (health factor, bad debt).
 *    Accounts come from every Supply/Borrow since the pool launched;
 *    positions from Pool.getUserAccountData, all accounts every run.
 * ===================================================================== */
const balAbi = [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ name: "", type: "uint256" }] }] as const;

export async function indexKaskadAccounts() {
  const c = clients.igra;
  const latest = Number(await c.getBlockNumber());
  let cur = await getMeta("acct:kaskad");
  if (cur == null) {
    // first run: find the block the Pool was deployed at (binary search on code), start there
    let lo = 0, hi = latest;
    while (hi - lo > 1000) { const mid = Math.floor((lo + hi) / 2); const code = await c.getCode({ address: KASKAD.pool, blockNumber: BigInt(mid) }).catch(() => undefined); if (code && code !== "0x") hi = mid; else lo = mid; }
    cur = String(Math.max(0, lo - 1));
    await setMeta("acct:kaskad", cur);
  }
  let from = Number(cur) + 1;
  let chunks = 0, found = 0;
  while (from <= latest && chunks < 60) {
    const to = Math.min(from + CHUNK - 1, latest);
    const logs = await c.getLogs({ address: KASKAD.pool, events: [LEND.supply, LEND.borrow], fromBlock: BigInt(from), toBlock: BigInt(to) });
    const rows = new Map<string, number>();
    for (const l of logs) {
      const a = (l.args ?? {}) as { onBehalfOf?: string };
      if (a.onBehalfOf && l.blockNumber != null && !rows.has(a.onBehalfOf.toLowerCase())) rows.set(a.onBehalfOf.toLowerCase(), Number(l.blockNumber));
    }
    await insertJson("kaskad_accounts", [["address", "text"], ["first_block", "bigint"]], [...rows].map(([address, first_block]) => ({ address, first_block })));
    await setMeta("acct:kaskad", String(to));
    found += rows.size; chunks++; from = to + 1;
  }
  return `${chunks} chunks, ${found} account sightings, ${Math.max(0, latest - from + 1)} blocks behind`;
}

/**
 * Every account's Kaskad position from its aToken and variable-debt balances, valued at the prices
 * the snapshot uses (oracle when it answers, market otherwise). Health factor as Aave computes it:
 * Σ collateral × liquidation threshold ÷ Σ debt. Assumes supplied assets count as collateral (the default).
 * Pool.getUserAccountData is not used because it reverts whenever Kaskad's oracle is stale.
 */
export async function readKaskadPositions(s: Snapshot) {
  const k = s.protocols.find((p) => p.id === "kaskad")?.lending;
  if (!k) return "no Kaskad read this run";
  const q = sql();
  const accts = ((await q.query("select address from kaskad_accounts")) as { address: string }[]).map((r) => r.address as Address);
  if (!accts.length) return "no accounts yet";
  const mk = k.markets.map((m) => ({ m, px: m.suppliedUsd && m.supplied ? m.suppliedUsd / m.supplied : m.price }));
  const rows: Record<string, unknown>[] = [];
  const now = new Date().toISOString();
  const per = mk.length * 2;
  const step = Math.max(1, Math.floor(400 / per));
  for (let i = 0; i < accts.length; i += step) {
    const batch = accts.slice(i, i + step);
    const calls = batch.flatMap((a) => mk.flatMap(({ m }) => [
      { address: m.aToken as Address, abi: balAbi, functionName: "balanceOf" as const, args: [a] as const },
      { address: m.debtToken as Address, abi: balAbi, functionName: "balanceOf" as const, args: [a] as const },
    ]));
    const res = await clients.igra.multicall({ contracts: calls, allowFailure: true });
    batch.forEach((a, bi) => {
      let coll = 0, weighted = 0, debt = 0, ok = true;
      mk.forEach(({ m, px }, mi) => {
        const [sup, bor] = [res[bi * per + mi * 2], res[bi * per + mi * 2 + 1]];
        if (sup.status !== "success" || bor.status !== "success") { ok = false; return; }
        const c = (Number(sup.result) / 10 ** m.decimals) * px, d = (Number(bor.result) / 10 ** m.decimals) * px;
        coll += c; weighted += c * m.liquidationThreshold; debt += d;
      });
      if (!ok) return;
      rows.push({ address: a.toLowerCase(), collateral_usd: coll, debt_usd: debt, hf: debt > 0.01 ? weighted / debt : null, lt: coll > 0 ? weighted / coll : null, updated_at: now });
    });
  }
  await insertJson("kaskad_positions",
    [["address", "text"], ["collateral_usd", "float8"], ["debt_usd", "float8"], ["hf", "float8"], ["lt", "float8"], ["updated_at", "timestamptz"]], rows,
    "on conflict (address) do update set collateral_usd = excluded.collateral_usd, debt_usd = excluded.debt_usd, hf = excluded.hf, lt = excluded.lt, updated_at = excluded.updated_at");
  return `${rows.length} of ${accts.length} positions read`;
}
