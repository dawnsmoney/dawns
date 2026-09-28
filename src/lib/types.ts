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
  oracleUpdatedAt: number | null; oracleMaxAge: number | null; debtToken: string;
  supplied: number; borrowed: number; cash: number;
  suppliedUsd: number; borrowedUsd: number; cashUsd: number;
  utilization: number; supplyApy: number; borrowApr: number;
  ltv: number; liquidationThreshold: number; frozen: boolean; paused: boolean | null; borrowingEnabled: boolean;
  supplyCap: number; borrowCap: number; decimals: number;
}

export interface PoolView {
  chain: "igra" | "kasplex"; pair: string; symbols: [string, string]; usd: number; share: number;
  reserves: [number, number]; impact10k: number | null;
  kind: "v2" | "v3"; fee: number | null; lpShare: number | null;
  /** token address, decimals and USD price (null if unpriced) — used to value indexed events */
  tk: [PoolToken, PoolToken];
}
export interface PoolToken { a: string; d: number; px: number | null }

/** Events dawns indexed itself from contract logs. */
export interface ActivityEvent { t: number; kind: "swap" | "remove" | "supply" | "withdraw" | "borrow" | "repay" | "liquidation"; usd: number; label: string; tx: string; chain: "igra" | "kasplex" }
export interface Activity {
  since: number;                 // ms: start of indexed coverage
  upTo: number;                  // ms: how far the index has read (both chains)
  swaps24: number; vol24: number; vol7: number | null;
  volDays: Pt[];                 // daily swap volume (DEX)
  lendFlows: { market: string; supply: number; withdraw: number; borrow: number; repay: number; liquidations: number }[]; // 24h, USD
  events: ActivityEvent[];       // largest events of the last 7 days
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
  d24Source: "dawns" | "defillama";
  intraday: Pt[];                 // dawns' own history, hourly, last 7 days
  activity: Activity | null;      // dawns' own event index
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
    /** every account's position, computed by dawns from token balances at market prices */
    positions?: {
      accounts: number; suppliers: number; borrowers: number; unread: number; updatedAt: number;
      debtUsd: number; collateralUsd: number;
      buckets: { label: string; debtUsd: number; accounts: number }[];   // by health factor
      liquidatableUsd: number; liquidatable: number; badDebtUsd: number; badDebtAccounts: number;
      top: { address: string; collateralUsd: number; debtUsd: number; hf: number | null }[];
    };
  };
  dex?: {
    pools: PoolView[]; pairCount: number; byChain: { igra: number; kasplex: number };
    vol24: number | null; vol7: number | null; fees24: number | null;
    /** trading fee per unit of volume, and the share of it paid to LPs (DefiLlama fees ÷ volume, 7 days) */
    feeRate: number | null; lpShare: number | null; feeSource: "on-chain" | "defillama" | null; feeSamples: number;
  };
}

export interface BridgeExit { id: number; block: number; ageSec: number; kas: number; feeKas: number; tx?: string | null; payTo?: string | null; paidTx?: string | null; paidAt?: number | null; paidKas?: number | null }
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
  history?: Pt[];                 // backing ratio, hourly (dawns' own history)
  payouts?: { indexed: number; unchecked: number; paid: number; unpaid: number; unpaidKas: number; late: number; lateKas: number; medianHours: number | null; checkedSince: number | null };
}

/** A place to earn native yield, shown next to what it costs to get out. */
export interface Opportunity {
  id: string; kind: "supply" | "lp";
  protocol: string; pname: string; chain: "igra" | "kasplex";
  name: string; assets: string[];
  apy: number | null;              // native yield only
  apyBasis: string;                // how the yield was measured (full sentence)
  apyShort: string;                // the same, short enough for a table cell
  apyRange: [number, number] | null; rangeHours: number;  // own history
  size: number;                    // USD in the market or pool
  exitNow: number | null;          // USD that can leave right now
  exitShare: number | null;        // exitNow ÷ size (lending)
  vol24: number | null; swaps24: number | null; turnover: number | null; // LP
  priceMove: number | null; ilAtMove: number | null;                     // LP: 7d price range and the LP shortfall at that move
  status: Status; statusText: string;
  notes: string[];
  pair?: string; feeTier?: number | null;
  /** canonical asset ids (chain:standard:ref) of what the position holds, in the order of `assets` */
  assetIds: string[];
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
    intraday: Pt[];
  };
  bridge: BridgeState | null;
  opportunities: Opportunity[];
  signals: Signal[];
  prov: Record<string, Provenance>;
  errors: string[];
}
