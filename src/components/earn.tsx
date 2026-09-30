import Link from "next/link";
import { AssetCoin } from "./bits";
import { HAVES, WINS, type EarnOption, type Excluded, type Have, type Win } from "@/lib/earn";
import type { Tag } from "@/lib/intel";
import type { VaultCard } from "@/lib/vaults/registry";
import { OwnVaultsNote } from "./own-vaults";

const pct = (x: number, d = 1) => `${(x * 100).toFixed(d)}%`;
const TONE: Record<Tag["tone"], string> = { up: "up", down: "down", warn: "warn", calm: "calm" };
const ARROW: Record<Tag["tone"], string> = { up: "▲ ", down: "▼ ", warn: "", calm: "" };

export function EarnTags({ tags }: { tags: Tag[] }) {
  if (!tags.length) return null;
  return <div className="earn-tags">{tags.map((t) => <span key={t.key} className={`earn-tag ${TONE[t.tone]}`} title={t.why}>{ARROW[t.tone]}{t.text}</span>)}</div>;
}

function Coins({ assets }: { assets: string[] }) {
  return <span className="earn-coins">{assets.slice(0, 2).map((a, i) => <span key={a + i} style={{ marginLeft: i ? -10 : 0 }}><AssetCoin a={a} size={34} /></span>)}</span>;
}

/**
 * The Earn page: pick the asset you hold and how soon you may need it back; the
 * options follow, each with where its yield comes from, how you leave and its main
 * risk. What was left out is listed with the reason. The chooser is plain links, so
 * every view has its own address to share.
 */
export function EarnBody({ have, win, options, excluded, vaults, stamp }: { have: Have; win: Win; options: EarnOption[]; excluded: Excluded[]; vaults: VaultCard[]; stamp: string }) {
  const h = HAVES.find((x) => x.key === have)!;
  const w = WINS.find((x) => x.key === win)!;
  const q = (k: Have, v: Win) => `/earn?have=${k}&win=${v}`;
  const n = options.length + vaults.length;
  return (
    <div className="earn">
      <div className="earn-pick">
        <div><span>I have</span><div className="earn-pills">{HAVES.map((x) => <Link key={x.key} href={q(x.key, win)} scroll={false} className={x.key === have ? "on" : ""} aria-current={x.key === have ? "page" : undefined}>{x.label}</Link>)}</div></div>
        <div><span>I may need it back</span><div className="earn-pills">{WINS.map((x) => <Link key={x.key} href={q(have, x.key)} scroll={false} className={x.key === win ? "on" : ""} aria-current={x.key === win ? "page" : undefined}>{x.label}</Link>)}</div></div>
      </div>

      <div className="earn-head">
        <div>
          <h2>{n ? `${n} way${n === 1 ? "" : "s"} to earn on ${h.label} you can take back ${w.short}` : `Nothing for ${h.label} ${w.short} today`}</h2>
          <p>Ordered by measured native yield. There is no single score: each line tells you something different.</p>
        </div>
        <span className="mono muted">{stamp}</span>
      </div>

      <div className="earn-list">
        {options.map((o) => (
          <article key={o.id} className="earn-opt">
            <div className="earn-who">
              <Coins assets={o.assets} />
              <div><Link href={o.href} className="earn-name">{o.name}</Link><small>{o.pname} · {o.chain === "igra" ? "Igra" : "Kasplex"}</small></div>
              <EarnTags tags={o.tags} />
            </div>
            <div className="earn-fact">
              <span>Native yield, 7 days</span>
              <b className="earn-apy">{o.apy != null ? pct(o.apy, o.apy < 0.1 ? 2 : 1) : "Measuring"}</b>
              <small>{o.source}{o.incentive ? ` · plus ${pct(o.incentive.apr, 0)} in ${o.incentive.reward} incentives, paid apart` : ""}</small>
            </div>
            <div className="earn-fact"><span>How you leave</span><b>{o.leave.head}</b><small>{o.leave.sub}</small></div>
            <div className="earn-fact"><span>Main risk</span><b>{o.risk.head}</b><small>{o.risk.sub}</small></div>
            <div className="earn-go">
              <Link href={o.href} className="btn ghost sm">Read the sheet</Link>
              <Link href={`${o.href}#earn`} className="btn sun sm">Earn with this</Link>
            </div>
          </article>
        ))}
        {vaults.map((v) => (
          <article key={v.id} className="earn-opt vault">
            <div className="earn-who">
              <span className="earn-coins"><AssetCoin a="KAS" size={34} /></span>
              <div>{v.href ? <Link href={v.href} className="earn-name">{v.name}</Link> : <span className="earn-name">{v.name}</span>}<small>{v.manager} · Kaspa L1 covenant</small></div>
              <div className="earn-tags"><span className="earn-tag vault">Testnet only</span><span className="earn-tag warn">Not audited</span></div>
            </div>
            <div className="earn-fact"><span>Native yield, share price</span>{v.yield ? <b className={`earn-apy${v.yield.change < 0 ? " down" : ""}`}>{v.yield.change >= 0 ? "+" : ""}{(v.yield.change * 100).toFixed(Math.abs(v.yield.change) < 0.01 ? 3 : 2)}%</b> : <b className="earn-apy muted">Measuring</b>}<small>{v.yield ? `over ${v.yield.hours < 48 ? `${Math.round(v.yield.hours)} hours` : `${Math.round(v.yield.hours / 24)} days`}${v.yield.hours >= 167 ? "" : " (since the first deposit)"}. Testnet loans run in hours, so this is not annualized` : "shown once the vault has a deposit and an hour of prices"}</small></div>
            {v.kind === "fixed"
              ? <div className="earn-fact"><span>How you leave</span><b>At NAV, from maturity</b><small>Before maturity the network refuses a withdrawal; from then on, one transaction, paid or refused. The vault page shows both dates.</small></div>
              : v.kind === "credit"
                ? <div className="earn-fact"><span>How you leave</span><b>{v.liquidShare != null ? `${Math.round(v.liquidShare * 100)}% could leave now` : "As cash allows"}</b><small>One transaction, paid from cash in the vault; what is lent out comes back as borrowers repay, and waiting withdrawals are paid first.</small></div>
                : <div className="earn-fact"><span>How you leave</span><b>At NAV, in one transaction</b><small>Paid or refused by the network: no queue.{v.liquidShare != null ? ` ${Math.round(v.liquidShare * 100)}% of NAV is payable now.` : ""}</small></div>}
            {v.kind === "credit"
              ? <div className="earn-fact"><span>What you trust</span><b>That borrowers repay</b><small>The network enforces who can borrow, how much and the markdown when a loan runs late; repayment is the one thing it cannot enforce. Testnet borrowers are Dawns-held keys.</small></div>
              : <div className="earn-fact"><span>What you trust</span><b>The manager&apos;s picks</b><small>The network enforces the caps and limits; where the manager allocates inside them, and what the strategy wallets do, is trust.</small></div>}
            <div className="earn-go">
              {v.href && <Link href={v.href} className="btn ghost sm">Open the vault</Link>}
              <Link href="/test" className="btn ghost sm">Try it with test KAS</Link>
            </div>
          </article>
        ))}
        {vaults.length > 0 && <OwnVaultsNote compact />}
        {!n && <p className="muted" style={{ margin: 0 }}>No option passes dawns&apos; rules for {h.label} {w.short} right now. Try a longer window, or see why below.</p>}
      </div>

      {excluded.length > 0 && (
        <details className="earn-out" open={options.length === 0}>
          <summary>Not on this list, and why ({excluded.length})</summary>
          {excluded.map((x) => (
            <div key={x.id} className="earn-out-row">
              <div><b>{x.name} · {x.pname}</b>{x.apy != null && <span className="muted"> · {pct(x.apy, x.apy < 0.1 ? 2 : 1)} native yield</span>}<p>{x.why}</p></div>
              <Link href={x.href}>Read the sheet →</Link>
            </div>
          ))}
        </details>
      )}

      <div className="earn-trust"><span>Your wallet signs; dawns never holds funds</span><span>Native yield only; incentives shown apart</span><span>Measured, not promised: rates change daily</span><span>Research, not advice</span></div>
    </div>
  );
}
