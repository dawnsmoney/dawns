import type { Metadata } from "next";
import Link from "next/link";
import { Banner } from "@/components/Banner";
import { SplitBar } from "@/components/viz";
import { PortfolioConnect } from "@/components/portfolio-connect";
import { PositionTable, exposureParts, kindParts } from "@/components/portfolio";
import { getSnapshot } from "@/lib/snapshot";
import { getIntelRaw } from "@/lib/intel-db";
import { buildIntel } from "@/lib/intel";
import { readWallet, readL1, myWallet } from "@/lib/portfolio-read";
import { getAssets } from "@/lib/assets";
import { valueCredible } from "@/lib/assets/types";
import { buildPortfolio, parseAddresses } from "@/lib/portfolio";
import { usd, pct } from "@/lib/format";

export const metadata: Metadata = {
  title: "Portfolio",
  description: "Any wallet's positions in Kaspa DeFi on Igra and Kasplex, looked through to the assets underneath, with what could leave today.",
};

type P = { searchParams: Promise<{ a?: string | string[] }> };

export default async function PortfolioPage({ searchParams }: P) {
  const sp = await searchParams;
  const a = Array.isArray(sp.a) ? sp.a[0] : sp.a;
  const mine = await myWallet();
  const q = parseAddresses(a);
  const bad = q.bad.length > 0;
  const n = q.evm.length + q.l1.length;
  const lede = "Any wallet's positions in Kaspa DeFi and on Kaspa L1, looked through to what they hold: a deposit receipt is the asset lent out, an LP share is two tokens, a staking share is the token underneath.";
  if (!n) {
    return (
      <>
        <Banner short crumb={[{ label: "Beta" }]} title="Portfolio" lede={lede} />
        <div className="wrap" style={{ paddingTop: 40, display: "grid", gap: 28 }}>
          <div className="card"><PortfolioConnect value={a} mine={mine} />{bad && <p style={{ color: "var(--crit)", margin: "12px 0 0" }}>Not an address dawns can read: use 0x… (Igra, Kasplex) or kaspa:q….</p>}</div>
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

  const [s, assets] = await Promise.all([getSnapshot(), getAssets()]);
  const [evmReads, l1Reads, raw] = await Promise.all([Promise.all(q.evm.map((x) => readWallet(s, x))), Promise.all(q.l1.map((x) => readL1(x))), getIntelRaw()]);
  const px = new Map(assets.map((x) => [x.id, valueCredible(x) ? x.price : null]));
  const pf = buildPortfolio(s, evmReads, l1Reads, (id) => px.get(id) ?? null);
  const intel = buildIntel(raw, s);
  const tags = Object.fromEntries(Object.entries(intel.byOpp).map(([k, v]) => [k, v.tags]));
  const top = pf.exposure[0];
  return (
    <>
      <Banner short crumb={[{ href: "/portfolio", label: "Portfolio" }, { label: n > 1 ? `${n} addresses` : `${(q.evm[0] ?? q.l1[0]).slice(0, 10)}…${(q.evm[0] ?? q.l1[0]).slice(-4)}` }]} title="Portfolio" lede={lede} />
      <div className="wrap" style={{ paddingTop: 40, display: "grid", gap: 28 }}>
        <div className="card"><PortfolioConnect value={a} mine={mine} />{bad && <p style={{ color: "var(--warn)", margin: "12px 0 0" }}>Skipped: {q.bad.join(", ")}</p>}</div>
        {!pf.positions.length ? (
          <div className="card"><p className="muted" style={{ margin: 0 }}>Nothing found for {n > 1 ? "these addresses" : "this address"}: no tokens on Igra (every ERC-20 the explorer lists), no lending, LP, farm or Infinity Pool positions on Igra or Kasplex{q.l1.length ? ", and no KAS or KRC-20 on Kaspa L1" : ""}.{pf.dust ? ` ${pf.dust} balances under $0.50 are not listed.` : ""}{pf.failed ? " Some reads did not answer; reload to try again." : ""} Is the wallet on another network, or is this its Kaspa L1 address? Add both above.</p></div>
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
              Read {new Date(pf.at).toISOString().slice(11, 16)} UTC from public RPCs, at the prices in dawns&apos; latest snapshot.{pf.unpriced ? ` ${pf.unpriced} positions have no reliable price and are not in the totals.` : ""}{pf.dust ? ` ${pf.dust} balances under $0.50 are hidden.` : ""}{pf.failed ? ` ${pf.failed} reads did not answer.` : ""} Kaspa L1: KAS from the Kaspa REST API, KRC-20 from the Kasplex indexer; a KRC-20 counts at a price only if it traded this week. Not included: V3 positions (NFTs), covenant tokens (KCC-20), and tokens outside the pools and markets dawns reads. <Link href="/opportunities">Compare with every opportunity</Link>.
            </p>
          </>
        )}
      </div>
    </>
  );
}
