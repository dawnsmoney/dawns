/* Serializable shapes shared by the snapshot builder (server) and the UI (server + client). */

export type Status = "good" | "warn" | "crit" | "info";
export type RuleKey = "liq" | "util" | "large" | "tvl" | "contract" | "vol" | "backing";
export type Pt = { t: number; v: number }; // t in ms

export interface Signal { key: string; t: Status; p: string | null; rule: RuleKey | null; strong: string; rest: string }
export interface Provenance { label: string; value: string; trail: [string, string][]; note?: string; links?: string[] }

export interface ContractRow { n: string; addr: string; chain: "igra" | "kasplex"; up: string; admin: string; pause: string; t: Status }

export interface MarketView {
  symbol: string; asset: string; aToken: string;
  price: number; marketPrice: number | null; oracleDeviation: number | null; oracleOk: boolean; oracleError: string | null;
  supplied: number; borrowed: number; cash: number;
  suppliedUsd: number; borrowedUsd: number; cashUsd: number;
  utilization: number; supplyApy: number; borrowApr: number;
  ltv: number; liquidationThreshold: number; frozen: boolean; paused: boolean | null; borrowingEnabled: boolean;
  supplyCap: number; borrowCap: number;
}

export interface PoolView {
  chain: "igra" | "kasplex"; pair: string; symbols: [string, string]; usd: number; share: number;
  reserves: [number, number]; impact10k: number | null;
}

export interface ProtocolView {
  id: string;
  name: string;
  letter: string;
  category: string;
  kind: "lending" | "dex" | "other";
  chains: string[];
  site: string | null;
  tvl: number;
  llamaTvl: number;
  d24: number | null;
  d7: number | null;
  history: Pt[];
  historyCleaned: number;
  tokens: { sym: string; usd: number }[];
  flows: Pt[];
  priceEffect24: number;
  qtyEffect24: number;
  borrowed: number | null;
  source: "onchain" | "defillama";
  verifiedShare: number | null;
  status: Status;
  statusText: string;
  flags: [Status, string][];
  floor: boolean;
  contracts: ContractRow[];
  canVerify: [string, string, string][];
  cannotVerify: [string, string][];
  asOf: { chain: "igra" | "kasplex"; block: number; timestamp: number } | null;
  audits: string[];
  lending?: {
    markets: MarketView[];
    suppliedUsd: number; borrowedUsd: number; cashUsd: number; utilization: number; coverage: number;
    aclAdmin: string; aclAdminIsContract: boolean; owner: string; ownerIsContract: boolean;
    poolImplementation: string | null; oracle: string; dataProvider: string;
  };
  dex?: {
    pools: PoolView[]; pairCount: number; byChain: { igra: number; kasplex: number };
    vol24: number | null; vol7: number | null; fees24: number | null;
  };
}

export interface BridgeExit { id: number; block: number; ageSec: number; kas: number; feeKas: number }
export interface BridgeState {
  block: number; timestamp: number;
  lockedKas: number; entryTxCount: number | null;
  ikasSupply: number;
  coverage: number;                 // lockedKas / ikasSupply
  surplusKas: number;               // lockedKas - ikasSupply
  totalBurnedKas: number; totalFeesKas: number;
  exitsTotal: number;
  recentExits: BridgeExit[];        // newest first
  inWindowKas: number;              // exits requested in the last 72h (release window)
  inWindowCount: number;
  blockTimeSec: number;
  config: { minExitKas: number; maxExitKas: number; windowBlocks: number; maxExitsPerWindow: number; maxUnlockPerWindowKas: number; feePolicy: string; feeClaimer: string };
  throttle: { windowEndsAtBlock: number; remainingExits: number; remainingUnlockKas: number };
  owner: string; ownerIsContract: boolean; implementation: string | null;
}

export interface Snapshot {
  asOf: number;
  buildMs: number;
  blocks: { igra?: { block: number; timestamp: number }; kasplex?: { block: number; timestamp: number } };
  kasUsd: number | null;
  kas24: number | null;
  protocols: ProtocolView[];
  eco: {
    tvl: number; llamaTotal: number; dexLiq: number; stable: number; priceEffect: number; qtyEffect: number;
    lendingLiq: number; lendingUtil: number | null; lendingBorrowed: number | null;
    series: Pt[]; stack: { name: string; id: string; values: number[] }[]; dates: number[];
    composition: { sym: string; usd: number }[];
  };
  bridge: BridgeState | null;
  signals: Signal[];
  prov: Record<string, Provenance>;
  errors: string[];
}
