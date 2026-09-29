import type { Asset, AssetDay } from "./types";
import { CHAIN_NAME, valueCredible } from "./types";
import type { Snapshot } from "../types";
import type { Stamp } from "@/components/research";
import { usd, pct, price } from "../format";

/**
 * The four key figures of an asset, each with how it is valued and whose number
 * it is. "Verified on-chain" only where dawns read it from the chain itself;
 * an indexer's or a market's figure is stamped as theirs.
 */
export interface Figure { label: string; value: string; sub?: string; tone?: "up" | "down"; basis: string; stamp: Stamp; sources?: [string, string][] }

/** The first sentence, for the banner: the page's one-line description. */
export function oneLine(s: string) {
  const m = s.match(/^.{20,220}?[.!?](\s|$)/);
  return (m ? m[0] : s.slice(0, 200)).trim();
}

const whole = (v: number | null) => (v == null ? "—" : v >= 1e9 ? `${(v / 1e9).toFixed(2)}B` : v >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}K` : v.toFixed(2));

/** Whose price is it: dawns' own pool read, an indexer, or a market that reports it. */
function priceStamp(a: Asset, asOf: number): Stamp {
  const src = a.priceSrc ?? "";
  if (/pool/i.test(src)) return { kind: "onchain", by: `${CHAIN_NAME[a.chain]} pools`, at: asOf };
  if (/blockscout|explorer/i.test(src)) return { kind: "indexed", by: "Blockscout (Igra explorer)", at: a.updatedAt };
  if (/kcc20/i.test(src)) return { kind: "indexed", by: "the KCC20 indexer", at: a.updatedAt };
  if (/kaspacom/i.test(src)) return { kind: "reported", by: "KaspaCom marketplace", at: a.updatedAt };
  if (/coingecko/i.test(src)) return { kind: "reported", by: "CoinGecko", at: a.updatedAt };
  if (/otc/i.test(src)) return { kind: "reported", by: "an OTC desk", at: a.updatedAt };
  return { kind: "reported", by: src || "its source", at: a.updatedAt };
}

/** Where the supply (and holder list) comes from, by kind of token. */
function supplySource(a: Asset): { by: string; kind: Stamp["kind"]; what: string } {
  if (a.standard === "native" && a.chain === "kaspa") return { by: "the Kaspa REST API", kind: "reported", what: "circulating supply as the Kaspa node reports it" };
  if (a.standard === "native") return { by: `the ${CHAIN_NAME[a.chain]} explorer`, kind: "indexed", what: "supply as the chain's explorer reports it" };
  if (a.standard === "krc20") return { by: "the Kasplex indexer", kind: "indexed", what: "minted supply from the KRC-20 index (KRC-20 balances live in the indexer, not in L1 state)" };
  if (a.standard === "erc20") return { by: a.chain === "igra" ? "Blockscout (Igra explorer)" : `the ${CHAIN_NAME[a.chain]} explorer`, kind: "indexed", what: "totalSupply() as the explorer indexes it" };
  return { by: "the KCC20 indexer", kind: "indexed", what: "supply from the covenant-token indexer, which rebuilds it from chain data" };
}

export function keyFigures(a: Asset, s: Snapshot, heldTotal: number, hist: AssetDay[]): Figure[] {
  const out: Figure[] = [];
  // price, and its move over 7 days from dawns' own daily record
  const p7 = a.price7 ?? hist.slice(-8, -7)[0]?.price ?? null;
  const ch = a.price != null && p7 ? a.price / p7 - 1 : null;
  const ps = priceStamp(a, s.asOf);
  out.push({
    label: "Price", value: price(a.price),
    sub: ch != null ? `${ch >= 0 ? "▲" : "▼"} ${pct(Math.abs(ch), 1)} · 7 days` : a.priceSrc ?? undefined, tone: ch == null ? undefined : ch >= 0 ? "up" : "down",
    basis: `${a.priceSrc ?? "No price source"}.${a.poolPrice != null && a.price != null && Math.abs(a.price / a.poolPrice - 1) >= 0.05 ? ` Its own ${CHAIN_NAME[a.chain]} pools price it at ${price(a.poolPrice)} (dawns reads them on-chain): what a sale there would fetch.` : ""}${ch != null ? " The 7-day change is from dawns' own daily record." : ""}`,
    stamp: ps,
  });
  const ss = supplySource(a);
  out.push({
    label: a.standard === "native" ? "Market value" : "Value on chain", value: a.mcap != null ? usd(a.mcap) : "—",
    sub: `${whole(a.supply)} ${a.symbol} circulating`,
    basis: `Price × circulating supply. Supply: ${ss.what}.${a.mcap != null && !valueCredible(a) ? " Not realizable: too little trades to sell anywhere near this." : ""}`,
    stamp: { kind: ss.kind, by: ss.by, at: a.updatedAt },
  });
  out.push(a.chain === "zkas" ? {
    label: "Holders", value: "Shielded", sub: "balances are private by design",
    basis: "ZKas balances are shielded: no one, dawns included, can count holders.", stamp: { kind: "reported", by: "the ZKas design", at: null },
  } : {
    label: "Holders", value: a.holders != null ? a.holders.toLocaleString("en-US") : "—",
    sub: a.holders7 != null && a.holders != null ? `${a.holders - a.holders7 >= 0 ? "+" : "−"}${Math.abs(a.holders - a.holders7).toLocaleString("en-US")} in 7 days` : a.top10 != null ? `top 10 hold ${pct(a.top10, 0)}` : undefined,
    basis: `Addresses with a balance, from ${ss.by}${a.top10 != null ? `; the ten largest hold ${pct(a.top10, 1)}` : ""}. One owner can use many addresses and an exchange holds for many owners, so this counts addresses, not people.`,
    stamp: { kind: "indexed", by: ss.by, at: a.holdersAt ?? a.updatedAt },
  });
  if (a.liquidity != null && a.liquidity > 0) out.push({
    label: "Liquidity", value: usd(a.liquidity), sub: a.depth ? `${usd(a.depth.d10)} sells before −10%` : "in DEX pools dawns reads",
    basis: `Its side of every DEX pool dawns reads on Igra and Kasplex: pool reserves read from the chain, valued at dawns' price map.${a.depth ? ` Depth is simulated against the same reserves: ${usd(a.depth.d2)} before a 2% move, ${usd(a.depth.d10)} before 10%.` : ""}`,
    stamp: { kind: "onchain", by: "Igra and Kasplex RPC", at: s.asOf },
  });
  else if (heldTotal > 0) out.push({
    label: "In protocols", value: usd(heldTotal), sub: "pools and lending markets",
    basis: "Half of each pool's value per token plus what is supplied to each lending market, from dawns' on-chain reads of those contracts.",
    stamp: { kind: "onchain", by: "Igra and Kasplex RPC", at: s.asOf },
  });
  else out.push({
    label: "Volume, 24h", value: a.vol24 != null ? usd(a.vol24) : "—", sub: a.volSrc ?? "no trading source",
    basis: a.vol24 != null ? `${a.volSrc}. Traded volume, not depth: it says how much changed hands, not how much could.` : "No venue dawns knows reports trading in it.",
    stamp: { kind: "reported", by: a.volSrc?.split(",")[0] ?? "—", at: a.updatedAt },
  });
  return out;
}
