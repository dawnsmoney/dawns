/* Dawns asset index: one normalized record per asset, whatever chain or standard issued it. */

export type AssetChain = "kaspa" | "igra" | "kasplex" | "zkas";
export type AssetStandard = "native" | "krc20" | "erc20";

export const CHAIN_NAME: Record<AssetChain, string> = { kaspa: "Kaspa", igra: "Igra", kasplex: "Kasplex L2", zkas: "ZKas" };
export const STANDARD_NAME: Record<AssetStandard, string> = { native: "Native coin", krc20: "KRC-20", erc20: "ERC-20" };

/**
 * The canonical id is `chain:standard:ref`, never a ticker: NACHO on Kaspa L1 (KRC-20)
 * and NACHO on Igra (ERC-20) are different assets with different holders, supply and risks.
 * ref: the ticker for native coins and KRC-20 (Kasplex ticks are unique), the lower-case
 * contract address for ERC-20.
 */
export const assetId = (chain: AssetChain, standard: AssetStandard, ref: string) => `${chain}:${standard}:${standard === "erc20" ? ref.toLowerCase() : ref.toUpperCase()}`;
export const assetPath = (id: string) => `/assets/${id.split(":").map(encodeURIComponent).join("/")}`;

export type HolderKind = "exchange" | "burn" | "project" | null;
export interface Holder { address: string; share: number; label: string | null; contract: boolean; kind?: HolderKind }

export interface Asset {
  id: string;
  chain: AssetChain;
  standard: AssetStandard;
  ref: string;
  symbol: string;
  name: string;
  decimals: number | null;
  logo: string | null;

  price: number | null;          // USD
  priceSrc: string | null;       // where the price comes from, in words
  poolPrice?: number | null;     // the price of its own pools on this chain, when it differs from the headline
  mcap: number | null;           // price × circulating supply
  vol24: number | null;          // USD traded in 24h
  vol7?: number | null;          // USD traded in 7 days
  volSrc: string | null;

  supply: number | null;         // circulating / minted, in whole tokens
  maxSupply: number | null;      // null: no cap (or unknown — see note)
  mintedShare: number | null;    // KRC-20 fair mints: minted ÷ max
  premineShare: number | null;   // share of max supply pre-minted to the deployer
  state: string | null;          // KRC-20: "minting" | "finished"
  launched: number | null;       // ms

  holders: number | null;
  top10: number | null;          // share of supply held by the 10 largest addresses
  topHolders: Holder[] | null;   // up to 10, with contract/label where known
  holdersAt: number | null;      // ms: when the holder list was read

  liquidity: number | null;      // USD in DEX pools dawns reads on-chain
  pools: string[];               // opportunity ids (pools / markets) that hold this asset

  rank: number | null;           // source rank (KaspaCom for KRC-20)
  net?: NetworkStats;            // native coins
  updatedAt: number;
}

export interface NetworkStats {
  hashrate: number | null;       // H/s
  difficulty: number | null;
  bps: number | null;            // blocks per second, measured
  blockReward: number | null;    // coins per block (gross)
  nextReduction: { at: number; amount: number } | null;
  emissionPerYear: number | null;   // coins minted over the next 12 months, following the chain's schedule
  inflation: number | null;         // emissionPerYear ÷ circulating supply
  emissionBasis?: string;           // how the projection was made
  path?: { t: number; supply: number }[]; // projected supply, monthly, next 24 months
  mergedShare?: number | null;      // ZKAS: its hashrate ÷ Kaspa's
  producers?: Producers | null;     // ZKAS: who produces the blocks (sampled)
  shielded?: { notes: number; nullifiers: number; turnstileIn: number; turnstileOut: number } | null;
  daa: number | null;
}

export interface Producers {
  days: number; sampled: number; distinct: number;
  top: { id: string; share: number }[];   // largest payout addresses, share of sampled blocks
  toMajority: number;                     // fewest producers that together made > 50% of blocks
  unknown: number;                        // blocks whose payout could not be read
}

export interface AssetDay { day: string; price: number | null; holders: number | null; mcap: number | null; vol24: number | null; supply: number | null }

/**
 * Is price × supply a value anyone could realize? Only when some market carries it: 7-day
 * volume or DEX liquidity of at least 0.05% of that value. A 43-holder token priced by one
 * $3 trade is not worth $361 trillion.
 */
export function valueCredible(a: Pick<Asset, "standard" | "mcap" | "vol24" | "vol7" | "liquidity">): boolean {
  if (a.mcap == null) return false;
  if (a.standard === "native") return true;
  const flow = Math.max(a.vol7 ?? 0, (a.vol24 ?? 0) * 7);
  return Math.max(flow, a.liquidity ?? 0) >= a.mcap * 0.0005;
}
