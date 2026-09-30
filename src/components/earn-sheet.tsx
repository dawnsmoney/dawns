import Link from "next/link";
import { AreaChart } from "./charts";
import { AssetCoin } from "./bits";
import { WatchButton } from "./actions";
import { UseOpportunity } from "./use-opportunity";
import { EarnWatchToggle } from "./earn-watch";
import { EarnTags } from "./earn";
import { HAVES, earnName, lines, type Have } from "@/lib/earn";
import type { OppIntel } from "@/lib/intel";
import type { ActPlan } from "@/lib/act";
import type { Opportunity, ProtocolView } from "@/lib/types";
import { usd } from "@/lib/format";

const pct = (x: number, d = 1) => `${(x * 100).toFixed(d)}%`;
const DAY = 86_400_000;

/**
 * One Earn option as a product sheet: its numbers, where the yield comes from, how you
 * leave, what the chain enforces and what you would be trusting, then the deposit
 * itself (the same checked, wallet-signed flow as Opportunities). Desktop and phone.
 */
export function EarnSheet({ o, p, it, plan, asOf, stamp }: { o: Opportunity; p: ProtocolView | undefined; it: OppIntel | undefined; plan: ActPlan; asOf: number; stamp: string }) {
  const have: Have = HAVES.find((h) => o.assets.some(h.match))?.key ?? "kas";
  const tags = it?.tags.filter((t) => t.key !== "new") ?? [];
  const { leave, risk } = lines(o, have, tags);
  const lp = o.kind === "lp";
  const v3 = o.notes.some((n) => /concentrated/i.test(n)) || /-v3:/i.test(o.id);
  const other = lp ? o.assets.find((a) => !HAVES.find((h) => h.key === have)!.match(a)) ?? o.assets[1] : null;
  const series = it?.series ?? [];
  const today = Math.floor(asOf / DAY) * DAY;
  const dates = series.map((_, i) => today - (series.length - i) * DAY);
  const flags = (p?.flags ?? []).filter(([t]) => t !== "good").slice(0, 3);
  return (
    <div className="esheet">
      <div className="esheet-top">
        <Link href={`/earn?have=${have}`} className="muted">← Earn on {HAVES.find((h) => h.key === have)!.label}</Link>
        <span className="mono muted" style={{ fontSize: 12.5 }}>{stamp}</span>
      </div>

      <div className="esheet-title">
        <span className="earn-coins">{o.assets.slice(0, 2).map((a, i) => <span key={a + i} style={{ marginLeft: i ? -12 : 0 }}><AssetCoin a={a} size={44} /></span>)}</span>
        <div>
          <h1>{earnName(o)}</h1>
          <span className="muted">{o.pname} · {o.chain === "igra" ? "Igra" : "Kasplex"}{lp ? (v3 ? " · concentrated liquidity" : " · liquidity pool") : " · lending"}</span>
          <EarnTags tags={tags} />
        </div>
      </div>

      <div className="card esheet-stats">
        <div><span>Native yield, 7 days</span><b>{o.apy != null ? pct(o.apy, o.apy < 0.1 ? 2 : 1) : "Measuring"}</b><small>{o.farm?.on && o.farm.apr != null ? `plus ${pct(o.farm.apr, 0)} in ${o.farm.reward}, paid apart` : "no incentives added in"}</small></div>
        <div><span>{lp ? "In the pool" : "Supplied"}</span><b>{usd(o.size)}</b><small>{lp ? "both sides, at today's prices" : "in the market"}</small></div>
        {lp
          ? <div><span>Traded, 24 hours</span><b>{o.vol24 != null ? usd(o.vol24) : "—"}</b><small>{o.turnover != null ? `${o.turnover.toFixed(1)}× the pool` : "measuring"}</small></div>
          : <div><span>Withdrawable now</span><b>{o.exitNow != null ? usd(o.exitNow) : "—"}</b><small>{o.exitShare != null ? `${pct(o.exitShare, 0)} of supplied` : "cash in the market"}</small></div>}
        {lp
          ? <div><span>Price range, 7 days</span><b>{o.priceMove != null ? pct(o.priceMove, 1) : "—"}</b><small>{o.ilAtMove != null ? `an LP trailed holding by ${pct(o.ilAtMove, o.ilAtMove < 0.01 ? 2 : 1)}` : "measuring"}</small></div>
          : <div><span>Rate range</span><b>{o.apyRange ? `${pct(o.apyRange[0])}–${pct(o.apyRange[1])}` : "—"}</b><small>{o.apyRange ? `last ${Math.round(o.rangeHours)} h` : "measuring"}</small></div>}
      </div>

      {series.length >= 2 && (
        <div className="card">
          <div className="c-head"><h3>Native yield, daily</h3><span className="tag">measured, not promised</span></div>
          <AreaChart label={`${earnName(o)} native yield, daily`} dates={dates} series={[{ name: "Native yield", color: "#8578E6", values: series }]} fmt="pct" zero stats height={210} />
        </div>
      )}

      <div className="grid g2">
        <div className="card esheet-block">
          <h3>Where the yield comes from</h3>
          <p>{o.apyBasis}.{lp ? ` Traders pay the fee on every swap and it goes to the liquidity${v3 ? " in range" : ""}; dawns measures it from the swaps it indexes: a day's volume × the fee ÷ the pool, per year.` : " Borrowers pay interest set by the market's rate model; the more of the market is lent out, the higher the rate."}</p>
          <p className="muted" style={{ fontSize: 13.5 }}>{o.farm?.on ? `${o.farm.reward} incentives are paid on top by the farm and shown apart: they are not yield the market earns.` : "No token incentives are added in."}</p>
        </div>
        <div className="card esheet-block">
          <h3>How you leave</h3>
          <p><b>{leave.head}.</b> {leave.sub}</p>
          <p className="muted" style={{ fontSize: 13.5 }}>{lp ? `You get back ${o.assets.join(" and ")} in the pool's ratio at that moment.` : `Withdrawals are paid from cash in the market; when it runs short, you wait for borrowers to repay.`}</p>
        </div>
      </div>

      <div className="card esheet-trust">
        <div>
          <h3>What the chain enforces</h3>
          {(lp
            ? ["Your share of the pool is yours", "Fees are paid by the pool's own math", "You withdraw without anyone's permission"]
            : [`Your deposit is a balance only you can withdraw`, "Interest follows the market's rate model", "You withdraw without anyone's permission, while cash is there"]).map((x) => <div key={x} className="esheet-row"><span>{x}</span><span className="ok">✓ on-chain</span></div>)}
        </div>
        <div>
          <h3>What you would be trusting</h3>
          <div className="esheet-row"><span>{o.pname}&apos;s contracts and whoever controls them</span><Link href={`/protocols/${o.protocol}`}>{p ? p.statusText : "health"} →</Link></div>
          {lp && other && <div className="esheet-row"><span>{other}, half your deposit</span><span className="warn">its price and issuer</span></div>}
          {v3 && <div className="esheet-row"><span>The price staying in your range</span><span className="warn">else fees stop</span></div>}
          {!lp && <div className="esheet-row"><span>Borrowers, and the oracle that prices them</span><span className="warn">liquidations</span></div>}
          {flags.map(([t, f]) => <div key={f} className="esheet-row"><span>{f}</span><span className={t === "crit" ? "crit" : "warn"}>{o.pname}-wide</span></div>)}
        </div>
      </div>

      <div className="card esheet-block">
        <h3>Main risk: {risk.head.toLowerCase()}</h3>
        <p>{risk.sub}</p>
      </div>

      <div id="earn" className="esheet-earn">
        <div className="c-head" style={{ marginBottom: 12 }}>
          <h2>Earn with this</h2>
          <WatchButton id={o.protocol} label={`Alerts for ${o.pname}`} />
        </div>
        {have === "kas" && <p className="esheet-note">This runs on {o.chain === "igra" ? "Igra" : "Kasplex"}, where KAS is {o.chain === "igra" ? "iKAS" : "bridged KAS"}. Holding KAS on Kaspa itself? Bridge it first; <Link href="/bridge">the bridge page</Link> shows how exits are being paid.</p>}
        <UseOpportunity o={o} plan={plan} />
        <EarnWatchToggle opp={o.id} kind={o.kind} />
        <p className="muted" style={{ fontSize: 13, margin: "12px 0 0" }}>dawns builds and checks each transaction; your wallet signs it. dawns never holds your funds. Research, not advice.</p>
      </div>
    </div>
  );
}
