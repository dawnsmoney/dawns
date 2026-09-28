import type { Status } from "../types";
import { CHAIN_NAME, STANDARD_NAME, type Asset } from "./types";
import { CURATED, BRIDGED } from "./profiles";

const pct = (x: number, d = 0) => `${(x * 100).toFixed(d)}%`;
const usd = (x: number) => (x >= 1e9 ? `$${(x / 1e9).toFixed(2)}B` : x >= 1e6 ? `$${(x / 1e6).toFixed(2)}M` : x >= 1e3 ? `$${(x / 1e3).toFixed(1)}K` : `$${x.toFixed(0)}`);
const n = (x: number) => (x >= 1e9 ? `${(x / 1e9).toFixed(2)}B` : x >= 1e6 ? `${(x / 1e6).toFixed(1)}M` : x >= 1e3 ? `${(x / 1e3).toFixed(1)}K` : x.toFixed(0));

export interface Analysis {
  what: string;
  flags: [Status, string][];
  questions: string[];
  /** Rough size that can leave within a day: a heuristic, stated as one. */
  capacity: { usd: number; basis: string } | null;
  grade: { t: Status; label: string };
}

/**
 * The part of an asset profile that is dawns' own reading: what the asset is, what stands
 * out in the data, what to investigate next. Deterministic, built only from measured
 * fields, and never a buy or sell call.
 */
export function analyse(a: Asset): Analysis {
  const cur = CURATED[a.id];
  const flags: [Status, string][] = [...(cur?.flags ?? [])];
  const questions: string[] = [...(cur?.questions ?? [])];

  // price and market
  if (a.price == null) flags.push(["warn", "No market price dawns can read. Any value put on it is a guess."]);
  else if (a.priceSrc?.startsWith("OTC")) flags.push(["warn", `Priced from OTC desk quotes only${a.priceSrc.includes("(") ? " " + a.priceSrc.slice(a.priceSrc.indexOf("(")) : ""}. No DEX pool or public order book dawns reads.`]);
  else if (a.priceSrc?.startsWith("Igra explorer")) flags.push(["info", "Price comes from the Igra explorer, not from pools dawns reads itself."]);

  const thin = (a.vol24 ?? 0) < 1_000 && (a.liquidity ?? 0) < 10_000;
  if (a.price != null && thin) flags.push(["warn", `Thin market: ${a.vol24 != null ? usd(a.vol24) + " traded in 24h" : "no measured volume"}${a.liquidity ? `, ${usd(a.liquidity)} in DEX pools` : ""}. Entering or leaving moves the price.`]);

  // distribution
  if (a.top10 != null) {
    // contracts (pools, lending markets, bridges) hold on behalf of many; wallets do not
    const inContracts = (a.topHolders ?? []).filter((h) => h.contract).reduce((s, h) => s + h.share, 0);
    const wallets = Math.max(0, a.top10 - inContracts);
    const t: Status = wallets >= 0.8 ? "crit" : wallets >= 0.5 ? "warn" : "good";
    flags.push([t, `The 10 largest addresses hold ${pct(a.top10)} of supply${inContracts >= 0.01 ? `: ${pct(inContracts)} in contracts (pools, markets, bridges), ${pct(wallets)} in wallets` : ""}.`]);
    if (wallets >= 0.5) questions.push("Who are the largest holders: exchanges, the team, or individuals? Can they exit into the available liquidity?");
  }
  if (a.holders != null && a.holders < 100 && a.standard !== "native") flags.push(["warn", `Only ${n(a.holders)} holders.`]);

  // supply
  if (a.standard === "krc20") {
    if (a.state === "minting" && a.mintedShare != null) {
      flags.push(["info", `Still minting: ${pct(a.mintedShare, 1)} of the maximum is minted. Supply grows until minting ends.`]);
      questions.push("How fast is it being minted, and by how many distinct wallets?");
    }
    if (a.premineShare != null && a.premineShare > 0) {
      flags.push([a.premineShare >= 0.1 ? "warn" : "info", `${pct(a.premineShare, 1)} of the maximum supply was pre-minted to the deployer.`]);
      questions.push("What is the pre-mint for, and is it locked or already moving?");
    }
  }
  if (a.net?.inflation != null) flags.push([a.net.inflation >= 0.2 ? "warn" : "info", `New supply over the next 12 months, on its schedule: about ${pct(a.net.inflation, a.net.inflation >= 1 ? 0 : 1)} of today's circulating supply.`]);
  if (a.net?.mergedShare != null) flags.push(["info", `Hashrate equals ${pct(a.net.mergedShare, 1)} of Kaspa's. With merged mining, that is at most the share of Kaspa's work also securing ${a.symbol}.`]);
  if (a.net?.shielded && a.net.shielded.turnstileOut === 0) flags.push(["info", "No coins have ever left the shielded pool: every coin minted is still shielded."]);

  if (a.standard === "erc20" && BRIDGED.test(a.symbol)) {
    flags.push(["info", `A bridged or wrapped asset: its value on ${CHAIN_NAME[a.chain]} depends on the bridge or custodian that issued it.`]);
    questions.push("Which bridge issued it, what backs it, and how long do exits take?");
  }
  if (!a.pools.length && a.standard !== "native") questions.push("Is there any DeFi venue for it at all, or is holding the only option?");

  // capacity: what could leave in a day without dominating the market (heuristic)
  let capacity: Analysis["capacity"] = null;
  const dexCap = a.liquidity ? a.liquidity * 0.02 : 0;         // ~2% price impact on one pool side
  const volCap = a.vol24 ? a.vol24 * 0.1 : 0;                  // 10% of a day's volume
  if (dexCap || volCap) capacity = dexCap >= volCap
    ? { usd: dexCap, basis: "about a 2% price move in the DEX pools dawns reads" }
    : { usd: volCap, basis: "10% of a day's traded volume" };

  const what = cur?.what ?? generated(a);
  const worst = flags.some((f) => f[0] === "crit") ? "crit" : flags.some((f) => f[0] === "warn") ? "warn" : "good";
  const grade = { t: worst as Status, label: worst === "crit" ? "High risk signals" : worst === "warn" ? "Open questions" : "No flags raised" };
  return { what, flags, questions: [...new Set(questions)].slice(0, 7), capacity, grade };
}

function generated(a: Asset): string {
  const std = a.standard === "krc20" ? "A KRC-20 token on Kaspa L1, issued through Kasplex inscriptions" : `An ${STANDARD_NAME[a.standard]} token on ${CHAIN_NAME[a.chain]}`;
  const parts: string[] = [std + "."];
  if (a.standard === "krc20") {
    if (a.premineShare === 0) parts.push("It was fair-minted: no pre-mint to the deployer.");
    else if (a.premineShare != null) parts.push(`${pct(a.premineShare, 1)} of the maximum supply was pre-minted to the deployer.`);
    if (a.state === "finished") parts.push("Minting is complete, so supply is fixed.");
  }
  if (a.holders != null) parts.push(`${n(a.holders)} addresses hold it${a.top10 != null ? `; the 10 largest have ${pct(a.top10)}` : ""}.`);
  if (a.price != null && a.mcap != null) parts.push(`At ${a.priceSrc?.startsWith("dawns") ? "dawns' on-chain" : "the"} price its supply is worth ${usd(a.mcap)}.`);
  if (a.pools.length) parts.push(`It is in ${a.pools.length} DeFi venue${a.pools.length > 1 ? "s" : ""} dawns watches.`);
  return parts.join(" ");
}
