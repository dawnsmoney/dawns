import type { Snapshot } from "./types";
import { usd, pct } from "./format";

/** The shareable morning report: home page, Telegram channel and /status. */
export function dawnReport(s: Snapshot) {
  const top = s.signals.slice(0, 3).map((g) => `· ${g.strong}`).join("\n");
  const d = new Date(s.asOf);
  const date = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  const lend = s.protocols.find((p) => p.lending);
  return `dawns check · Kaspa DeFi · ${date}

TVL ${usd(s.eco.tvl)}${s.kasUsd ? ` · KAS $${s.kasUsd.toPrecision(3)}${s.kas24 != null ? ` (${s.kas24 >= 0 ? "+" : ""}${(s.kas24 * 100).toFixed(1)}% 24h)` : ""}` : ""}
${lend?.lending ? `${lend.name}: ${usd(lend.lending.suppliedUsd)} supplied, ${usd(lend.lending.borrowedUsd)} borrowed, ${usd(lend.lending.cashUsd)} withdrawable\n` : ""}DEX liquidity ${usd(s.eco.dexLiq)}
${s.bridge ? `iKAS backing ${pct(s.bridge.coverage)} (${Math.round(s.bridge.lockedKas).toLocaleString("en-US")} KAS locked on L1)\n` : ""}${top ? `\nWorth a look:\n${top}\n` : ""}
Read on-chain, every number traceable.
dawns.money`;
}

