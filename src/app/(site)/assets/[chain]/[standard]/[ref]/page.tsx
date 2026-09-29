import type { Metadata } from "next";
import Link from "next/link";
import { Fragment } from "react";
import { notFound } from "next/navigation";
import { Banner } from "@/components/Banner";
import { Pill } from "@/components/bits";
import { RangeChart, AreaChart } from "@/components/charts";
import { OpportunityTable } from "@/components/opportunities";
import { getAssets, getAssetHistory } from "@/lib/assets";
import { analyse, dimensions } from "@/lib/assets/analysis";
import { supplyParts, holderCat, catOf, HOLDER_CATS, REST_COLOR } from "@/lib/assets/holders";
import { SplitBar, Ring, Tiles, Bars, Compare, Columns, CopyId, StackedCols } from "@/components/viz";
import { DepthCard, UnlocksCard, MovesCard } from "@/components/asset-sections";
import { AssetCoin } from "@/components/bits";
import { External } from "@/components/icons";
import { ResearchHead, KeyFigure, Basis, StampLine } from "@/components/research";
import { ResearchTabs } from "@/components/research-tabs";
import { keyFigures, oneLine } from "@/lib/assets/basis";
import { CURATED } from "@/lib/assets/profiles";
import { CHAIN_NAME, STANDARD_NAME, assetId, assetPath, valueCredible, type Asset, type AssetDay, type AssetChain, type AssetStandard } from "@/lib/assets/types";
import { getSnapshot } from "@/lib/snapshot";
import { getIntelRaw } from "@/lib/intel-db";
import { buildIntel } from "@/lib/intel";
import { receiptOf, KIND_LABEL, type Receipt } from "@/lib/underneath";
import { Underneath, ReceiptId } from "@/components/underneath";
import type { Snapshot } from "@/lib/types";
import { knownOf, holdingsOf } from "@/lib/assets/view";
import { usd, pct, price } from "@/lib/format";

export const revalidate = 300;

type P = { params: Promise<{ chain: string; standard: string; ref: string }> };
const CHAINS: AssetChain[] = ["kaspa", "igra", "kasplex", "zkas"];
const STANDARDS: AssetStandard[] = ["native", "krc20", "erc20", "kcc20", "kron"];

async function find(params: P["params"]): Promise<Asset | null> {
  const { chain, standard, ref } = await params;
  if (!CHAINS.includes(chain as AssetChain) || !STANDARDS.includes(standard as AssetStandard)) return null;
  const id = assetId(chain as AssetChain, standard as AssetStandard, decodeURIComponent(ref));
  return (await getAssets()).find((a) => a.id === id) ?? null;
}

/** A receipt token dawns does not list as an asset (deposit receipts, LP shares): its look-through page. */
async function findReceipt(params: P["params"]): Promise<{ r: Receipt; s: Snapshot } | null> {
  const { chain, standard, ref } = await params;
  if (!CHAINS.includes(chain as AssetChain) || standard !== "erc20") return null;
  const s = await getSnapshot();
  const r = receiptOf(s, assetId(chain as AssetChain, "erc20", decodeURIComponent(ref)));
  return r ? { r, s } : null;
}

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const a = await find(params);
  if (!a) {
    const rc = await findReceipt(params);
    return rc ? { title: `${rc.r.symbol} · ${KIND_LABEL[rc.r.kind]} on ${rc.r.chain}`, description: rc.r.claim.slice(0, 180) } : { title: "Asset not found" };
  }
  return { title: `${a.symbol} · ${STANDARD_NAME[a.standard]} on ${CHAIN_NAME[a.chain]}`, description: analyse(a).what.slice(0, 180) };
}

const whole = (v: number | null, sym: string) => (v == null ? "—" : `${v >= 1e9 ? (v / 1e9).toFixed(2) + "B" : v >= 1e6 ? (v / 1e6).toFixed(2) + "M" : v >= 1e3 ? (v / 1e3).toFixed(1) + "K" : v.toFixed(2)} ${sym}`);
const hash = (h: number | null) => (h == null ? "—" : h >= 1e18 ? `${(h / 1e18).toFixed(2)} EH/s` : h >= 1e15 ? `${(h / 1e15).toFixed(1)} PH/s` : `${(h / 1e12).toFixed(0)} TH/s`);
const short = (s: string) => (s.length > 20 ? `${s.slice(0, 12)}…${s.slice(-6)}` : s);
const when = (ms: number | null) => (ms == null ? "—" : new Date(ms).toISOString().slice(0, 10));

/** Holder split per period from the daily records: weekly once there are 8+ weeks, daily before. */
function holderFlow(hist: AssetDay[]) {
  const days = hist.filter((d) => d.top?.length);
  if (days.length < 2) return { cols: [], since: days[0]?.day ?? null };
  const weekly = days.length > 56;
  const pick = weekly ? days.filter((d, i) => i === days.length - 1 || new Date(days[i + 1].day).getUTCDay() < new Date(d.day).getUTCDay() || Date.parse(days[i + 1].day) - Date.parse(d.day) >= 7 * 864e5) : days;
  const cols = pick.slice(-16).map((d) => {
    const parts: Record<string, number> = {};
    for (const h of d.top!) parts[h.k] = (parts[h.k] ?? 0) + h.s;
    parts.rest = Math.max(0, 1 - Object.values(parts).reduce((x, v) => x + v, 0));
    return { key: d.day, label: d.day.slice(5).replace("-", "/"), parts };
  });
  return { cols, since: days[0].day, weekly };
}


async function ReceiptView({ r, s }: { r: Receipt; s: Snapshot }) {
  const opp = s.opportunities.filter((o) => o.id === r.opp);
  const t = opp.length ? buildIntel(await getIntelRaw(), s).byOpp[opp[0].id] : undefined;
  return (
    <>
      <Banner short crumb={[{ href: "/assets", label: "Assets" }, { label: `${KIND_LABEL[r.kind]} · ${r.chain}` }]}
        title={r.symbol} lede={r.name} />
      <div className="wrap" style={{ paddingTop: 40, display: "grid", gap: 28 }}>
        <Underneath r={r} />
        {opp.length > 0 && <div><h3 style={{ margin: "0 0 14px" }}>The opportunity it comes from</h3><OpportunityTable rows={opp} filters={false} trend={t ? { [opp[0].id]: t } : {}} /></div>}
        <div className="card"><ReceiptId r={r} /><p className="muted" style={{ fontSize: 13, margin: "12px 0 0" }}>dawns lists receipt tokens by what they hold, not as assets of their own: their value is the value underneath.</p></div>
      </div>
    </>
  );
}

export default async function AssetPage({ params }: P) {
  const a = await find(params);
  if (!a) {
    const rc = await findReceipt(params);
    if (!rc) notFound();
    return <ReceiptView r={rc.r} s={rc.s} />;
  }
  const [s, hist] = await Promise.all([getSnapshot(), getAssetHistory(a.id)]);
  const under = receiptOf(s, a.id);
  const r = analyse(a);
  const tiles = dimensions(a, r);
  const parts = supplyParts(a.topHolders, a.top10);
  const supplyVisual = !!a.net?.path?.length || (a.maxSupply != null && a.supply != null && a.maxSupply > 0) || (a.premineShare ?? 0) > 0 || a.net?.inflation != null;
  const gap = a.poolPrice != null && a.price != null && Math.abs(a.price / a.poolPrice - 1) >= 0.05;
  const cur = CURATED[a.id];
  const opps = s.opportunities.filter((o) => a.pools.includes(o.id));
  const held = holdingsOf(a, s);
  const heldTotal = held.reduce((x, h) => x + h.usd, 0);
  const all = await getAssets();
  const isKas = a.id === "kaspa:native:KAS";
  // KAS: its wrapped forms on the L2s; anything else: other assets with the same ticker
  const sameTicker = all.filter((x) => x.id !== a.id && (isKas ? /^(w?i?kas|wikas|ikas|wkas)$/i.test(x.symbol) : x.symbol.toUpperCase() === a.symbol.toUpperCase()))
    .sort((x, y) => (y.liquidity ?? y.mcap ?? 0) - (x.liquidity ?? x.mcap ?? 0));
  const dates = hist.map((d) => Date.parse(d.day));
  const flow = holderFlow(hist);
  const priced = hist.filter((d) => d.price != null).length >= 2;
  const holdersHist = hist.filter((d) => d.holders != null).length >= 3;
  const explorer = a.standard === "kcc20" || a.standard === "kron" ? `https://kcc20.info/v1/tokens/${a.ref}` : a.chain === "igra" ? `https://explorer.igralabs.com/token/${a.ref}` : a.standard === "krc20" ? `https://kaspa.com/tokens/marketplace/token/${a.ref}` : a.chain === "kasplex" ? `https://explorer.kasplex.org/token/${a.ref}` : a.chain === "zkas" ? "https://explorer.zkas.info/analytics" : "https://explorer.kaspa.org";

  const figs = keyFigures(a, s, heldTotal, hist);
  const tabs = [
    { key: "overview", label: "Overview" },
    { key: "holders", label: "Holders", badge: a.holders != null ? (a.holders >= 1000 ? `${(a.holders / 1000).toFixed(a.holders >= 1e4 ? 0 : 1)}K` : String(a.holders)) : null },
    { key: "supply", label: a.net ? "Supply & network" : "Supply" },
    { key: "markets", label: "Markets", badge: opps.length || null },
    ...(sameTicker.length ? [{ key: "related", label: isKas ? "Other chains" : "Same ticker", badge: sameTicker.length }] : []),
    { key: "sources", label: "Sources" },
  ];
  return (
    <>
      <Banner short crumb={[{ href: "/assets", label: "Assets" }, { label: `${STANDARD_NAME[a.standard]} · ${CHAIN_NAME[a.chain]}` }]}
        title={<>{a.symbol}{a.name.toLowerCase() !== a.symbol.toLowerCase() && <span className="muted" style={{ fontWeight: 400 }}> {a.name}</span>}</>}
        lede={oneLine(r.what)} />
      <div className="wrap" style={{ paddingTop: 40, display: "grid", gap: 28 }}>
        <ResearchHead coin={<AssetCoin a={a.symbol} size={56} />} title={a.symbol} subtitle={a.name !== a.symbol ? a.name : undefined}
          line={r.what}
          tags={<><Pill t={r.grade.t}>{r.grade.label}</Pill><span className="tag">{STANDARD_NAME[a.standard]}</span><span className="tag">{CHAIN_NAME[a.chain]}</span>{a.launched && <span>launched {when(a.launched)}</span>}{cur?.sources[0] && <a href={cur.sources[0][1]} target="_blank" rel="noopener noreferrer">{cur.sources[0][0]} ↗</a>}</>}
          figures={figs.map((f) => <KeyFigure key={f.label} label={f.label} value={f.value} sub={f.sub} tone={f.tone} basis={<Basis text={f.basis} stamp={f.stamp} sources={f.sources} />} />)} />

        <ResearchTabs tabs={tabs}>
          <div className="rt-pane">
        {under && <Underneath r={under} />}
        <div className="card">
          <div className="c-head"><h3>dawns&apos; reading</h3><Pill t={r.grade.t}>{r.grade.label}</Pill></div>
          <Tiles tiles={tiles} />
          <details className="more">
            <summary>All findings ({r.flags.length}) and questions to investigate ({r.questions.length})</summary>
            <div className="grid gA" style={{ marginTop: 16 }}>
              <ul className="findings">{r.flags.map(([t, f]) => <li key={f}><Pill t={t}>{t === "crit" ? "High" : t === "warn" ? "Watch" : t === "good" ? "OK" : "Note"}</Pill> {f}</li>)}</ul>
              <ol className="findings">{r.questions.map((q) => <li key={q}>{q}</li>)}</ol>
            </div>
          </details>
          <p className="muted" style={{ fontSize: 13, marginTop: 14, marginBottom: 0 }}>Research, not advice: dawns shows what the data says and what it cannot show. It never says buy or sell.</p>
        </div>
        {gap && a.price != null && a.poolPrice != null && (
          <div className="card">
            <div className="c-head"><h3>Two prices</h3><span className="tag">{a.price > a.poolPrice ? `${(a.price / a.poolPrice).toFixed(1)}× apart` : `${(a.poolPrice / a.price).toFixed(1)}× apart`}</span></div>
            <Compare a={{ label: "Headline (CoinGecko)", value: a.price, display: price(a.price) }} b={{ label: `Its ${CHAIN_NAME[a.chain]} pools`, value: a.poolPrice, display: price(a.poolPrice) }} />
            <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>What you could sell for on {CHAIN_NAME[a.chain]} is the pool price.</p>
          </div>
        )}
        {a.moves && a.moves.length > 0 && <MovesCard a={a} />}
        {priced && (
          <div className="card">
            <RangeChart title="Price, daily" label={`${a.symbol} price history`} dates={dates}
              series={[{ name: "Price", color: "#8578E6", values: hist.map((d) => d.price ?? 0) }]} fmt="usdFull" area="first" />
          </div>
        )}
          </div>
          <div className="rt-pane">
        {parts.length > 0 ? (
            <div className="card">
              <div className="c-head"><h3>Who holds it</h3>{a.top10 != null && <span className="tag">top 10: {pct(a.top10, 0)}</span>}</div>
              <SplitBar parts={parts.map((p) => ({ key: p.key, label: p.label, color: p.color, share: p.share }))} label={`${a.symbol} supply by holder kind`} />
              <div style={{ marginTop: 20 }}>
                <Bars rows={(a.topHolders ?? []).map((h, i) => ({ key: h.address, label: h.label ?? short(h.address), sub: `#${i + 1} · ${catOf(holderCat(h))?.label ?? ""}`, value: h.share, display: pct(h.share, 1), color: catOf(holderCat(h))?.color }))} />
              </div>
              {flow.cols.length >= 2 && (
                <div style={{ marginTop: 22 }}>
                  <div className="eyebrow muted" style={{ marginBottom: 10 }}>How it shifted, {flow.weekly ? "week by week" : "day by day"}</div>
                  <StackedCols label={`${a.symbol} top-10 holdings by kind over time`} cols={flow.cols}
                    keys={[...HOLDER_CATS.filter((c) => flow.cols.some((x) => (x.parts[c.key] ?? 0) > 0)).map((c) => ({ key: c.key, label: c.label, color: c.color })), { key: "rest", label: "Everyone else", color: REST_COLOR }]} />
                </div>
              )}
              {a.standard === "krc20" && <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>Names from the list the Kaspa REST API publishes. An unnamed address may still be an exchange or a marketplace escrow.</p>}
            </div>
          ) : a.net ? (
            <div className="card"><div className="c-head"><h3>Who holds it</h3></div><p className="muted" style={{ margin: 0 }}>{a.symbol} lives in the UTXO set: there is no holder list to read, and coins are spread over countless addresses by design. Exchanges and custodians hold much of it for others. Mining, the other side of supply, is under Supply &amp; network.</p></div>
          ) : (
            <div className="card"><div className="c-head"><h3>Who holds it</h3></div><p className="muted" style={{ margin: 0 }}>Not read yet. dawns reads the holder lists of the most significant assets first.</p></div>
          )}
        {holdersHist && (
          <div className="card">
            <RangeChart title="Holders, daily" label={`${a.symbol} holders`} dates={hist.filter((d) => d.holders != null).map((d) => Date.parse(d.day))}
              series={[{ name: "Holders", color: "#199e70", values: hist.filter((d) => d.holders != null).map((d) => d.holders!) }]} fmt="num" area="first" zero={false} />
          </div>
        )}
          </div>
          <div className="rt-pane">
          {supplyVisual && <div className="card">
            <div className="c-head"><h3>Supply</h3><span className="tag">{whole(a.supply, a.symbol)}</span></div>
            {a.net?.path?.length ? (
              <AreaChart label={`${a.symbol} supply, next 24 months`} dates={a.net.path.map((x) => x.t)} series={[{ name: "Supply", color: "#9085e9", values: a.net.path.map((x) => x.supply) }]} fmt="num" zero={false} height={200} />
            ) : null}
            <div className="rings">
              {a.maxSupply != null && a.supply != null && a.maxSupply > 0 && <Ring value={a.supply / a.maxSupply} label={a.standard === "krc20" ? "Minted" : "Of max supply"} sub={`of ${whole(a.maxSupply, a.symbol)}`} color="#9085e9" />}
              {a.premineShare != null && a.premineShare > 0 && <Ring value={a.premineShare} label="Pre-minted" sub="to the deployer" color="#c98500" />}
              {a.net?.inflation != null && <Ring value={Math.min(1, a.net.inflation)} display={`+${pct(a.net.inflation, a.net.inflation >= 1 ? 0 : 1)}`} label="New supply, 12 months" sub="on its emission schedule" color="#d95926" />}
            </div>
            <dl className="kv" style={{ marginTop: 14 }}>
              {a.net?.nextReduction && <><dt>Next reduction</dt><dd>{when(a.net.nextReduction.at)} to {a.net.nextReduction.amount.toFixed(4)} {a.symbol}/block</dd></>}
              {a.maxSupply == null && a.chain === "zkas" && <><dt>Maximum</dt><dd>No cap: perpetual tail emission</dd></>}
              {a.launched && <><dt>Launched</dt><dd>{when(a.launched)}</dd></>}
            </dl>
          </div>}
          {a.net && (
            <div className="card">
              <div className="c-head"><h3>Network</h3><span className="tag">{hash(a.net.hashrate)}</span></div>
              <div className="rings">
                {a.net.mergedShare != null && <Ring value={a.net.mergedShare} label="Of Kaspa's hashrate" sub="merge-mined work" color="#3987e5" />}
                {a.net.shielded && <Ring value={0} label="Left the shielded pool" sub={`${a.net.shielded.notes.toLocaleString("en-US")} notes`} color="#199e70" />}
              </div>
              {a.net.producers && (
                <div style={{ marginTop: 18 }}>
                  <div className="eyebrow muted" style={{ marginBottom: 10 }}>Who produces the blocks · {a.net.producers.sampled.toLocaleString("en-US")} sampled</div>
                  <SplitBar label="Block producers" parts={[...a.net.producers.top.slice(0, 5).map((t, i) => ({ key: t.id, label: `Producer ${t.id.slice(0, 6)}`, color: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181"][i], share: t.share })),
                    { key: "rest", label: "Everyone else", color: "#4A4270", share: Math.max(0, 1 - a.net.producers.top.slice(0, 5).reduce((x, t) => x + t.share, 0)) }]} />
                  <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>From each block&apos;s payout address. One operator can use several, so real concentration can only be higher.</p>
                </div>
              )}
              {cur && <dl className="kv" style={{ marginTop: 18, paddingTop: 18, borderTop: "1px solid var(--line)" }}>{cur.facts.map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>)}</dl>}
            </div>
          )}
        {a.unlocks && <UnlocksCard a={a} />}
        {a.cov && (
          <div className="grid gA" style={{ alignItems: "start" }}>
            <div className="card">
              <div className="c-head"><h3>Activity, last 30 days</h3><span className="tag">{a.cov.days.reduce((x, d) => x + d.transfers + d.other, 0)}{a.cov.capped ? "+" : ""} actions</span></div>
              <Columns label={`${a.symbol} actions per day`} cols={a.cov.days.map((d, i) => ({ key: d.day, label: i === 0 || i === 29 || i === 15 ? d.day.slice(5) : "", value: d.transfers + d.other, color: "#9085e9", display: d.transfers + d.other ? String(d.transfers + d.other) : "" }))} />
              {Object.keys(a.cov.kinds).length > 0 && <div className="split-legend">{Object.entries(a.cov.kinds).sort((x, y) => y[1] - x[1]).map(([k, v]) => <span key={k}>{k}<b>{v}</b></span>)}</div>}
            </div>
            <div className="card">
              <div className="c-head"><h3>How the covenant behaves</h3><Pill t={a.validation === "verified" ? "good" : a.validation === "template_verified" ? "info" : "warn"}>{a.validation === "verified" ? "Verified" : a.validation === "template_verified" ? "Template verified" : "Unconfirmed"}</Pill></div>
              <div className="rings">
                {a.cov.deployerShare != null && <Ring value={a.cov.deployerShare} label="Creator still holds" sub="the genesis key" color="#c98500" />}
                {a.cov.genesisSupply != null && a.supply != null && <Ring value={a.cov.minted > 0 ? Math.min(1, a.cov.minted / a.supply) : 0} display={a.cov.minted > 0 ? `+${pct(a.cov.minted / Math.max(1, a.cov.genesisSupply), 0)}` : "0%"} label="Created beyond launch" sub={a.cov.minted > 0 ? "supply is above what launched" : "supply never grew"} color="#d95926" />}
              </div>
              <dl className="kv" style={{ marginTop: 16 }}>
                <dt>Created by</dt><dd>{a.cov.ownerType === "covenant" ? "A program (covenant)" : a.cov.ownerType === "public_key" ? "A single key" : "—"}</dd>
                <dt>Supply at launch</dt><dd>{whole(a.cov.genesisSupply, a.symbol)}</dd>
                {a.cov.burned > 0 && <><dt>Burned</dt><dd>{whole(a.cov.burned, a.symbol)}</dd></>}
                {a.cov.reserveShare != null && a.cov.reserveShare > 0 && <><dt>Protocol reserve</dt><dd>{pct(a.cov.reserveShare, 1)} of supply</dd></>}
                <dt>Balances reconcile</dt><dd>{a.cov.reconciled === false || a.cov.unresolved > 0 ? `No · ${a.cov.unresolved} unresolved outputs` : a.cov.reconciled ? "Yes · every output attributed" : "—"}</dd>
                <dt>Actions, all time</dt><dd>{a.cov.actions.toLocaleString("en-US")}{a.cov.lastActive ? ` · last ${when(a.cov.lastActive)}` : ""}</dd>
              </dl>
            </div>
          </div>
        )}
          </div>
          <div className="rt-pane">
        {a.depth && a.depth.d10 > 0 && <DepthCard a={a} />}
        {held.length > 0 && (
          <div className="card">
            <div className="c-head"><h3>Held in protocols</h3><span className="tag">{usd(heldTotal)}</span></div>
            <Bars rows={held.map((h) => ({ key: h.protocol, label: h.name, href: `/protocols/${h.protocol}`, sub: h.where.slice(0, 3).join(" · ") + (h.where.length > 3 ? ` +${h.where.length - 3}` : ""), value: h.usd, display: usd(h.usd), color: "#3987e5" }))} />
            <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>Half of each pool&apos;s value per token, and what was supplied to each lending market.{a.id === "kaspa:native:KAS" ? " KAS includes WiKAS, iKAS and WKAS." : ""}</p>
          </div>
        )}
        <section>
          <div className="c-head" style={{ marginBottom: 14 }}><h3>Where capital can go with {a.symbol}</h3></div>
          {opps.length ? <OpportunityTable rows={opps} known={knownOf(all, opps.flatMap((o) => o.assetIds ?? []))} /> : (
            <div className="card"><p className="muted" style={{ margin: 0 }}>
              {a.pools.length ? "It sits in pools or markets below the $5K dawns lists as an opportunity." : "No pool or lending market dawns reads holds it. Today the only position is holding it."}
              {" "}<Link href="/opportunities">All opportunities</Link>
            </p></div>
          )}
        </section>
          </div>
          {sameTicker.length > 0 && <div className="rt-pane">
        {sameTicker.length > 0 && (
          <section>
            <div className="c-head" style={{ marginBottom: 14 }}><h3>{isKas ? "KAS on other chains" : `Also called ${a.symbol}`}</h3><span className="muted" style={{ fontSize: 14 }}>{isKas ? "wrapped KAS: each depends on its bridge" : "separate assets: own supply, holders and risks"}</span></div>
            <div className="twins">
              {sameTicker.slice(0, 6).map((x) => (
                <Link key={x.id} href={assetPath(x.id)} className="twin card">
                  <span className="twin-h"><AssetCoin a={x.symbol} size={36} /><span><b>{x.name !== x.symbol ? x.name : x.symbol}</b><small>{STANDARD_NAME[x.standard]} · {CHAIN_NAME[x.chain]}</small></span></span>
                  <span className="twin-s">
                    <span><small>Price</small><b>{price(x.price)}</b></span>
                    <span><small>Holders</small><b>{x.holders != null ? x.holders.toLocaleString("en-US") : "—"}</b></span>
                    <span><small>Value</small><b>{x.mcap != null && valueCredible(x) ? usd(x.mcap) : "—"}</b></span>
                  </span>
                  <small className="mono twin-ref">{short(x.ref)}</small>
                </Link>
              ))}
            </div>
          </section>
        )}
          </div>}
          <div className="rt-pane">
        <div className="srcbar">
          <span className="eyebrow muted">Sources</span>
          <a href={explorer} target="_blank" rel="noopener noreferrer" className="srcchip"><External width={13} height={13} />{a.standard === "kcc20" || a.standard === "kron" ? "KCC20 indexer" : a.chain === "igra" ? "Igra explorer" : a.standard === "krc20" ? "KaspaCom market" : a.chain === "zkas" ? "ZKas explorer" : "Kaspa explorer"}</a>
          {cur?.sources.map(([l, u]) => <a key={u} href={u} target="_blank" rel="noopener noreferrer" className="srcchip"><External width={13} height={13} />{l}</a>)}
          <span className="srcchip plain">dawns on-chain reads · {when(a.updatedAt)}</span>
          <CopyId text={a.id} />
          <Link href={`/assets/compare?ids=${encodeURIComponent(a.id)}`} className="btn ghost" style={{ marginLeft: "auto" }}>Compare with…</Link>
        </div>
            <div className="card">
              <div className="c-head"><h3>How each figure is valued</h3><span className="tag">{figs.length} figures</span></div>
              <div className="vlist">
                {figs.map((f) => <div key={f.label} className="vrow"><span /><div>{f.label}<small>{f.basis}</small><StampLine s={f.stamp} /></div><b>{f.value}</b></div>)}
              </div>
            </div>
          </div>
        </ResearchTabs>
      </div>
    </>
  );
}
