/**
 * Curated facts for assets whose nature a data feed cannot state. Every claim carries
 * its source; "according to its published documentation" where dawns has not verified
 * it on-chain itself.
 */
export interface Curated {
  what: string;                       // "What is this asset?", one paragraph
  facts: [string, string][];          // label, value
  questions: string[];                // key things to investigate
  flags?: ["good" | "warn" | "crit" | "info", string][];
  sources: [string, string][];        // label, url
}

export const CURATED: Record<string, Curated> = {
  "kaspa:native:KAS": {
    what: "The native coin of Kaspa, a proof-of-work BlockDAG (GHOSTDAG consensus, kHeavyHash) producing 10 blocks per second. Launched in November 2021 with no premine and no pre-sale. Emission follows a fixed monthly reduction toward a hard cap of about 28.7 billion KAS. It is the base asset of Kaspa DeFi: most value on Igra and Kasplex is KAS or KAS-backed.",
    facts: [
      ["Consensus", "Proof of work, GHOSTDAG BlockDAG"],
      ["Hash function", "kHeavyHash"],
      ["Block rate", "10 blocks per second"],
      ["Launch", "7 November 2021, fair launch"],
      ["Supply cap", "≈ 28.7 billion KAS"],
      ["Emission", "Reward falls every month; halves every year"],
    ],
    questions: [
      "How much of the remaining emission reaches exchanges, and how fast?",
      "How much KAS sits in L2 bridges (Igra, Kasplex), and what backs it there?",
      "Which DeFi positions are really KAS exposure under another name (WiKAS, iKAS, WKAS)?",
    ],
    sources: [["Kaspa", "https://kaspa.org"], ["Kaspa REST API", "https://api.kaspa.org/docs"]],
  },
  "zkas:native:ZKAS": {
    what: "A privacy-first proof-of-work BlockDAG derived from Kaspa's architecture: GHOSTDAG, kHeavyHash and a one-second block target, merge-mined with Kaspa. Transfers are shielded by construction (Orchard with Halo 2 proofs), and there is no transparent mode. According to its published documentation it launched on 26 July 2026 with no premine: the genesis output is provably unspendable. Emission is deliberately front-loaded, with a perpetual tail and 5% of every block to development.",
    facts: [
      ["Consensus", "Proof of work, GHOSTDAG BlockDAG"],
      ["Hash function", "kHeavyHash, merge-mined with Kaspa"],
      ["Block rate", "1 block per second (target)"],
      ["Privacy", "Mandatory shielded transfers (Orchard / Halo 2)"],
      ["Launch", "26 July 2026, no premine (per its documentation)"],
      ["Emission", "60 ZKAS/block at launch, roughly halving each quarter; tail of 6 ZKAS/block from ~month 10, 0.6 ZKAS/block forever from month 24"],
      ["Split", "95% to miners, 5% to development, enforced by consensus"],
      ["Supply cap", "None: the tail pays for security"],
      ["Audit", "No independent external audit yet (per its site)"],
    ],
    questions: [
      "How much security comes from merged mining, and how stable is that share?",
      "How concentrated is mining? Which pools produce the blocks?",
      "What will the perpetual tail do to supply once the front-loaded phase ends?",
      "How deep is ZKAS liquidity beyond two OTC venues?",
      "How much economic activity is there beyond mining? What leaves the shielded pool?",
      "What depends on a few operators: wallets, the explorer, the OTC desk?",
    ],
    flags: [
      ["warn", "No independent external audit of the chain's code yet, per its own site."],
      ["info", "Shielded by construction: holder concentration and flows cannot be measured on-chain. That is the design, not a data gap."],
    ],
    sources: [
      ["ZKas", "https://zkas.info"],
      ["Whitepaper", "https://zkas.info/whitepaper.html"],
      ["Explorer and network API", "https://explorer.zkas.info/analytics"],
      ["Code", "https://github.com/firecash/zkas-rusty"],
    ],
  },
};

/** Assets whose value depends on a bridge or custodian rather than their own chain. */
export const BRIDGED = /^(weth|wbtc|cbbtc|wsteth|usdc|usdt|usd₮|usdt0|usdc\.e|dai|ikas|wikas|wkas)$/i;
