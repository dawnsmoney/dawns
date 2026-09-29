import type { Metadata } from "next";
import { getSnapshot } from "@/lib/snapshot";
import { getIntelRaw } from "@/lib/intel-db";
import { buildIntel } from "@/lib/intel";
import { readWalletCached, readL1Cached, myWallet, vaultPositions } from "@/lib/portfolio-read";
import { getAssets } from "@/lib/assets";
import { valueCredible } from "@/lib/assets/types";
import { buildPortfolio, parseAddresses, POS_COLOR, POS_LABEL } from "@/lib/portfolio";
import { MCard, MHead, MNote, MStats } from "@/components/m/kit";
import { MTabs } from "@/components/m/tabs";
import { PosActions, exposureParts, kindParts } from "@/components/portfolio";
import { Tags } from "@/components/intel";
import { SplitBar } from "@/components/viz";
import { PortfolioConnect } from "@/components/portfolio-connect";
import Link from "next/link";
import { usd, pct } from "@/lib/format";

export const metadata: Metadata = {
  title: "Portfolio",
  description: "Any wallet's positions in Kaspa DeFi on Igra and Kasplex, looked through to the assets underneath, with what could leave today.",
};

type P = { searchParams: Promise<{ a?: string | string[] }> };
const amt = (v: number) => { const a = Math.abs(v); return `${v < 0 ? "−" : ""}${a >= 1e6 ? (a / 1e6).toFixed(2) + "M" : a >= 1e3 ? (a / 1e3).toFixed(1) + "K" : a >= 1 ? a.toFixed(2) : a.toPrecision(3)}`; };

export default async function MPortfolio({ searchParams }: P) {
  const sp = await searchParams;
  const a = Array.isArray(sp.a) ? sp.a[0] : sp.a;
  const mine = await myWallet();
  const q = parseAddresses(a || mine);   // no address in the link: the signed-in wallets
  const ok = q.evm.length + q.l1.length > 0;
  const head = <MHead eyebrow="Look-through" title="Portfolio" clamp sub="Any wallet's positions on Igra, Kasplex and Kaspa L1, broken down to what they hold, with what could leave today. Read-only." />;
  if (!ok) {
    return (
      <>
        {head}
        <div className="m-screen">
          <MCard><PortfolioConnect value={a} mine={mine} viewing={[...q.evm, ...q.l1]} />{a && <MNote>Not an address dawns can read: use 0x… (Igra, Kasplex) or kaspa:q….</MNote>}</MCard>
        </div>
      </>
    );
  }
  const [s, assets] = await Promise.all([getSnapshot(), getAssets()]);
  const [evmReads, l1Reads, raw, vault] = await Promise.all([Promise.all(q.evm.map((x) => readWalletCached(x))), Promise.all(q.l1.map((x) => readL1Cached(x))), getIntelRaw(), vaultPositions(q.l1)]);
  const px = new Map(assets.map((x) => [x.id, valueCredible(x) ? x.price : null]));
  const pf = buildPortfolio(s, evmReads, l1Reads, (id) => px.get(id) ?? null, vault);
  const intel = buildIntel(raw, s).byOpp;
  const top = pf.exposure[0];
  return (
    <>
      {head}
      <div className="m-screen">
        <MCard><PortfolioConnect value={a} mine={mine} viewing={[...q.evm, ...q.l1]} /></MCard>
        {!pf.positions.length ? <MNote>Nothing found{pf.dust ? ` (${pf.dust} balances under $0.50 not listed)` : ""}{pf.failed ? "; some reads did not answer, reload to try again" : ""}. Add your other wallet above.</MNote> : (
          <>
            <MStats items={[
              { label: "Net value", value: usd(pf.net), sub: pf.debt ? `${usd(pf.debt)} borrowed` : `${pf.positions.length} positions` },
              { label: "Largest exposure", value: top ? `${top.sym} ${pct(top.share, 0)}` : "—", sub: "looked through" },
              { label: "Could leave today", value: usd(pf.exitNow), sub: pf.exitShare != null ? `${pct(pf.exitShare, 0)} of holdings` : undefined },
              { label: "Health factor", value: pf.hf != null ? pf.hf.toFixed(2) : pf.debt ? "—" : "No loans", tone: pf.hf != null && pf.hf < 1.2 ? "crit" : undefined },
            ]} />
            <MTabs tabs={[{ key: "p", label: "Positions", badge: pf.positions.length }, { key: "u", label: "Underneath" }]}>
              <div className="m-panel">
                {pf.positions.map((x) => (
                  <MCard key={x.key}>
                    <div className="m-pos">
                      <span className="vt-name"><i style={{ background: POS_COLOR[x.kind] }} /><span>{x.href ? <Link href={x.href}><b>{x.name}</b></Link> : <b>{x.name}</b>}<small>{POS_LABEL[x.kind]} · {x.sub}</small></span></span>
                      <b className="m-pos-v" style={{ color: x.usd != null && x.usd < 0 ? "#D55A7C" : undefined }}>{x.usd != null ? `${x.usd < 0 ? "−" : ""}${usd(Math.abs(x.usd))}` : x.valueText ?? "no price"}</b>
                    </div>
                    <dl className="m-kv">
                      <div><dt>Underneath</dt><dd>{x.under.map((u) => `${amt(u.amount)} ${u.sym}`).join(" + ")}</dd></div>
                      <div><dt>Leave today</dt><dd>{x.exitNow != null ? `${usd(x.exitNow)} · ${x.exitNote}` : x.exitNote}</dd></div>
                    </dl>
                    {x.opp && intel[x.opp] && <Tags tags={intel[x.opp].tags} max={2} />}
                    {x.actions && <PosActions a={x.actions} />}
                  </MCard>
                ))}
              </div>
              <div className="m-panel">
                <MCard title="What you hold underneath"><SplitBar label="Exposure by underlying asset" parts={exposureParts(pf)} height={24} /></MCard>
                <MCard title="Where it sits"><SplitBar label="Value by position type" parts={kindParts(pf)} height={24} /></MCard>
                <MNote>Not included: V3 positions, covenant tokens (KCC-20), tokens outside the pools and markets dawns reads.</MNote>
              </div>
            </MTabs>
          </>
        )}
      </div>
    </>
  );
}
