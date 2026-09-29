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
        const inc = m.incentives?.filter((x) => x.supplyPerDay > 0) ?? [];
        if (inc.length) for (const x of inc) notes.push(`${x.symbol} incentives: ${Math.round(x.supplyPerDay).toLocaleString("en-US")} ${x.symbol} a day to this market's suppliers${x.supplyApr != null ? `, ${pct(x.supplyApr, 1)} a year at the ${x.symbol} market price` : ""}, until ${new Date(x.end * 1000).toISOString().slice(0, 10)}. Paid in ${x.symbol}, never added to yield.`);
        else notes.push("No token incentives on this market now.");
        out.push({
          id: `${p.id}:${m.symbol}`, kind: "supply", protocol: p.id, pname: p.name, chain: "igra",
          name: `Supply ${m.symbol}`, assets: [m.symbol],
          apy: m.supplyApy, apyBasis: "Paid by borrowers · current rate", apyShort: "Paid by borrowers",
          apyRange: rng && rng.hours >= 1 ? [rng.apyMin, rng.apyMax] : null, rangeHours: rng?.hours ?? 0,
          size: m.suppliedUsd, exitNow: m.cashUsd, exitShare,
          vol24: null, swaps24: null, turnover: null, priceMove: null, ilAtMove: null,
          status, statusText, notes, assetIds: [`igra:erc20:${m.asset.toLowerCase()}`],
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
        const lpOpp: Opportunity = {
          id: `${p.id}:${key}`, kind: "lp", protocol: p.id, pname: p.name, chain: pool.chain,
          name: `${pool.symbols.join(" / ")} liquidity`, assets: [...pool.symbols],
          apy, apyBasis: basis, apyShort: short, apyRange: null, rangeHours: rg?.hours ?? 0,
          size: pool.usd, exitNow: pool.usd, exitShare: null,
          vol24: pr && covered >= DAY ? pr.vol24 : null, swaps24: pr && covered >= DAY ? pr.swaps24 : null, turnover, priceMove, ilAtMove,
          status, statusText, notes, pair: pool.pair, feeTier: feeRate,
          assetIds: pool.tk.map((t) => `${pool.chain}:erc20:${t.a.toLowerCase()}`),
        };
        out.push(lpOpp);

        /* ---- farm: the same LP staked for the protocol's token ---- */
        for (const f of p.dex.farms ?? []) {
          const fp = f.pools.find((q) => q.pair === key);
          if (!fp) continue;
          const on = f.perDay > 0 && fp.active && fp.perDay > 0;
          const since = f.history?.length ? f.history[f.history.length - 1] : null;
          const offSince = !on && since && since.perBlock === 0 ? new Date(since.t).toISOString().slice(0, 10) : null;
          const fnotes = [
            on ? `Farm rewards: ${Math.round(fp.perDay).toLocaleString("en-US")} ${f.reward.sym} a day to this pool (${pct(fp.allocShare, 0)} of the farm's ${Math.round(f.perDay).toLocaleString("en-US")})${fp.apr != null ? `, ${pct(fp.apr, 1)} a year on the LP staked at the ${f.reward.sym} market price${fp.aprPool != null ? `, ${pct(fp.aprPool, 1)} at its pool price` : ""}` : ""}. Paid in ${f.reward.sym}, never added to yield.`
              : `Farm rewards are off${offSince ? ` since ${offSince} (the owner set the rate to 0)` : ""}: staking this LP earns only the pool's trading fees, the same as not staking.`,
            `The farm holds ${Math.round(f.budget).toLocaleString("en-US")} ${f.reward.sym}${f.budgetDays != null ? `, enough for ${Math.round(f.budgetDays)} days at today's rate` : ""}. Its owner can change the rate or the pools at any time.`,
            `Emergency withdrawal costs ${pct(f.emergencyFeeBps / 10_000, 0)} of the stake${f.lockSec ? `; stakes are locked ${Math.round(f.lockSec / 3600)} h` : "; no locking period"}.`,
            `${pct(fp.stakedShare, 0)} of this pool's LP is staked in the farm.`,
            "The farm contract is not verified on the explorer: one more contract between you and the pool.",
            ...lpOpp.notes.filter((n) => !n.startsWith("Yield:")),
          ];
          const [fs, ft]: [Status, string] = !on ? ["warn", "Rewards off"] : lpOpp.status === "good" ? ["good", "Rewards on"] : [lpOpp.status, lpOpp.statusText];
          out.push({
            ...lpOpp, id: `${p.id}:farm:${key}`, name: `${pool.symbols.join(" / ")} farm`,
            apyBasis: `${lpOpp.apyBasis} · staked in the ${p.name} farm; ${f.reward.sym} rewards shown separately`, apyShort: lpOpp.apyShort,
            status: fs, statusText: ft, notes: fnotes,
            farm: { address: f.address, reward: f.reward.sym, perDay: fp.perDay, apr: on ? fp.apr : 0, aprPool: on ? fp.aprPool : 0, on, since: since?.t ?? null, budgetDays: f.budgetDays, emergencyFeeBps: f.emergencyFeeBps, lockSec: f.lockSec, stakedShare: fp.stakedShare },
          });
        }
      }
    }
  }
  return out.sort((a, b) => (b.apy ?? -1) - (a.apy ?? -1) || b.size - a.size);
}
