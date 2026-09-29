import "server-only";
import { parseAbi, type Address } from "viem";
import { clients, pool } from "./clients";

/** Kaskad mainnet addresses, from docs.kaskad.app/docs/contracts. */
export const KASKAD = {
  poolAddressesProvider: "0x4e718714BF19c7BBcf402ecA92f971B8a65c716D" as Address,
  pool: "0x1Fc4f91E99eFDC90c4B2B8F69fE0b4BFd819a330" as Address,
  /** the controller named in the docs; the live one is read from each aToken (getIncentivesController) */
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
const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)", "function totalSupply() view returns (uint256)", "function symbol() view returns (string)", "function decimals() view returns (uint8)", "function allowance(address, address) view returns (uint256)"]);
const incAbi = parseAbi([
  "function getIncentivesController() view returns (address)",
  "function getRewardsList() view returns (address[])",
  "function getRewardsByAsset(address) view returns (address[])",
  "function getRewardsData(address asset, address reward) view returns (uint256 index, uint256 emissionPerSecond, uint256 lastUpdateTimestamp, uint256 distributionEnd)",
  "function getEmissionManager() view returns (address)",
  "function getTransferStrategy(address) view returns (address)",
  "function getRewardsVault() view returns (address)",
]);

/** A reward token the controller emits, and whether what it still has to pay is funded. */
export interface KaskadReward {
  token: Address; symbol: string; price: number | null;
  perDay: number;              // tokens a day, all markets and both sides
  end: number;                 // unix seconds, the latest distribution end
  dueToEnd: number;            // tokens still to emit until each market's end at today's rates
  funded: number;              // tokens the payer holds (and may pay out)
  payer: Address;              // the controller itself, or the rewards vault behind a transfer strategy
  fundedDays: number | null;   // how long `funded` lasts at today's rate
}
export interface KaskadIncentives { controller: Address; emissionManager: Address | null; rewards: KaskadReward[] }

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
  oracleError: string | null;
  oracleUpdatedAt: number | null;   // unix seconds, when the oracle reports StalePrice
  oracleMaxAge: number | null;      // seconds the oracle accepts
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
  /** token incentives, never part of supplyApy / borrowApr */
  incentives?: { symbol: string; supplyPerDay: number; borrowPerDay: number; supplyApr: number | null; borrowApr: number | null; end: number }[];
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
  incentives: KaskadIncentives | null;
  /** the wrapped native token behind the KAS market: native iKAS held vs tokens issued */
  wrapped: { symbol: string; token: Address; held: number; supply: number } | null;
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
        c.readContract({ address: oracle, abi: oracleAbi, functionName: "getAssetPrice", args: [a] }).catch((e: Error) => {
          // StalePrice(uint256 updatedAt, uint256 maxAge) = 0x2730eb48: the feed is older than the oracle accepts
          const raw = (e.message.match(/0x[0-9a-f]{8,}/gi) ?? []).sort((x, y) => y.length - x.length)[0] ?? "";
          const stale = /^0x2730eb48/i.test(raw) && raw.length >= 10 + 128 ? { updatedAt: Number(BigInt("0x" + raw.slice(10, 74))), maxAge: Number(BigInt("0x" + raw.slice(74, 138))) } : null;
          return { error: stale ? "StalePrice" : raw.slice(0, 10) || "revert", stale };
        }),
        c.readContract({ address: oracle, abi: oracleAbi, functionName: "getSourceOfAsset", args: [a], ...at }).catch(() => null),
        c.readContract({ address: dp, abi: dpAbi, functionName: "getPaused", args: [a], ...at }).catch(() => null),
        c.readContract({ address: dp, abi: dpAbi, functionName: "getReserveCaps", args: [a], ...at }),
        c.readContract({ address: dp, abi: dpAbi, functionName: "getReserveTokensAddresses", args: [a], ...at }),
      ]);
      const dec = Number(cfg[0]);
      const cashRaw = await c.readContract({ address: a, abi: erc20, functionName: "balanceOf", args: [addrs[0]], ...at });
      const oracleError = typeof px === "object" && px !== null ? px.error : null;
      const oracleStale = typeof px === "object" && px !== null ? px.stale : null;
      let price = oracleError ? NaN : Number(px as bigint) / Number(unit);
      if (!isFinite(price)) price = fallbackPrice?.(t.symbol) ?? 0;
      const supplied = num(d[2], dec), borrowed = num(d[3] + d[4], dec), cash = num(cashRaw, dec);
      const m: KaskadMarket = {
        symbol: t.symbol, asset: a, aToken: addrs[0], debtToken: addrs[2], decimals: dec, price, oracleSource: src, oracleOk: !oracleError, oracleError, oracleUpdatedAt: oracleStale?.updatedAt ?? null, oracleMaxAge: oracleStale?.maxAge ?? null,
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
  const nowSec = Number(block.timestamp);
  const [incentives, wrapped] = await Promise.all([
    readIncentives(markets, nowSec, fallbackPrice).catch(() => null),
    readWrapped(markets).catch(() => null),
  ]);
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
    incentives, wrapped,
    totals: { suppliedUsd, borrowedUsd, cashUsd, utilization: suppliedUsd ? borrowedUsd / suppliedUsd : 0, coverage: suppliedUsd ? (cashUsd + borrowedUsd) / suppliedUsd : 0 },
  };
}

const DAY = 86_400;
const units = (x: bigint, dec: number) => Number(x / BigInt(10) ** BigInt(Math.max(0, dec - 6))) / 10 ** Math.min(dec, 6);

/**
 * Token incentives, decoded from the live RewardsController (the one every aToken
 * points at): emission per second and end per market side, and what the payer
 * holds against what is still to be emitted. Mutates `markets` with per-market
 * figures; returns the per-token totals.
 */
async function readIncentives(markets: KaskadMarket[], nowSec: number, price?: (symbol: string) => number | null): Promise<KaskadIncentives | null> {
  const c = clients.igra;
  const rc = await c.readContract({ address: markets[0].aToken, abi: incAbi, functionName: "getIncentivesController" });
  if (!rc || /^0x0{40}$/i.test(rc)) return null;
  const [list, em] = await Promise.all([
    c.readContract({ address: rc, abi: incAbi, functionName: "getRewardsList" }),
    c.readContract({ address: rc, abi: incAbi, functionName: "getEmissionManager" }).catch(() => null),
  ]);
  const rewards: KaskadReward[] = [];
  for (const token of list) {
    const [symbol, decimals] = await Promise.all([
      c.readContract({ address: token, abi: erc20, functionName: "symbol" }),
      c.readContract({ address: token, abi: erc20, functionName: "decimals" }).then(Number),
    ]);
    const px = price?.(symbol) ?? null;
    // who pays: the controller itself, or a vault behind a transfer strategy (the lesser of its balance and allowance)
    const strategy = await c.readContract({ address: rc, abi: incAbi, functionName: "getTransferStrategy", args: [token] }).catch(() => null);
    let payer: Address = rc, funded: number;
    const vault = strategy && !/^0x0{40}$/i.test(strategy) ? await c.readContract({ address: strategy, abi: incAbi, functionName: "getRewardsVault" }).catch(() => null) : null;
    if (vault && strategy) {
      payer = vault;
      const [bal, allow] = await Promise.all([
        c.readContract({ address: token, abi: erc20, functionName: "balanceOf", args: [vault] }),
        c.readContract({ address: token, abi: erc20, functionName: "allowance", args: [vault, strategy] }),
      ]);
      funded = units(bal < allow ? bal : allow, decimals);
    } else {
      funded = units(await c.readContract({ address: token, abi: erc20, functionName: "balanceOf", args: [rc] }), decimals);
    }
    let perSec = 0, due = 0, end = 0;
    await pool(markets, 4, async (m) => {
      const [s, b] = await Promise.all([m.aToken, m.debtToken].map((a) => c.readContract({ address: a, abi: incAbi, functionName: "getRewardsData", args: [a, token] }).catch(() => null)));
      const side = (d: typeof s) => {
        if (!d) return { perSec: 0, end: 0 };
        const e = Number(d[3]);
        return { perSec: e > nowSec ? units(d[1], decimals) : 0, end: e };
      };
      const S = side(s), B = side(b);
      perSec += S.perSec + B.perSec;
      due += S.perSec * Math.max(0, S.end - nowSec) + B.perSec * Math.max(0, B.end - nowSec);
      end = Math.max(end, S.end, B.end);
      const yr = 365 * DAY;
      (m.incentives ??= []).push({
        symbol, supplyPerDay: S.perSec * DAY, borrowPerDay: B.perSec * DAY, end: Math.max(S.end, B.end),
        supplyApr: px != null && m.suppliedUsd > 0 ? (S.perSec * yr * px) / m.suppliedUsd : null,
        borrowApr: px != null && m.borrowedUsd > 0 ? (B.perSec * yr * px) / m.borrowedUsd : null,
      });
      return null;
    });
    rewards.push({ token, symbol, price: px, perDay: perSec * DAY, end, dueToEnd: due, funded, payer, fundedDays: perSec > 0 ? funded / (perSec * DAY) : null });
  }
  return { controller: rc, emissionManager: em, rewards };
}

/** The KAS market holds WiKAS: native iKAS locked in the wrapper against WiKAS issued. */
async function readWrapped(markets: KaskadMarket[]) {
  const m = markets.find((x) => /^wikas$/i.test(x.symbol));
  if (!m) return null;
  const c = clients.igra;
  const [held, supply] = await Promise.all([
    c.getBalance({ address: m.asset }),
    c.readContract({ address: m.asset, abi: erc20, functionName: "totalSupply" }),
  ]);
  return { symbol: m.symbol, token: m.asset, held: units(held, 18), supply: units(supply, 18) };
}
