import "server-only";
import { parseAbi, type Address } from "viem";
import { clients, pool } from "./clients";
import type { BridgeExit, BridgeState } from "../types";
export type { BridgeExit, BridgeState };

/**
 * Igra canonical KAS bridge.
 * In:  KAS sent to the L1 Entry address (a P2SH multisig) is minted as iKAS on Igra.
 * Out: KasExitBridge.requestExit burns iKAS; the guardian committee releases KAS on L1 (48–72h).
 * Backing = KAS held by the Entry address ÷ iKAS in circulation on Igra.
 */
export const IGRA_BRIDGE = {
  entry: "kaspa:ppvnxxzm0rr37zpnwux2f2ntvfpr4uqdpm7zsvsztg3en92r7gs0wkmr72q9n",
  exitBridge: "0x4bb88C213d3eD9dc4bae694f1bc1bF745903b2d0" as Address,
  source: "https://github.com/argonmining/igra-kas-bridge",
  kaspaApi: "https://api.kaspa.org",
  blockscout: "https://explorer.igralabs.com",
} as const;

const exitAbi = parseAbi([
  "function getConfig() view returns (bytes32 kaspaBridgeEndpoint, address feePolicy, address feeClaimer, uint32 throttleWindowBlocks, uint32 throttleMaxExitsPerWindow, uint64 throttleMaxUnlockAmountPerWindowSompi, uint64 minExitSompi, uint64 maxExitSompi)",
  "function throttleStatus() view returns (uint32 windowIndex, uint32 windowEndsAtBlock, uint32 remainingExits, uint64 remainingUnlockAmountSompi)",
  "function nextExitRequestId() view returns (uint32)",
  "function getExitRequest(uint32 requestId) view returns (bool exists, uint32 recordedAtBlock, uint64 feeAmountSompi, uint64 unlockAmountSompi, bytes32 messageId)",
  "function totalBurned() view returns (uint256)",
  "function totalFeeCharged() view returns (uint256)",
  "function owner() view returns (address)",
]);

const SOMPI = 1e8;
const IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

async function getJson(url: string) {
  const r = await fetch(url, { next: { revalidate: 60 }, signal: AbortSignal.timeout(12_000), headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return r.text();
}

/** KAS held by the L1 Entry address. Parsed from text so large sompi values keep full precision. */
async function entryBalance() {
  const txt = await getJson(`${IGRA_BRIDGE.kaspaApi}/addresses/${IGRA_BRIDGE.entry}/balance`);
  const m = txt.match(/"balance"\s*:\s*"?(\d+)/);
  if (!m) throw new Error("Kaspa API: no balance field");
  return Number(BigInt(m[1]) / BigInt(1000)) / 1e5; // sompi → KAS without float overflow
}
async function entryTxCount() {
  const txt = await getJson(`${IGRA_BRIDGE.kaspaApi}/addresses/${IGRA_BRIDGE.entry}/transactions-count`);
  const m = txt.match(/"total"\s*:\s*(\d+)/);
  return m ? Number(m[1]) : null;
}
/** Native iKAS in circulation on Igra (Blockscout coin supply). */
async function ikasSupply() {
  const txt = await getJson(`${IGRA_BRIDGE.blockscout}/api?module=stats&action=coinsupply`);
  const j = JSON.parse(txt) as { result?: string } | string | number;
  const v = Number(typeof j === "object" && j !== null ? j.result : j);
  if (!Number.isFinite(v) || v <= 0) throw new Error("Blockscout: bad coin supply");
  return v;
}

export async function readIgraBridge(recent = 40): Promise<BridgeState> {
  const c = clients.igra;
  const addr = IGRA_BRIDGE.exitBridge;
  const block = await c.getBlock();
  const at = { blockNumber: block.number };
  const read = <T,>(functionName: string, args: unknown[] = []) =>
    c.readContract({ address: addr, abi: exitAbi, functionName: functionName as never, args: args as never, ...at }) as Promise<T>;

  const [locked, txCount, supply, cfg, thr, nextId, burned, fees, owner, implRaw, past] = await Promise.all([
    entryBalance(),
    entryTxCount().catch(() => null),
    ikasSupply(),
    read<readonly [string, Address, Address, number, number, bigint, bigint, bigint]>("getConfig"),
    read<readonly [number, number, number, bigint]>("throttleStatus"),
    read<number>("nextExitRequestId"),
    read<bigint>("totalBurned"),
    read<bigint>("totalFeeCharged"),
    read<Address>("owner"),
    c.getStorageAt({ address: addr, slot: IMPL_SLOT, ...at }),
    c.getBlock({ blockNumber: block.number > BigInt(100_000) ? block.number - BigInt(100_000) : BigInt(1) }),
  ]);
  const ownerCode = await c.getCode({ address: owner, ...at });
  const span = Number(block.number - past.number);
  const blockTimeSec = span > 0 ? Number(block.timestamp - past.timestamp) / span : 1;

  const n = Number(nextId);
  const ids = Array.from({ length: Math.min(recent, n) }, (_, i) => n - 1 - i).filter((i) => i >= 0);
  const rows = await pool(ids, 8, (id) => read<readonly [boolean, number, bigint, bigint, string]>("getExitRequest", [id]));
  const now = Number(block.number);
  const recentExits: BridgeExit[] = rows
    .map((r, i) => (r && r[0] ? { id: ids[i], block: Number(r[1]), ageSec: (now - Number(r[1])) * blockTimeSec, kas: Number(r[3]) / SOMPI, feeKas: Number(r[2]) / SOMPI } : null))
    .filter((x): x is BridgeExit => x !== null);
  const inWindow = recentExits.filter((e) => e.ageSec <= 72 * 3600);

  // totalBurned / totalFeeCharged are iKAS amounts in wei (18 decimals)
  const wei = (x: bigint) => Number(x / BigInt(1e10)) / 1e8;
  const impl = implRaw && BigInt(implRaw) !== BigInt(0) ? `0x${implRaw.slice(-40)}` : null;

  return {
    block: now, timestamp: Number(block.timestamp),
    lockedKas: locked, entryTxCount: txCount, ikasSupply: supply,
    coverage: locked / supply, surplusKas: locked - supply,
    totalBurnedKas: wei(burned), totalFeesKas: wei(fees),
    exitsTotal: n, recentExits,
    inWindowKas: inWindow.reduce((s, e) => s + e.kas, 0), inWindowCount: inWindow.length,
    blockTimeSec,
    config: {
      feePolicy: cfg[1], feeClaimer: cfg[2], windowBlocks: Number(cfg[3]), maxExitsPerWindow: Number(cfg[4]),
      maxUnlockPerWindowKas: Number(cfg[5]) / SOMPI, minExitKas: Number(cfg[6]) / SOMPI, maxExitKas: Number(cfg[7]) / SOMPI,
    },
    throttle: { windowEndsAtBlock: Number(thr[1]), remainingExits: Number(thr[2]), remainingUnlockKas: Number(thr[3]) / SOMPI },
    owner, ownerIsContract: !!ownerCode && ownerCode !== "0x", implementation: impl,
  };
}
