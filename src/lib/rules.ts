import type { RuleKey } from "./types";

export type RuleDef = { key: RuleKey; label: string; unit: "$K" | "%" | null; def: number | null };
export type Kind = "lending" | "dex" | "other";

export const RULES: Record<Kind, RuleDef[]> = {
  lending: [
    { key: "liq", label: "Available liquidity falls below", unit: "$K", def: 300 },
    { key: "util", label: "Any market's utilization rises above", unit: "%", def: 85 },
    { key: "large", label: "A single withdrawal exceeds", unit: "$K", def: 50 },
    { key: "tvl", label: "TVL moves more than, in 24h", unit: "%", def: 15 },
    { key: "contract", label: "Frozen market, oracle drift, upgrade or admin change", unit: null, def: null },
  ],
  dex: [
    { key: "liq", label: "A pool's liquidity drops by more than, in 24h", unit: "%", def: 10 },
    { key: "large", label: "A single liquidity removal exceeds", unit: "$K", def: 25 },
    { key: "vol", label: "Volume exceeds its 7d average by", unit: "%", def: 100 },
    { key: "tvl", label: "TVL moves more than, in 24h", unit: "%", def: 15 },
    { key: "contract", label: "Contract upgrade or admin change", unit: null, def: null },
  ],
  other: [
    { key: "tvl", label: "TVL moves more than, in 24h", unit: "%", def: 15 },
    { key: "contract", label: "Contract upgrade or admin change", unit: null, def: null },
  ],
};

export const RULE_TXT: Record<RuleKey, string> = { liq: "liquidity", util: "utilization", large: "large withdrawal", tvl: "TVL move", contract: "risk changes", vol: "volume spike", backing: "bridge backing" };
