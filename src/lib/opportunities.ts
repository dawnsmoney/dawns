import type { OwnData } from "./history";
import type { Opportunity, ProtocolView, Status } from "./types";
import { usd, pct } from "./format";

const MIN_SIZE = 5_000;          // below this a pool or market is too small to list
const DAY = 86_400_000;

/**
 * Native yield only, next to what it costs to leave. Token incentives are never added in.
 * Lending: the current supply rate, and the cash that can be withdrawn right now.
 * Liquidity: fees earned on swap volume dawns read on-chain, and the price range the pool went through.
 */
export function buildOpportunities(protocols: ProtocolView[], own: OwnData | null, now: number): Opportunity[] {
  const out: Opportunity[] = [];
  const caughtUp = !!own?.indexedUpTo && own.indexedUpTo > now - 45 * 60_000;
  const covered = caughtUp && own?.indexedSince ? now - own.indexedSince : 0;

  for (const p of protocols) {
    /* ---- lending: supply a market ---- */
    if (p.lending) {
      for (const m of p.lending.markets) {
        if (m.suppliedUsd < MIN_SIZE) continue;
        const rng = own?.marketRange.get(`${p.id}:${m.symbol}`) ?? null;
        const exitShare = m.suppliedUsd ? Math.min(1, m.cashUsd / m.suppliedUsd) : null;
        const [status, statusText]: [Status, string] = m.utilization >= 0.95 ? ["crit", "Exit blocked"] : m.frozen ? ["warn", "Frozen"] : m.utilization >= 0.8 ? ["warn", "Tight"] : ["good", "Open"];
        const notes: string[] = [];
        if (m.utilization >= 0.95) notes.push(`The rate is high because suppliers cannot leave: only ${usd(m.cashUsd)} can be withdrawn now.`);
        else if (rng && rng.utilMax >= 0.95 && rng.hours >= 1) notes.push(`Utilization reached ${pct(rng.utilMax, 0)} in the last ${Math.round(rng.hours)} h, when withdrawals were blocked.`);
        if (m.frozen) notes.push("Frozen: no new deposits or borrows.");
        if (m.oracleError === "StalePrice") notes.push("Kaskad's price oracle is stale: borrowers cannot withdraw collateral and liquidations fail until it updates. Suppliers without loans can still withdraw.");
        else if (!m.oracleOk) notes.push("Kaskad's price oracle reverts for this asset.");
        else if (m.oracleDeviation != null && Math.abs(m.oracleDeviation) >= 0.02) notes.push(`Oracle price is ${pct(Math.abs(m.oracleDeviation))} off market.`);
        if (!p.lending.aclAdminIsContract) notes.push("The protocol admin is a single key.");
        notes.push("KSKD incentives are not included.");
        out.push({
          id: `${p.id}:${m.symbol}`, kind: "supply", protocol: p.id, pname: p.name, chain: "igra",
          name: `Supply ${m.symbol}`, assets: [m.symbol],
          apy: m.supplyApy, apyBasis: "Paid by borrowers · current rate", apyShort: "Paid by borrowers",
          apyRange: rng && rng.hours >= 1 ? [rng.apyMin, rng.apyMax] : null, rangeHours: rng?.hours ?? 0,
          size: m.suppliedUsd, exitNow: m.cashUsd, exitShare,
          vol24: null, swaps24: null, turnover: null, priceMove: null, ilAtMove: null,
          status, statusText, notes,
        });
      }
    }

    /* ---- liquidity: provide to a pool ---- */
    if (p.dex) {
      for (const pool of p.dex.pools) {
        if (pool.usd < MIN_SIZE) continue;
        const key = pool.pair.toLowerCase();
        const pr = own?.pairs.get(key) ?? null;
        const feeRate = pool.kind === "v3" ? (pool.fee != null ? pool.fee / 1e6 : null) : p.dex.feeRate;
        const lpShare = pool.lpShare ?? p.dex.lpShare ?? 1;
        const feeSrc = pool.kind === "v3" ? "fee tier on-chain" : p.dex.feeSource === "on-chain" ? `median fee of ${p.dex.feeSamples} swaps` : "fee rate from DefiLlama";
        let apy: number | null = null;
        let basis = "Measuring: dawns needs 24 hours of swaps";
        let short = "Measuring (24 h)";
        if (feeRate == null) { basis = "Fee rate unknown"; short = basis; }
        else if (covered >= DAY) {
          const full = covered >= 6.9 * DAY;
          const daily = full ? (pr?.vol7 ?? 0) / 7 : (pr?.vol24 ?? 0);
          apy = (daily * feeRate * lpShare * 365) / pool.usd;
          basis = `${pct(feeRate * lpShare, 2)} to LPs (${feeSrc}) on ${full ? "7-day average" : "last 24h"} swap volume`;
          short = `${pct(feeRate * lpShare, 2)} fees · ${full ? "7-day" : "24h"} volume`;
        }
        // price range: current reserves plus every hourly reading of the last 7 days
        const cur = pool.reserves[0] > 0 ? pool.reserves[1] / pool.reserves[0] : null;
        const rg = own?.pairRange.get(key) ?? null;
        let priceMove: number | null = null, ilAtMove: number | null = null;
        if (cur && rg && rg.hours >= 1) {
          const r = Math.max(rg.max, cur) / Math.min(rg.min, cur);
          priceMove = r - 1;
          ilAtMove = 1 - (2 * Math.sqrt(r)) / (1 + r);
        }
        const turnover = pr && covered >= DAY ? pr.vol24 / pool.usd : null;
        const notes: string[] = [...(apy != null ? [`Yield: ${basis}.`] : []), `Exposed to the price of both ${pool.symbols.join(" and ")}.`];
        if (ilAtMove != null && ilAtMove >= 0.005) notes.push(`The price moved ${pct(priceMove!, 0)} within ${Math.round(rg!.hours)} h; at that move an LP trails simply holding by ${pct(ilAtMove, 1)}.`);
        if (turnover != null && turnover >= 3) notes.push(`Volume is ${turnover.toFixed(0)}× the pool per day. High turnover can be one wallet trading back and forth; check before trusting the yield.`);
        if (pool.kind === "v3") notes.push("Concentrated liquidity: you earn only while the price is in your range. The yield shown is for the pool as a whole.");
        if (pool.tk.some((t) => t.px == null)) notes.push("One token has no reliable price; value counts the priced side only.");
        if (lpShare < 0.999) notes.push(`${pct(1 - lpShare, 0)} of trading fees go to the protocol, not LPs (read on-chain).`);
        const [status, statusText]: [Status, string] = turnover != null && turnover >= 3 ? ["warn", "Check volume"] : ilAtMove != null && ilAtMove >= 0.05 ? ["warn", "Volatile"] : ["good", "Open"];
        out.push({
          id: `${p.id}:${key}`, kind: "lp", protocol: p.id, pname: p.name, chain: pool.chain,
          name: `${pool.symbols.join(" / ")} liquidity`, assets: [...pool.symbols],
          apy, apyBasis: basis, apyShort: short, apyRange: null, rangeHours: rg?.hours ?? 0,
          size: pool.usd, exitNow: pool.usd, exitShare: null,
          vol24: pr && covered >= DAY ? pr.vol24 : null, swaps24: pr && covered >= DAY ? pr.swaps24 : null, turnover, priceMove, ilAtMove,
          status, statusText, notes, pair: pool.pair, feeTier: feeRate,
        });
      }
    }
  }
  return out.sort((a, b) => (b.apy ?? -1) - (a.apy ?? -1) || b.size - a.size);
}
