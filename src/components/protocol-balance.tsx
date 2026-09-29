import type { ProtocolView } from "@/lib/types";
import { usd } from "@/lib/format";
import { BalanceSheet } from "./balance-sheet";

const BS_COL = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#9085e9"];
/** Top five, the rest as one line: a balance sheet stays readable at any size. */
function topLines(xs: { sym: string; usd: number }[], prefix = "") {
  const by = new Map<string, number>();
  for (const x of xs) if (x.usd > 0) by.set(x.sym, (by.get(x.sym) ?? 0) + x.usd);
  const all = [...by.entries()].sort((a, b) => b[1] - a[1]);
  const top = all.slice(0, 5).map(([sym, v], i) => ({ key: sym, label: `${prefix}${sym}`, value: v, color: BS_COL[i] }));
  const rest = all.slice(5).reduce((s, [, v]) => s + v, 0);
  return rest > 0 ? [...top, { key: "rest", label: `${all.length - 5} more`, value: rest, color: "#6E6788" }] : top;
}

/**
 * The same balance sheet for every protocol: what it holds against what it owes.
 * Pools owe their liquidity providers exactly what they hold, pro rata, so their
 * risk is price, not solvency; where dawns has not decoded what is owed, the
 * claims side says so instead of showing a zero.
 */
export function ProtocolBalance({ p }: { p: ProtocolView }) {
  const at = p.asOf ? `read at block #${p.asOf.block.toLocaleString("en-US")}` : "DefiLlama";
  if (p.lending) {
    const mk = [...p.lending.markets].sort((a, b) => b.suppliedUsd - a.suppliedUsd);
    return (
      <div className="card">
        <div className="c-head"><h3>Balance sheet</h3>{p.asOf && <span className="tag">read at block #{p.asOf.block.toLocaleString("en-US")}</span>}</div>
        <BalanceSheet fmt={usd}
          assets={[{ key: "cash", label: "Cash in the markets", value: mk.reduce((x, m) => x + m.cashUsd, 0), color: "#199e70", note: "withdrawable now" }, { key: "loans", label: "Outstanding loans", value: mk.reduce((x, m) => x + m.borrowedUsd, 0), color: "#3987e5", note: "owed by borrowers, collateralised" }]}
          claims={mk.map((m, i) => ({ key: m.symbol, label: `${m.symbol} suppliers`, value: m.suppliedUsd, color: BS_COL[i % BS_COL.length] }))}
          below={mk.reduce((x, m) => x + m.cashUsd + m.borrowedUsd - m.suppliedUsd, 0) > 0 ? { label: "Protocol reserves", value: mk.reduce((x, m) => x + m.cashUsd + m.borrowedUsd - m.suppliedUsd, 0), note: "accrued reserves on top of what suppliers are owed" } : null}
          assetsTag="cash + loans" claimsTag="redeemable by suppliers" ratioLabel="Asset coverage"
          basis={<>Assets: each aToken&apos;s underlying balance plus variable and stable debt; claims: each market&apos;s totalAToken; all read from the pool data provider at the block above and priced at Kaskad&apos;s own oracle (the price it would liquidate at). Coverage assumes loans are repaid or liquidated at those prices; click any figure in the calculation card for its trail.</>} />
      </div>
    );
  }
  if (p.dex) {
    const d = p.dex;
    const halves = d.pools.flatMap((x) => [{ sym: x.symbols[0], usd: x.usd / 2 }, { sym: x.symbols[1], usd: x.usd / 2 }]);
    const pooled = d.pools.reduce((s, x) => s + x.usd, 0);
    const inf = (d.infinity ?? []).filter((v) => v.usd != null && v.usd > 0);
    const infUsd = inf.reduce((s, v) => s + (v.usd ?? 0), 0);
    const staked = (d.farms ?? []).flatMap((f) => f.pools).reduce((s, x) => s + (x.stakedUsd ?? 0), 0);
    const budget = (d.farms ?? []).reduce((s, f) => s + (f.reward.px != null ? f.budget * f.reward.px : 0), 0);
    const days = (d.farms ?? []).map((f) => f.budgetDays).filter((x): x is number => x != null);
    return (
      <div className="card">
        <div className="c-head"><h3>Balance sheet</h3><span className="tag">{at}</span></div>
        <BalanceSheet fmt={usd}
          assets={[...topLines(halves, "In pools · "), ...(infUsd ? [{ key: "inf", label: "Single-sided vaults (Infinity)", value: infUsd, color: "#9085e9", note: inf.map((v) => v.symbol).join(", ") }] : [])]}
          claims={[{ key: "lp", label: "Liquidity providers", value: pooled, color: "#3987e5", note: staked ? `${usd(staked)} of it staked in the farm` : "LP tokens, redeemable pro rata" }, ...(infUsd ? [{ key: "x", label: "Vault share holders", value: infUsd, color: "#9085e9", note: "xTokens, redeemable at the vault's rate" }] : [])]}
          below={budget > 0 ? { title: "Incentives, beside the claims", label: "Farm rewards funded", value: budget, note: `reward tokens the farm holds${days.length ? `, ${Math.round(Math.min(...days))} days at today's rate` : ""}; incentives, owed only as they accrue` } : null}
          assetsTag="each pool split by its two tokens" claimsTag="pro rata" ratioLabel="Assets ÷ claims"
          basis={<>Pool reserves read on-chain at the block above, valued at dawns&apos; price map; each pool counted half to each token (exact for V2 pools, approximate for concentrated ones). A pool always owes its liquidity providers exactly what it holds, so coverage is 100% by construction: what can go wrong is the price of what it holds, not the pool&apos;s solvency.</>} />
      </div>
    );
  }
  const tok = p.tokens.filter((t) => t.usd > 0);
  if (!tok.length) return null;
  return (
    <div className="card">
      <div className="c-head"><h3>Balance sheet</h3><span className="tag">{p.source === "onchain" ? at : "DefiLlama composition"}</span></div>
      <BalanceSheet fmt={usd} assets={topLines(tok)} claims={[]} assetsTag={p.source === "onchain" ? "balances read on-chain" : "as DefiLlama reports it"}
        claimsEmpty={p.source === "onchain" ? `dawns reads what ${p.name}'s contracts hold, but has not decoded what it owes and to whom, so coverage cannot be shown.` : `dawns does not read ${p.name}'s contracts yet: the holdings are DefiLlama's, and what it owes is not known.`}
        basis={p.source === "onchain" ? <>Token balances of {p.name}&apos;s contracts, read on-chain and valued at dawns&apos; price map.</> : <>Composition from DefiLlama&apos;s adapter for {p.name}. Not verified by dawns.</>} />
    </div>
  );
}
