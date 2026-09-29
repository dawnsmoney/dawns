import type { Metadata } from "next";
import Link from "next/link";
import { Banner } from "@/components/Banner";
import { SplitBar } from "@/components/viz";
import { AddressForm, PositionTable, exposureParts, kindParts } from "@/components/portfolio";
import { getSnapshot } from "@/lib/snapshot";
import { getIntelRaw } from "@/lib/intel-db";
import { buildIntel } from "@/lib/intel";
import { readWallet, myWallet } from "@/lib/portfolio-read";
import { buildPortfolio } from "@/lib/portfolio";
import { usd, pct } from "@/lib/format";

export const metadata: Metadata = {
  title: "Portfolio",
  description: "Any wallet's positions in Kaspa DeFi on Igra and Kasplex, looked through to the assets underneath, with what could leave today.",
};

type P = { searchParams: Promise<{ a?: string | string[] }> };
const isAddr = (a: unknown): a is string => typeof a === "string" && /^0x[0-9a-fA-F]{40}$/.test(a);

export default async function PortfolioPage({ searchParams }: P) {
  const sp = await searchParams;
  const a = Array.isArray(sp.a) ? sp.a[0] : sp.a;
  const mine = await myWallet();
  const bad = a != null && a !== "" && !isAddr(a);
  const lede = "Any wallet's positions in Kaspa DeFi, looked through to what they hold: a deposit receipt is the asset lent out, an LP share is two tokens, a staking share is the token underneath.";
  if (!isAddr(a)) {
    return (
      <>
        <Banner short crumb={[{ label: "Beta" }]} title="Portfolio" lede={lede} />
        <div className="wrap" style={{ paddingTop: 40, display: "grid", gap: 28 }}>
          <div className="card"><AddressForm value={a} mine={mine} />{bad && <p style={{ color: "var(--crit)", margin: "12px 0 0" }}>That is not an EVM address: 0x followed by 40 hex characters.</p>}</div>
          <div className="grid g3">
            {[["Look-through", "Every position broken down to the assets underneath, so two receipts on the same token show as one exposure."],
              ["What can leave", "Lending counts only what the market's cash can pay today; LP and staking shares count in full, at the pool's price."],
              ["No single score", "Each position carries its Dawns view: yield, capital and exit moves, with the numbers behind them."]].map(([h, t]) => (
              <div key={h} className="card"><b style={{ display: "block", marginBottom: 6 }}>{h}</b><span className="muted">{t}</span></div>
            ))}
          </div>
        </div>
      </>
    );
  }

  const s = await getSnapshot();
  const [r, raw] = await Promise.all([readWallet(s, a), getIntelRaw()]);
  const pf = buildPortfolio(s, r);
  const intel = buildIntel(raw, s);
  const tags = Object.fromEntries(Object.entries(intel.byOpp).map(([k, v]) => [k, v.tags]));
  const top = pf.exposure[0];
  return (
    <>
      <Banner short crumb={[{ href: "/portfolio", label: "Portfolio" }, { label: `${a.slice(0, 6)}…${a.slice(-4)}` }]} title="Portfolio" lede={lede} />
      <div className="wrap" style={{ paddingTop: 40, display: "grid", gap: 28 }}>
        <div className="card"><AddressForm value={a} mine={mine} /></div>
        {!pf.positions.length ? (
          <div className="card"><p className="muted" style={{ margin: 0 }}>No positions dawns can read for this address on Igra or Kasplex{pf.failed ? ` (${pf.failed} reads did not answer; try again shortly)` : ""}. dawns reads the tokens, lending markets, V2 pools, the ZealousSwap farm and Infinity Pools it tracks.</p></div>
        ) : (
          <>
            <div className="grid g4">
              <div className="card istat"><span className="eyebrow muted">Net value</span><b>{usd(pf.net)}</b><small className="muted">{usd(pf.gross)} held{pf.debt ? ` · ${usd(pf.debt)} borrowed` : ""}</small></div>
              <div className="card istat"><span className="eyebrow muted">Largest exposure</span><b>{top ? `${top.sym} ${pct(top.share, 0)}` : "—"}</b><small className="muted">after looking through every receipt</small></div>
              <div className="card istat"><span className="eyebrow muted">Could leave today</span><b>{usd(pf.exitNow)}</b><small className="muted">{pf.exitShare != null ? `${pct(pf.exitShare, 0)} of what is held; lending limited by market cash` : ""}</small></div>
              <div className="card istat"><span className="eyebrow muted">Health factor</span><b style={{ color: pf.hf != null && pf.hf < 1.2 ? "var(--crit)" : undefined }}>{pf.hf != null ? pf.hf.toFixed(2) : pf.debt ? "—" : "No loans"}</b><small className="muted">{pf.hf != null ? "below 1.00 the loan is liquidated" : pf.debt ? "not among the largest Kaskad positions dawns tracks" : "nothing borrowed"}</small></div>
            </div>
            <div className="grid g2">
              <div className="card"><div className="c-head"><h3>What you hold underneath</h3><span className="tag">look-through</span></div><SplitBar label="Exposure by underlying asset" parts={exposureParts(pf)} /></div>
              <div className="card"><div className="c-head"><h3>Where it sits</h3><span className="tag">by position type</span></div><SplitBar label="Value by position type" parts={kindParts(pf)} /></div>
            </div>
            <PositionTable rows={pf.positions} tags={tags} />
            <p className="muted" style={{ fontSize: 13, margin: 0 }}>
              Read {new Date(pf.at).toISOString().slice(11, 16)} UTC from public RPCs, at the prices in dawns&apos; latest snapshot.{pf.unpriced ? ` ${pf.unpriced} positions have no reliable price and are not in the totals.` : ""}{pf.failed ? ` ${pf.failed} reads did not answer.` : ""} Not included: V3 positions (NFTs), KRC-20 and KAS on Kaspa L1, and tokens outside the pools and markets dawns reads. <Link href="/opportunities">Compare with every opportunity</Link>.
            </p>
          </>
        )}
      </div>
    </>
  );
}
