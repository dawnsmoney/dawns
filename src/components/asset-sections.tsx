import { Bars, Columns, Timeline } from "./viz";
import { catOf } from "@/lib/assets/holders";
import { valueCredible, unlockedAt, type Asset } from "@/lib/assets/types";
import { usd, pct } from "@/lib/format";

const whole = (v: number | null, sym: string) => (v == null ? "—" : `${v >= 1e9 ? (v / 1e9).toFixed(2) + "B" : v >= 1e6 ? (v / 1e6).toFixed(2) + "M" : v >= 1e3 ? (v / 1e3).toFixed(1) + "K" : v.toFixed(2)} ${sym}`);
const short = (s: string) => (s.length > 20 ? `${s.slice(0, 12)}…${s.slice(-6)}` : s);
const when = (ms: number | null) => (ms == null ? "—" : new Date(ms).toISOString().slice(0, 10));

/** How much can be sold into the pools dawns reads before the price falls 2% / 10%. */
export function DepthCard({ a }: { a: Asset }) {
  const dp = a.depth!;
  return (
<div className="card">
            <div className="c-head"><h3>How much can be sold</h3><span className="tag">{dp.pools.length} pool{dp.pools.length === 1 ? "" : "s"}</span></div>
            <div className="depth-top">
              <div><span className="eyebrow muted">Before the price falls 2%</span><b>{usd(dp.d2)}</b><small>all pools, sale split between them</small></div>
              <div><span className="eyebrow muted">Before it falls 10%</span><b>{usd(dp.d10)}</b><small>{a.liquidity ? `of ${usd(a.liquidity)} of it in pools` : "in the pools dawns reads"}</small></div>
              <div><span className="eyebrow muted">Of its value on chain</span><b>{a.mcap && valueCredible(a) ? pct(dp.d10 / a.mcap, dp.d10 / a.mcap < 0.01 ? 2 : 1) : "—"}</b><small>{a.mcap && valueCredible(a) ? "can be sold before −10%" : "no realizable value to compare"}</small></div>
            </div>
            <div className="grid gA" style={{ alignItems: "start" }}>
              <div>
                <div className="eyebrow muted" style={{ marginBottom: 10 }}>Size of sale by price drop</div>
                <Columns label={`${a.symbol} sellable by price drop`} cols={dp.curve.map((c) => ({ key: String(c.move), label: `−${Math.round(c.move * 100)}%`, value: c.usd, display: usd(c.usd), color: "#3987e5" }))} />
              </div>
              <div>
                <div className="eyebrow muted" style={{ marginBottom: 10 }}>By pool, to −10%</div>
                <Bars rows={dp.pools.map((p) => ({ key: p.id, label: p.pname, sub: `${a.symbol === "KAS" ? "KAS" : a.symbol}/${p.other} · ${p.chain === "igra" ? "Igra" : "Kasplex"}${p.kind === "v3" ? " · concentrated" : ""}`, value: p.d10, display: usd(p.d10), color: "#3987e5" }))} />
              </div>
            </div>
            <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>From each pool&apos;s reserves at the snapshot block, valued at the pool price before the sale; trading fees left out. Each pool is capped at what its other side holds.{dp.v3 ? " Concentrated pools are estimated at their current in-range liquidity: positions further out can add depth." : ""}{a.id === "kaspa:native:KAS" ? " KAS here means WiKAS, iKAS and WKAS on the L2 pools, not exchanges." : ""}</p>
          </div>);
}

/** A vesting contract's schedule, read on-chain. */
export function UnlocksCard({ a }: { a: Asset }) {
  const u = a.unlocks!;
  const now = a.updatedAt;
  const at = (t: number) => u.pools.reduce((x, p) => x + unlockedAt(p, t), 0);
  const nowU = at(now), claimed = u.pools.reduce((x, p) => x + p.released, 0);
  const unl = { now: nowU, claimed, locked: u.total - nowU, next12: at(now + 365 * 864e5) - nowU, recent: u.releases.filter((r) => now - r.t < 30 * 864e5) };
  return (
<div className="card">
            <div className="c-head"><h3>Supply unlocks</h3><span className="tag">{u.pools.length} vesting pools · on-chain</span></div>
            <div className="depth-top">
              <div><span className="eyebrow muted">Unlocked so far</span><b>{whole(unl.now, a.symbol)}</b><small>{pct(unl.now / u.total, 0)} of {whole(u.total, a.symbol)}; {whole(unl.claimed, "").trim()} claimed</small></div>
              <div><span className="eyebrow muted">Unlocks in 12 months</span><b>{whole(unl.next12, a.symbol)}</b><small>{a.supply ? `${pct(unl.next12 / a.supply, 0)} of today's circulating supply` : "on the contract's schedule"}</small></div>
              <div><span className="eyebrow muted">Still locked</span><b>{whole(unl.locked, a.symbol)}</b><small>{pct(unl.locked / u.total, 0)} of the allocation</small></div>
            </div>
            <Timeline label={`${a.symbol} vesting schedule`} now={now} rows={[...u.pools].sort((x, y) => y.allocation - x.allocation).map((p) => ({
              key: String(p.id), label: `Pool ${p.id}${p.walletName ? ` · ${p.walletName}` : ""}`, sub: `${p.atStart >= p.allocation ? "all at start" : p.atStart > 0 ? `${pct(p.atStart / p.allocation, 0)} at start, then ` : ""}${p.atStart >= p.allocation ? "" : `linear over ${p.days >= 60 ? `${Math.round(p.days / 30)} months` : `${p.days} days`}`} · ${short(p.wallet)}`,
              start: p.start, end: p.start + Math.max(1, p.days) * 864e5, done: unlockedAt(p, now) / p.allocation, claimed: p.released / p.allocation,
              display: whole(p.allocation, "").trim(), color: "#c98500" }))} />
            {unl.recent.length > 0 && (
              <div style={{ marginTop: 20 }}>
                <div className="eyebrow muted" style={{ marginBottom: 10 }}>Claimed from the contract, last 30 days · {whole(unl.recent.reduce((x, r) => x + r.amount, 0), a.symbol)}</div>
                <Bars rows={unl.recent.slice(0, 6).map((r, i) => ({ key: `${r.t}-${i}`, label: when(r.t), sub: `pool ${r.pool} → ${short(r.to)}`, value: r.amount, display: whole(r.amount, "").trim(), color: "#c98500" }))} />
              </div>
            )}
            <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>Read from the {u.name} contract <span className="mono">{short(u.contract)}</span>: each pool&apos;s start, duration, amount at start and what has been claimed, using the contract&apos;s own unlock formula. Unlocked tokens can be claimed at any time; claimed tokens can be sold. Pool names are not stored on-chain.</p>
          </div>);
}

/** Project-side wallets whose share of supply changed over the week. */
export function MovesCard({ a }: { a: Asset }) {
  const moves = a.moves!;
  return (
<div className="card">
            <div className="c-head"><h3>Project wallets that moved</h3><span className="tag">7 days</span></div>
            <Bars rows={moves.slice(0, 6).map((m) => ({ key: m.address, label: m.label ?? short(m.address), sub: `${catOf(m.kind)?.label ?? "Deployer"} · ${pct(m.was, 1)} → ${pct(m.now, 1)}`, value: Math.abs(m.now - m.was), display: `${m.now >= m.was ? "+" : "−"}${pct(Math.abs(m.now - m.was), 1)}`, color: m.now >= m.was ? "#199e70" : "#d95926" }))} />
            <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>Deployer, treasury, vesting and other project-side addresses among the top 10 whose share of supply changed by a quarter point or more, from dawns&apos; daily record of the holder list.</p>
          </div>);
}
