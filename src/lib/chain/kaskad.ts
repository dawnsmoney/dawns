import "server-only";
import { parseAbi, type Address } from "viem";
import { clients, pool } from "./clients";

/** Kaskad mainnet addresses, from docs.kaskad.app/docs/contracts. */
export const KASKAD = {
  poolAddressesProvider: "0x4e718714BF19c7BBcf402ecA92f971B8a65c716D" as Address,
  pool: "0x1Fc4f91E99eFDC90c4B2B8F69fE0b4BFd819a330" as Address,
  rewardsController: "0xf8dbB86662B63c4a8cF5a88d9517c22bD78C73dB" as Address,
  governor: "0x89fB31943F1bF5f1FB0315283d915c9f4643f930" as Address,
  kaskadOracle: "0x43B93376ed3Cd2E95e576AD4b59222036493Dd1d" as Address,
};

const papAbi = parseAbi([
  "function getPoolDataProvider() view returns (address)",
  "function getPriceOracle() view returns (address)",
  "function getPool() view returns (address)",
  "function getACLAdmin() view returns (address)",
  "function owner() view returns (address)",
]);
const dpAbi = parseAbi([
  "function getAllReservesTokens() view returns ((string symbol, address tokenAddress)[])",
  "function getReserveData(address) view returns (uint256 unbacked, uint256 accruedToTreasuryScaled, uint256 totalAToken, uint256 totalStableDebt, uint256 totalVariableDebt, uint256 liquidityRate, uint256 variableBorrowRate, uint256 stableBorrowRate, uint256 averageStableBorrowRate, uint256 liquidityIndex, uint256 variableBorrowIndex, uint40 lastUpdateTimestamp)",
  "function getReserveConfigurationData(address) view returns (uint256 decimals, uint256 ltv, uint256 liquidationThreshold, uint256 liquidationBonus, uint256 reserveFactor, bool usageAsCollateralEnabled, bool borrowingEnabled, bool stableBorrowRateEnabled, bool isActive, bool isFrozen)",
  "function getPaused(address) view returns (bool)",
  "function getReserveCaps(address) view returns (uint256 borrowCap, uint256 supplyCap)",
  "function getReserveTokensAddresses(address) view returns (address aTokenAddress, address stableDebtTokenAddress, address variableDebtTokenAddress)",
]);
const oracleAbi = parseAbi([
  "function getAssetPrice(address) view returns (uint256)",
  "function BASE_CURRENCY_UNIT() view returns (uint256)",
  "function getSourceOfAsset(address) view returns (address)",
]);
const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)"]);

const EIP1967_IMPL = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

export interface KaskadMarket {
  symbol: string;
  asset: Address;
  aToken: Address;
  debtToken: Address;
  decimals: number;
  price: number; // oracle, USD
  oracleSource: Address | null;
  oracleOk: boolean;
  supplied: number; // tokens
  borrowed: number;
  cash: number; // underlying held by the aToken contract
  suppliedUsd: number;
  borrowedUsd: number;
  cashUsd: number;
  utilization: number;
  supplyApy: number;
  borrowApr: number;
  ltv: number;
  liquidationThreshold: number;
  collateralEnabled: boolean;
  borrowingEnabled: boolean;
  active: boolean;
  frozen: boolean;
  paused: boolean | null;
  supplyCap: number;
  borrowCap: number;
}

export interface KaskadState {
  block: number;
  timestamp: number;
  dataProvider: Address;
  oracle: Address;
  aclAdmin: Address;
  aclAdminIsContract: boolean;
  owner: Address;
  ownerIsContract: boolean;
  poolImplementation: Address | null;
  markets: KaskadMarket[];
  totals: { suppliedUsd: number; borrowedUsd: number; cashUsd: number; utilization: number; coverage: number };
}

const num = (x: bigint, d: number) => Number(x) / 10 ** d;

export async function readKaskad(fallbackPrice?: (symbol: string) => number | null): Promise<KaskadState> {
  const c = clients.igra;
  const block = await c.getBlock();
  const at = { blockNumber: block.number };
  const pap = KASKAD.poolAddressesProvider;
  const [dp, oracle, aclAdmin, owner] = await Promise.all([
    c.readContract({ address: pap, abi: papAbi, functionName: "getPoolDataProvider", ...at }),
    c.readContract({ address: pap, abi: papAbi, functionName: "getPriceOracle", ...at }),
    c.readContract({ address: pap, abi: papAbi, functionName: "getACLAdmin", ...at }),
    c.readContract({ address: pap, abi: papAbi, functionName: "owner", ...at }),
  ]);
  const [adminCode, ownerCode, implSlot, unit, tokens] = await Promise.all([
    c.getCode({ address: aclAdmin, ...at }),
    c.getCode({ address: owner, ...at }),
    c.getStorageAt({ address: KASKAD.pool, slot: EIP1967_IMPL, ...at }).catch(() => undefined),
    c.readContract({ address: oracle, abi: oracleAbi, functionName: "BASE_CURRENCY_UNIT" }),
    c.readContract({ address: dp, abi: dpAbi, functionName: "getAllReservesTokens", ...at }),
  ]);
  const impl = implSlot && BigInt(implSlot) !== BigInt(0) ? (("0x" + implSlot.slice(-40)) as Address) : null;

  const markets = (
    await pool([...tokens], 4, async (t) => {
      const a = t.tokenAddress;
      const [d, cfg, px, src, paused, caps, addrs] = await Promise.all([
        c.readContract({ address: dp, abi: dpAbi, functionName: "getReserveData", args: [a], ...at }),
        c.readContract({ address: dp, abi: dpAbi, functionName: "getReserveConfigurationData", args: [a], ...at }),
        // the oracle reverts on calls pinned to a block number, so read it at "latest"
        c.readContract({ address: oracle, abi: oracleAbi, functionName: "getAssetPrice", args: [a] }).catch(() => null),
        c.readContract({ address: oracle, abi: oracleAbi, functionName: "getSourceOfAsset", args: [a], ...at }).catch(() => null),
        c.readContract({ address: dp, abi: dpAbi, functionName: "getPaused", args: [a], ...at }).catch(() => null),
        c.readContract({ address: dp, abi: dpAbi, functionName: "getReserveCaps", args: [a], ...at }),
        c.readContract({ address: dp, abi: dpAbi, functionName: "getReserveTokensAddresses", args: [a], ...at }),
      ]);
      const dec = Number(cfg[0]);
      const cashRaw = await c.readContract({ address: a, abi: erc20, functionName: "balanceOf", args: [addrs[0]], ...at });
      let price = px == null ? NaN : Number(px) / Number(unit);
      if (!isFinite(price)) price = fallbackPrice?.(t.symbol) ?? 0;
      const supplied = num(d[2], dec), borrowed = num(d[3] + d[4], dec), cash = num(cashRaw, dec);
      const m: KaskadMarket = {
        symbol: t.symbol, asset: a, aToken: addrs[0], debtToken: addrs[2], decimals: dec, price, oracleSource: src, oracleOk: px != null,
        supplied, borrowed, cash,
        suppliedUsd: supplied * price, borrowedUsd: borrowed * price, cashUsd: cash * price,
        utilization: supplied > 0 ? borrowed / supplied : 0,
        supplyApy: Number(d[5]) / 1e27, borrowApr: Number(d[6]) / 1e27,
        ltv: Number(cfg[1]) / 1e4, liquidationThreshold: Number(cfg[2]) / 1e4,
        collateralEnabled: cfg[5], borrowingEnabled: cfg[6], active: cfg[8], frozen: cfg[9], paused,
        supplyCap: Number(caps[1]), borrowCap: Number(caps[0]),
      };
      return m;
    })
  ).filter((m): m is KaskadMarket => m !== null);

  if (!markets.length) throw new Error("Kaskad: no reserves read");
  const suppliedUsd = markets.reduce((s, m) => s + m.suppliedUsd, 0);
  const borrowedUsd = markets.reduce((s, m) => s + m.borrowedUsd, 0);
  const cashUsd = markets.reduce((s, m) => s + m.cashUsd, 0);
  return {
    block: Number(block.number),
    timestamp: Number(block.timestamp),
    dataProvider: dp, oracle, aclAdmin, owner,
    aclAdminIsContract: !!adminCode && adminCode !== "0x",
    ownerIsContract: !!ownerCode && ownerCode !== "0x",
    poolImplementation: impl,
    markets: markets.sort((a, b) => b.suppliedUsd - a.suppliedUsd),
    totals: { suppliedUsd, borrowedUsd, cashUsd, utilization: suppliedUsd ? borrowedUsd / suppliedUsd : 0, coverage: suppliedUsd ? (cashUsd + borrowedUsd) / suppliedUsd : 0 },
  };
}
