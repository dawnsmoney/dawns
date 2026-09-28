import "server-only";
import { parseAbi, type Address } from "viem";
import { clients, type ChainKey } from "./clients";

/**
 * ZealousSwap Infinity Pools: single-asset vaults. Depositors receive an xToken (xZEAL,
 * xNACHO) that appreciates against the underlying. What a vault holds is
 * totalStaked + totalRewards, in the underlying token. Addresses as published in
 * ZealousSwap's own DefiLlama adapter.
 */
export const INFINITY_POOLS: { chain: ChainKey; symbol: string; token: Address; vault: Address; own: boolean }[] = [
  { chain: "igra", symbol: "NACHO", token: "0x0F85B69Da77DF32Fe2434e7FD705B9cb18Dd8982", vault: "0x6939d93E61A7dF44AE4fCC04CFac87741A83b7f4", own: false },
  { chain: "igra", symbol: "ZEAL", token: "0x76F8A377e18f79170aC2f8b34e26E2Ca7168a556", vault: "0x635439Aa4e5801B761d566534E6685Be2A5e908C", own: true },
  { chain: "kasplex", symbol: "NACHO", token: "0x9a5a144290dffA24C6c7Aa8cA9A62319E60973D8", vault: "0x0d4f07811718C0eE57EA2FCDb844c3585ae0F315", own: false },
  { chain: "kasplex", symbol: "KASPER", token: "0x1F3Ce97f8118035dba7FBCd5398005491Cf45603", vault: "0xa1074f1cD056862ebA654344518aa8c6DE0afE74", own: false },
  { chain: "kasplex", symbol: "ZEAL", token: "0xb7a95035618354D9ADFC49Eca49F38586B624040", vault: "0x1E7748BA1d372186a322E7CfaAB1306f19FfB897", own: true },
];

const abi = parseAbi(["function totalStaked() view returns (uint256)", "function totalRewards() view returns (uint256)", "function decimals() view returns (uint8)"]);

export async function readInfinityPools() {
  return Promise.all(INFINITY_POOLS.map(async (p) => {
    const c = clients[p.chain];
    const [staked, rewards, dec] = await Promise.all([
      c.readContract({ address: p.vault, abi, functionName: "totalStaked" }),
      c.readContract({ address: p.vault, abi, functionName: "totalRewards" }),
      c.readContract({ address: p.token, abi, functionName: "decimals" }),
    ]);
    return { ...p, amount: Number(staked + rewards) / 10 ** dec };
  }));
}
