import type { Status } from "../types";
import { CHAIN_NAME, STANDARD_NAME, valueCredible, type Asset } from "./types";
import { CURATED, BRIDGED } from "./profiles";
import { holderCat } from "./holders";

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

  const otc = !!a.priceSrc?.startsWith("OTC");
  if (a.poolPrice != null && a.price != null && Math.abs(a.price / a.poolPrice - 1) >= 0.2)
    flags.push(["warn", `Its pools on ${CHAIN_NAME[a.chain]} price it at ${a.price > a.poolPrice ? `${(a.price / a.poolPrice).toFixed(1)}× less` : `${(a.poolPrice / a.price).toFixed(1)}× more`} than the headline price. What you could sell for here is the pool price.`]);
  const thin = (a.vol24 ?? 0) < 1_000 && (a.liquidity ?? 0) < 10_000;
  if (a.mcap != null && !valueCredible(a))
    flags.push(["warn", `Its supply is priced at ${usd(a.mcap)}, but only ${usd(Math.max(a.vol7 ?? 0, a.vol24 ?? 0))} traded in the last 7 days${a.liquidity ? ` and ${usd(a.liquidity)} sits in DEX pools` : ""}. That value could not be realized.`]);
  else if (a.price != null && thin && !otc) flags.push(["warn", `Thin market: ${a.vol24 != null ? usd(a.vol24) + " traded in 24h" : "no measured volume"}${a.liquidity ? `, ${usd(a.liquidity)} in DEX pools` : ""}. Entering or leaving moves the price.`]);

  // distribution
  if (a.top10 != null) {
    // who holds it, by kind: pools/markets/staking and exchanges hold for many; vesting and
    // treasuries are supply that can come to market later; burned supply is gone
    const by = (keys: string[]) => (a.topHolders ?? []).filter((h) => keys.includes(holderCat(h))).reduce((s, h) => s + h.share, 0);
    const forMany = by(["pool", "staking", "exchange"]);
    const locked = by(["vesting", "multisig", "contract"]);
    const burned = by(["burn"]);
    const wallets = by(["wallet"]);
    const t: Status = wallets >= 0.8 ? "crit" : wallets >= 0.5 ? "warn" : "good";
    flags.push([t, `The 10 largest addresses hold ${pct(a.top10)} of supply: ${[forMany >= 0.01 && `${pct(forMany)} in pools, markets, staking and exchanges`, locked >= 0.01 && `${pct(locked)} in vesting, treasuries and other contracts`, burned >= 0.01 && `${pct(burned)} burned`, `${pct(wallets)} in large wallets`].filter(Boolean).join(", ")}.`]);
    if (locked >= 0.3) {
      flags.push(["warn", `${pct(locked)} of supply sits in vesting contracts and treasuries: it can reach the market as it unlocks.`]);
      questions.push("What is the unlock schedule of the vesting and treasury holdings?");
    }
    if (forMany >= 0.1 && by(["exchange"]) >= 0.1) questions.push("How much of the supply on exchanges is liquid, and how quickly could it be sold?");
    if (wallets >= 0.5) questions.push("Who are the largest holders: the team, a fund, or individuals? Can they exit into the available liquidity?");
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
  const pr = a.net?.producers;
  if (pr) {
    const lead = pr.top[0]?.share ?? 0;
    flags.push([lead >= 0.5 || pr.toMajority <= 1 ? "crit" : lead >= 0.33 || pr.toMajority <= 2 ? "warn" : "good",
      `Block production: ${pr.toMajority} payout address${pr.toMajority > 1 ? "es" : ""} made over half of ${pr.sampled.toLocaleString("en-US")} sampled blocks; the largest made ${pct(lead)}. ${pr.distinct} distinct producers seen in ${pr.days} day${pr.days > 1 ? "s" : ""}.`]);
  }
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
  if (a.price != null && a.mcap != null && valueCredible(a)) parts.push(`At ${a.priceSrc?.startsWith("dawns") ? "dawns' on-chain" : "the"} price its supply is worth ${usd(a.mcap)}.`);
  else if (a.price != null && a.mcap != null) parts.push("It has a last trade price, but too little trading to put a meaningful value on its supply.");
  if (a.pools.length) parts.push(`It is in ${a.pools.length} DeFi venue${a.pools.length > 1 ? "s" : ""} dawns watches.`);
  return parts.join(" ");
}

/**
 * The reading as a scorecard: one tile per dimension, each with a status, a headline number
 * and a few words. Built from the same measured fields as the flags.
 */
export function dimensions(a: Asset, r: Analysis): { key: string; title: string; t: Status; big: string; small: string }[] {
  const tiles: { key: string; title: string; t: Status; big: string; small: string }[] = [];
  const find = (re: RegExp) => r.flags.find(([, f]) => re.test(f));
  // market
  const credible = valueCredible(a);
  const otc = !!a.priceSrc?.startsWith("OTC");
  tiles.push(a.price == null
    ? { key: "market", title: "Market", t: "warn", big: "No price", small: "nothing dawns can read" }
    : !credible && a.mcap != null
      ? { key: "market", title: "Market", t: "warn", big: usd(Math.max(a.vol7 ?? 0, a.vol24 ?? 0)), small: "traded in 7 days: too thin to value it" }
      : { key: "market", title: "Market", t: otc ? "warn" : "good", big: a.vol24 != null ? usd(a.vol24) : a.liquidity ? usd(a.liquidity) : "—", small: otc ? "OTC quotes only" : a.vol24 != null ? "traded in 24h" : "in DEX pools" });
  // exit capacity
  tiles.push(r.capacity
    ? { key: "exit", title: "Exit in a day", t: r.capacity.usd >= 50_000 ? "good" : r.capacity.usd >= 5_000 ? "info" : "warn", big: `≈ ${usd(r.capacity.usd)}`, small: r.capacity.basis.startsWith("about") ? "at a 2% price move" : "10% of daily volume" }
    : { key: "exit", title: "Exit in a day", t: "warn", big: "—", small: "no measured market" });
  // holders
  const conc = find(/largest addresses hold/);
  if (a.top10 != null && conc) tiles.push({ key: "holders", title: "Top 10 holders", t: conc[0], big: pct(a.top10), small: conc[0] === "good" ? "mostly pools, markets or exchanges" : "held by few wallets" });
  else if (a.chain === "zkas") tiles.push({ key: "holders", title: "Holders", t: "info", big: "Private", small: "shielded by design" });
  // supply
  const locked = find(/vesting contracts and treasuries/);
  if (a.net?.inflation != null) tiles.push({ key: "supply", title: "New supply, 12 months", t: a.net.inflation >= 0.2 ? "warn" : "good", big: `+${pct(a.net.inflation, a.net.inflation >= 1 ? 0 : 1)}`, small: "on its emission schedule" });
  else if (locked) tiles.push({ key: "supply", title: "Locked supply", t: "warn", big: locked[1].match(/^[\d.]+%/)?.[0] ?? "—", small: "vesting and treasuries" });
  else if (a.state === "minting" && a.mintedShare != null) tiles.push({ key: "supply", title: "Minted", t: "info", big: pct(a.mintedShare), small: "still minting" });
  else if (a.premineShare != null) tiles.push({ key: "supply", title: "Pre-minted", t: a.premineShare >= 0.1 ? "warn" : "good", big: pct(a.premineShare), small: a.premineShare === 0 ? "fair mint" : "to the deployer" });
  // security (native)
  const pr = a.net?.producers;
  if (pr) tiles.push({ key: "security", title: "Block producers for 50%", t: pr.toMajority <= 1 ? "crit" : pr.toMajority <= 2 ? "warn" : "good", big: String(pr.toMajority), small: `largest makes ${pct(pr.top[0]?.share ?? 0)}` });
  else if (a.net?.mergedShare != null) tiles.push({ key: "security", title: "Of Kaspa's hashrate", t: "info", big: pct(a.net.mergedShare, 1), small: "merge-mined" });
  // DeFi
  tiles.push({ key: "defi", title: "DeFi venues", t: a.pools.length ? "good" : "info", big: String(a.pools.length), small: a.pools.length ? "pools and markets dawns reads" : "only holding" });
  return tiles.slice(0, 6);
}
