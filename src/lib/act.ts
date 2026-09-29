import { encodeFunctionData, parseAbi, type Address, type Hex } from "viem";

/**
 * Taking an opportunity from dawns: what the wallet is asked to sign. Client-safe and pure,
 * so every call can be checked before a wallet sees it. dawns never holds funds: each call
 * goes from the user's wallet straight to the protocol's own contract.
 */

export type ActToken = { address: Address; symbol: string; decimals: number };
type Base = { oppId: string; chain: "igra" | "kasplex"; protocol: string; pname: string; app: string | null; name: string };
export type Trail = [string, string, string | null][];
export type ActPlan =
  | (Base & { mode: "supply"; pool: Address; tokens: [ActToken]; aToken: Address; wrap: Address | null; exitNowUsd: number | null; utilization: number; trail: Trail })
  | (Base & { mode: "lp"; pair: Address; router: Address; weth: Address | null; tokens: [ActToken, ActToken]; trail: Trail })
  | (Base & { mode: "app" | "blocked"; why: string; trail: Trail });

/** Networks as a wallet needs them to add or switch (EIP-3085). */
export const NETS = {
  igra: { chainId: 38833, chainName: "Igra", nativeCurrency: { name: "Igra KAS", symbol: "iKAS", decimals: 18 }, rpcUrls: ["https://rpc.igralabs.com:8545"], blockExplorerUrls: ["https://explorer.igralabs.com"] },
  kasplex: { chainId: 202555, chainName: "Kasplex", nativeCurrency: { name: "Bridged KAS", symbol: "KAS", decimals: 18 }, rpcUrls: ["https://evmrpc.kasplex.org"], blockExplorerUrls: ["https://explorer.kasplex.org"] },
} as const;
export const txUrl = (chain: keyof typeof NETS, h: string) => `${NETS[chain].blockExplorerUrls[0]}/tx/${h}`;

/** A protocol's site as a link (the snapshot keeps the bare host). */
export function plainAppUrl(site: string | null): string | null {
  if (!site) return null;
  return /^https?:\/\//.test(site) ? site : `https://${site}`;
}

export const ERC20 = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
]);
export const WETH = parseAbi(["function deposit() payable"]);
export const AAVE_POOL = parseAbi(["function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)"]);
export const PAIR = parseAbi(["function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)", "function totalSupply() view returns (uint256)"]);
export const ROUTER = parseAbi([
  "function addLiquidity(address tokenA, address tokenB, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256, uint256, uint256)",
  "function addLiquidityETH(address token, uint256 amountTokenDesired, uint256 amountTokenMin, uint256 amountETHMin, address to, uint256 deadline) payable returns (uint256, uint256, uint256)",
]);

/** One transaction for the wallet, with what it does in words. */
export type Call = { key: string; label: string; to: Address; data: Hex; value: bigint };

/** At most `bps` less than `x`: the least the contract may take before it reverts. */
export const minOut = (x: bigint, bps: number) => (x * BigInt(10_000 - bps)) / BigInt(10_000);

/** The other side of a V2 deposit at the pool's current ratio (the router's own quote). */
export function quote(amount: bigint, rIn: bigint, rOut: bigint): bigint {
  if (amount <= BigInt(0) || rIn <= BigInt(0) || rOut <= BigInt(0)) return BigInt(0);
  return (amount * rOut) / rIn;
}

/** Share of the pool a V2 deposit mints: the lesser side, as the pair computes it. */
export function lpShare(a0: bigint, a1: bigint, r0: bigint, r1: bigint, supply: bigint): number {
  if (supply <= BigInt(0) || r0 <= BigInt(0) || r1 <= BigInt(0)) return 1;
  const liq = [(a0 * supply) / r0, (a1 * supply) / r1].reduce((a, b) => (a < b ? a : b));
  return Number(liq) / Number(supply + liq);
}

export function supplyCalls(p: Extract<ActPlan, { mode: "supply" }>, user: Address, amount: bigint, have: { token: bigint; allowance: bigint; native: bigint }): Call[] {
  const t = p.tokens[0];
  const out: Call[] = [];
  const short = amount > have.token ? amount - have.token : BigInt(0);
  if (short > BigInt(0) && p.wrap) out.push({ key: "wrap", label: `Wrap native KAS into ${t.symbol}`, to: p.wrap, data: encodeFunctionData({ abi: WETH, functionName: "deposit" }), value: short });
  if (have.allowance < amount) out.push({ key: "approve", label: `Allow ${p.pname} to take this ${t.symbol}`, to: t.address, data: encodeFunctionData({ abi: ERC20, functionName: "approve", args: [p.pool, amount] }), value: BigInt(0) });
  out.push({ key: "supply", label: `Supply ${t.symbol} to ${p.pname}`, to: p.pool, data: encodeFunctionData({ abi: AAVE_POOL, functionName: "supply", args: [t.address, amount, user, 0] }), value: BigInt(0) });
  return out;
}

/**
 * Add liquidity to a V2 pair. `native`: send the wrapped-KAS side as native KAS (addLiquidityETH),
 * so no wrap or approval is needed for it.
 */
export function lpCalls(p: Extract<ActPlan, { mode: "lp" }>, user: Address, a: [bigint, bigint], allow: [bigint, bigint], slipBps: number, deadline: bigint, native: boolean): Call[] {
  const out: Call[] = [];
  const ni = native && p.weth ? p.tokens.findIndex((t) => t.address === p.weth) : -1;
  p.tokens.forEach((t, i) => {
    if (i === ni) return;
    if (allow[i] < a[i]) out.push({ key: `approve${i}`, label: `Allow the ${p.pname} router to take this ${t.symbol}`, to: t.address, data: encodeFunctionData({ abi: ERC20, functionName: "approve", args: [p.router, a[i]] }), value: BigInt(0) });
  });
  if (ni >= 0) {
    const ti = 1 - ni;
    out.push({ key: "add", label: `Add ${p.tokens[ti].symbol} and KAS to the pool`, to: p.router, value: a[ni],
      data: encodeFunctionData({ abi: ROUTER, functionName: "addLiquidityETH", args: [p.tokens[ti].address, a[ti], minOut(a[ti], slipBps), minOut(a[ni], slipBps), user, deadline] }) });
  } else {
    out.push({ key: "add", label: `Add ${p.tokens[0].symbol} and ${p.tokens[1].symbol} to the pool`, to: p.router, value: BigInt(0),
      data: encodeFunctionData({ abi: ROUTER, functionName: "addLiquidity", args: [p.tokens[0].address, p.tokens[1].address, a[0], a[1], minOut(a[0], slipBps), minOut(a[1], slipBps), user, deadline] }) });
  }
  return out;
}

/** The page where an opportunity is taken. */
export const takeHref = (id: string) => `/opportunities/${encodeURIComponent(id)}`;
