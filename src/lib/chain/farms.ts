import "server-only";
import { parseAbi, type Address } from "viem";
import { clients, type ChainKey } from "./clients";

/**
 * ZealousSwap farm on Igra: a MasterChef-style contract (not verified on the explorer;
 * functions matched from its bytecode selectors). Users stake LP tokens of ZealousSwap
 * pools and earn ZEAL at `rewardPerBlock`, split between pools by allocation points.
 *
 * What dawns reads: the emission rate, each pool's LP token, allocation and LP staked,
 * the ZEAL the farm holds, the emergency-withdraw fee and locking period, the owner,
 * and every rate change (setRewardPerBlock transactions, from the explorer).
 */
export const ZEALOUS_FARM: { chain: ChainKey; address: Address; explorer: string } = {
  chain: "igra", address: "0x6D8a29939FcF416083905214641bA6e870e7CFdf", explorer: "https://explorer.igralabs.com",
};

const farmAbi = parseAbi([
  "function poolLength() view returns (uint256)",
  "function totalAllocPoint() view returns (uint256)",
  "function rewardPerBlock() view returns (uint256)",
  "function rewardToken() view returns (address)",
  "function lockingPeriod() view returns (uint256)",
  "function emergencyWithdrawFeeBP() view returns (uint256)",
  "function owner() view returns (address)",
  "function poolInfo(uint256) view returns (address lpToken, uint256 allocPoint, uint256 lastRewardBlock, uint256 accRewardPerShare, uint256 totalStaked, bool active, uint256 extra)",
]);
const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)", "function totalSupply() view returns (uint256)", "function decimals() view returns (uint8)"]);
const SET_RATE = "0xbb872b4a"; // setRewardPerBlock(uint256)

export interface FarmRead {
  chain: ChainKey; address: string; owner: string; rewardToken: string; rewardDecimals: number;
  perBlock: number; blockSec: number; block: number; budget: number;
  lockSec: number; emergencyFeeBps: number;
  pools: { lp: string; alloc: number; staked: number; lpSupply: number; active: boolean }[];
  history: { t: number; block: number; perBlock: number }[] | null;   // null: the explorer could not be read
}

export async function readZealousFarm(): Promise<FarmRead> {
  const { chain, address } = ZEALOUS_FARM;
  const c = clients[chain];
  const call = <T,>(functionName: string, args: unknown[] = []) => c.readContract({ address, abi: farmAbi, functionName: functionName as never, args: args as never }) as Promise<T>;
  const [n, rate, token, lock, fee, owner, head] = await Promise.all([
    call<bigint>("poolLength"), call<bigint>("rewardPerBlock"), call<Address>("rewardToken"),
    call<bigint>("lockingPeriod"), call<bigint>("emergencyWithdrawFeeBP"), call<Address>("owner"), c.getBlock(),
  ]);
  const [dec, bal, past] = await Promise.all([
    c.readContract({ address: token, abi: erc20, functionName: "decimals" }),
    c.readContract({ address: token, abi: erc20, functionName: "balanceOf", args: [address] }),
    c.getBlock({ blockNumber: head.number - BigInt(100_000) }),
  ]);
  const blockSec = Number(head.timestamp - past.timestamp) / 100_000;
  const infos = await Promise.all(Array.from({ length: Number(n) }, (_, i) => call<readonly [Address, bigint, bigint, bigint, bigint, boolean, bigint]>("poolInfo", [BigInt(i)])));
  const pools = await Promise.all(infos.map(async ([lp, alloc, , , staked, active]) => {
    const [sup, d] = await Promise.all([c.readContract({ address: lp, abi: erc20, functionName: "totalSupply" }), c.readContract({ address: lp, abi: erc20, functionName: "decimals" })]);
    return { lp: lp.toLowerCase(), alloc: Number(alloc), staked: Number(staked) / 10 ** d, lpSupply: Number(sup) / 10 ** d, active };
  }));
  return {
    chain, address, owner: owner.toLowerCase(), rewardToken: token.toLowerCase(), rewardDecimals: dec,
    perBlock: Number(rate) / 10 ** dec, blockSec, block: Number(head.number), budget: Number(bal) / 10 ** dec,
    lockSec: Number(lock), emergencyFeeBps: Number(fee), pools,
    history: await rateHistory(dec).catch(() => null),
  };
}

/** Every setRewardPerBlock call on the farm, oldest first (explorer, at most 20 pages of transactions). */
async function rateHistory(dec: number) {
  const out: { t: number; block: number; perBlock: number }[] = [];
  const base = `${ZEALOUS_FARM.explorer}/api/v2/addresses/${ZEALOUS_FARM.address}/transactions?filter=to`;
  let url: string | null = base;
  for (let i = 0; i < 20 && url; i++) {
    const r = await fetch(url, { signal: AbortSignal.timeout(8_000), next: { revalidate: 3600 } });
    if (!r.ok) throw new Error(`explorer ${r.status}`);
    const j = (await r.json()) as { items?: { timestamp: string; block_number: number; raw_input?: string; status?: string }[]; next_page_params?: Record<string, string> | null };
    for (const t of j.items ?? []) {
      if (t.status && t.status !== "ok") continue;
      if ((t.raw_input ?? "").startsWith(SET_RATE)) out.push({ t: Date.parse(t.timestamp), block: t.block_number, perBlock: Number(BigInt("0x" + t.raw_input!.slice(10, 74))) / 10 ** dec });
    }
    url = j.next_page_params ? `${base}&${new URLSearchParams(j.next_page_params).toString()}` : null;
  }
  return out.sort((a, b) => a.block - b.block);
}
