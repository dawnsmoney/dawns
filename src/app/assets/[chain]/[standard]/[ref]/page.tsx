import type { Metadata } from "next";
import Link from "next/link";
import { Fragment } from "react";
import { notFound } from "next/navigation";
import { Banner } from "@/components/Banner";
import { Pill, ProtocolCoin } from "@/components/bits";
import { RangeChart } from "@/components/charts";
import { OpportunityTable } from "@/components/opportunities";
import { getAssets, getAssetHistory } from "@/lib/assets";
import { analyse } from "@/lib/assets/analysis";
import { CURATED } from "@/lib/assets/profiles";
import { CHAIN_NAME, STANDARD_NAME, assetId, assetPath, valueCredible, type Asset, type AssetChain, type AssetStandard } from "@/lib/assets/types";
import { getSnapshot } from "@/lib/snapshot";
import { knownOf, holdingsOf } from "@/lib/assets/view";
import { usd, pct, price } from "@/lib/format";

export const revalidate = 300;

type P = { params: Promise<{ chain: string; standard: string; ref: string }> };
const CHAINS: AssetChain[] = ["kaspa", "igra", "kasplex", "zkas"];
const STANDARDS: AssetStandard[] = ["native", "krc20", "erc20"];

async function find(params: P["params"]): Promise<Asset | null> {
  const { chain, standard, ref } = await params;
  if (!CHAINS.includes(chain as AssetChain) || !STANDARDS.includes(standard as AssetStandard)) return null;
  const id = assetId(chain as AssetChain, standard as AssetStandard, decodeURIComponent(ref));
  return (await getAssets()).find((a) => a.id === id) ?? null;
}

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const a = await find(params);
  if (!a) return { title: "Asset not found" };
  return { title: `${a.symbol} · ${STANDARD_NAME[a.standard]} on ${CHAIN_NAME[a.chain]}`, description: analyse(a).what.slice(0, 180) };
}

const whole = (v: number | null, sym: string) => (v == null ? "—" : `${v >= 1e9 ? (v / 1e9).toFixed(2) + "B" : v >= 1e6 ? (v / 1e6).toFixed(2) + "M" : v >= 1e3 ? (v / 1e3).toFixed(1) + "K" : v.toFixed(2)} ${sym}`);
const hash = (h: number | null) => (h == null ? "—" : h >= 1e18 ? `${(h / 1e18).toFixed(2)} EH/s` : h >= 1e15 ? `${(h / 1e15).toFixed(1)} PH/s` : `${(h / 1e12).toFixed(0)} TH/s`);
const short = (s: string) => (s.length > 20 ? `${s.slice(0, 12)}…${s.slice(-6)}` : s);
const when = (ms: number | null) => (ms == null ? "—" : new Date(ms).toISOString().slice(0, 10));

function Stat({ label, value, sub }: { label: string; value: string; sub?: string | null }) {
  return (
    <div className="card">
      <span className="eyebrow muted">{label}</span>
      <b style={{ display: "block", font: "600 26px var(--display)", margin: "8px 0 4px" }}>{value}</b>
      {sub && <span className="muted" style={{ fontSize: 14 }}>{sub}</span>}
    </div>
  );
}

export default async function AssetPage({ params }: P) {
  const a = await find(params);
  if (!a) notFound();
  const [s, hist] = await Promise.all([getSnapshot(), getAssetHistory(a.id)]);
  const r = analyse(a);
  const cur = CURATED[a.id];
  const opps = s.opportunities.filter((o) => a.pools.includes(o.id));
  const held = holdingsOf(a, s);
  const heldTotal = held.reduce((x, h) => x + h.usd, 0);
  const all = await getAssets();
  const sameTicker = all.filter((x) => x.symbol.toUpperCase() === a.symbol.toUpperCase() && x.id !== a.id);
  const dates = hist.map((d) => Date.parse(d.day));
  const priced = hist.filter((d) => d.price != null).length >= 2;
  const explorer = a.chain === "igra" ? `https://explorer.igralabs.com/token/${a.ref}` : a.standard === "krc20" ? `https://kaspa.com/tokens/marketplace/token/${a.ref}` : a.chain === "kasplex" ? `https://explorer.kasplex.org/token/${a.ref}` : a.chain === "zkas" ? "https://explorer.zkas.info/analytics" : "https://explorer.kaspa.org";

  return (
    <>
      <Banner short crumb={[{ href: "/assets", label: "Assets" }, { label: `${STANDARD_NAME[a.standard]} · ${CHAIN_NAME[a.chain]}` }]}
        title={<>{a.symbol}{a.name.toLowerCase() !== a.symbol.toLowerCase() && <span className="muted" style={{ fontWeight: 400 }}> {a.name}</span>}</>}
        lede={r.what} />
      <div className="wrap" style={{ paddingTop: 40, display: "grid", gap: 28 }}>
        <div className="grid g3">
          <Stat label="Price" value={price(a.price)} sub={a.poolPrice != null && a.price != null && Math.abs(a.price / a.poolPrice - 1) >= 0.05
            ? `${a.priceSrc} · ${price(a.poolPrice)} in its ${CHAIN_NAME[a.chain]} pools (${a.price > a.poolPrice ? `${(a.price / a.poolPrice).toFixed(1)}× lower` : `${(a.poolPrice / a.price).toFixed(1)}× higher`})`
            : a.priceSrc} />
          <Stat label={a.standard === "native" ? "Market value" : "Value on chain"} value={a.mcap != null ? usd(a.mcap) : "—"} sub={a.mcap == null ? "no price to value it" : valueCredible(a) ? "price × circulating supply" : "not realizable: too little trading behind the price"} />
          <Stat label="Traded 24h" value={a.vol24 != null ? usd(a.vol24) : "—"} sub={a.volSrc ?? "not measured"} />
          <Stat label="Holders" value={a.holders != null ? a.holders.toLocaleString("en-US") : a.chain === "zkas" ? "Shielded" : "—"} sub={a.top10 != null ? `10 largest hold ${pct(a.top10, 0)}` : a.chain === "zkas" ? "balances are private by design" : null} />
          <Stat label="In DeFi" value={a.liquidity ? usd(a.liquidity) : `${opps.length} venues`} sub={a.liquidity ? `in ${a.pools.length} pools and markets dawns reads` : opps.length ? "lending and pools dawns reads" : "no DeFi venue dawns reads"} />
          <Stat label="Could leave in a day" value={r.capacity ? `≈ ${usd(r.capacity.usd)}` : "—"} sub={r.capacity ? `rough guide: ${r.capacity.basis}` : "no measured market"} />
        </div>

        <div className="grid gA">
          <div className="card">
            <div className="c-head"><h3>dawns&apos; reading</h3><Pill t={r.grade.t}>{r.grade.label}</Pill></div>
            <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 10, color: "var(--ink-2)" }}>
              {r.flags.map(([t, f]) => <li key={f}><Pill t={t}>{t === "crit" ? "High" : t === "warn" ? "Watch" : t === "good" ? "OK" : "Note"}</Pill> {f}</li>)}
              {!r.flags.length && <li>Nothing stands out in the data dawns reads.</li>}
            </ul>
            <p className="muted" style={{ fontSize: 13, marginTop: 16, marginBottom: 0 }}>Research, not advice: dawns states what the data shows and what it cannot show. It never says buy or sell.</p>
          </div>
          <div className="card">
            <div className="c-head"><h3>Questions to investigate</h3></div>
            <ol style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 10, color: "var(--ink-2)" }}>
              {r.questions.map((q) => <li key={q}>{q}</li>)}
              {!r.questions.length && <li>Who holds it, and why? What is it used for beyond trading?</li>}
            </ol>
          </div>
        </div>

        <div className="grid gA">
          <div className="card">
            <div className="c-head"><h3>Supply</h3></div>
            <dl className="kv">
              <dt>Circulating</dt><dd>{whole(a.supply, a.symbol)}</dd>
              <dt>Maximum</dt><dd>{a.maxSupply != null ? whole(a.maxSupply, a.symbol) : a.standard === "native" && a.chain === "zkas" ? "No cap: perpetual tail emission" : "—"}</dd>
              {a.mintedShare != null && <><dt>Minted</dt><dd>{pct(a.mintedShare, 1)}{a.state === "finished" ? " · minting finished" : " · still minting"}</dd></>}
              {a.premineShare != null && <><dt>Pre-minted</dt><dd>{pct(a.premineShare, 1)} of maximum</dd></>}
              {a.net?.blockReward != null && <><dt>Block reward</dt><dd>{a.net.blockReward.toFixed(4)} {a.symbol} × {a.net.bps != null ? a.net.bps.toFixed(a.net.bps < 2 ? 2 : 0) : "?"} blocks/s</dd></>}
              {a.net?.emissionPerYear != null && <><dt>Next 12 months</dt><dd>+{whole(a.net.emissionPerYear, a.symbol)}{a.net.inflation != null ? ` · +${pct(a.net.inflation, a.net.inflation >= 1 ? 0 : 1)} of circulating` : ""}{a.net.emissionBasis ? <small className="muted" style={{ display: "block" }}>{a.net.emissionBasis}</small> : null}</dd></>}
              {a.net?.nextReduction && <><dt>Next reduction</dt><dd>{when(a.net.nextReduction.at)} to {a.net.nextReduction.amount.toFixed(4)} {a.symbol}/block</dd></>}
              <dt>Launched</dt><dd>{when(a.launched)}</dd>
              <dt>Identifier</dt><dd className="mono" style={{ wordBreak: "break-all" }}>{a.id}</dd>
            </dl>
          </div>
          {a.net ? (
            <div className="card">
              <div className="c-head"><h3>Network</h3></div>
              <dl className="kv">
                <dt>Hashrate</dt><dd>{hash(a.net.hashrate)}{a.chain === "zkas" ? " · from consensus difficulty" : ""}</dd>
                {a.net.mergedShare != null && <><dt>Share of Kaspa</dt><dd>{pct(a.net.mergedShare, 1)} of Kaspa&apos;s hashrate</dd></>}
                {a.net.difficulty != null && <><dt>Difficulty</dt><dd>{a.net.difficulty.toExponential(3)}</dd></>}
                {a.net.daa != null && <><dt>DAA score</dt><dd>{a.net.daa.toLocaleString("en-US")}</dd></>}
                {a.net.producers && <><dt>Block producers</dt><dd>{a.net.producers.toMajority} made over half of {a.net.producers.sampled.toLocaleString("en-US")} sampled blocks · {a.net.producers.distinct} seen in {a.net.producers.days} day{a.net.producers.days > 1 ? "s" : ""}
                  <small className="muted" style={{ display: "block" }}>{a.net.producers.top.slice(0, 4).map((t) => `${t.id.slice(0, 8)}… ${pct(t.share, 0)}`).join(" · ")}</small>
                  <small className="muted" style={{ display: "block" }}>Read from each block&apos;s payout address. One operator can use several addresses, so real concentration can only be higher.</small></dd></>}
                {a.net.shielded && <><dt>Shielded pool</dt><dd>{a.net.shielded.notes.toLocaleString("en-US")} notes · {a.net.shielded.nullifiers.toLocaleString("en-US")} spent · {a.net.shielded.turnstileOut > 0 ? `${whole(a.net.shielded.turnstileOut, a.symbol)} ever left` : "nothing has ever left"}</dd></>}
              </dl>
              {cur && <dl className="kv" style={{ marginTop: 18, paddingTop: 18, borderTop: "1px solid var(--line)" }}>{cur.facts.map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>)}</dl>}
            </div>
          ) : (
            <div className="card">
              <div className="c-head"><h3>Largest holders</h3>{a.holdersAt && <span className="muted" style={{ fontSize: 13 }}>read {when(a.holdersAt)}</span>}</div>
              {a.topHolders?.length ? (
                <div className="vlist">
                  {a.topHolders.map((h, i) => (
                    <div className="vrow" key={h.address}><span className="muted">{i + 1}</span>
                      <div className="mono" style={{ fontSize: 13.5 }}>{short(h.address)}<small>{h.label ? `${h.label}${h.kind === "exchange" ? " · exchange" : ""}` : h.contract ? "Contract" : "Address"}</small></div>
                      <b>{pct(h.share, 1)}</b></div>
                  ))}
                </div>
              ) : <p className="muted" style={{ margin: 0 }}>Not read yet. dawns reads the holder lists of the most significant assets first.</p>}
              {a.standard === "krc20" && a.topHolders?.length ? <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>Names from the address list the Kaspa REST API publishes (exchanges, burn address, funds). An unnamed address may still be an exchange or marketplace escrow.</p> : null}
            </div>
          )}
        </div>

        {priced && (
          <div className="card">
            <RangeChart title="Price, daily" label={`${a.symbol} price history`} dates={dates}
              series={[{ name: "Price", color: "#8578E6", values: hist.map((d) => d.price ?? 0) }]} fmt="usdFull" area="first" />
          </div>
        )}

        {held.length > 0 && (
          <div className="card">
            <div className="c-head"><h3>Held in protocols</h3><span className="tag">{usd(heldTotal)}</span></div>
            <div className="vlist">
              {held.map((h) => (
                <div className="vrow" key={h.protocol}>
                  <ProtocolCoin p={{ id: h.protocol, letter: h.letter }} size={30} />
                  <div><Link href={`/protocols/${h.protocol}`}>{h.name}</Link><small>{h.where.slice(0, 4).join(" · ")}{h.where.length > 4 ? ` · +${h.where.length - 4} more` : ""}</small></div>
                  <b>{usd(h.usd)}<small className="muted" style={{ display: "block", fontWeight: 400, textAlign: "right" }}>{pct(h.usd / heldTotal, 0)}</small></b>
                </div>
              ))}
            </div>
            <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>From dawns&apos; own reads: half of each pool&apos;s value per token, and what was supplied to each lending market.{a.id === "kaspa:native:KAS" ? " KAS includes its wrapped forms on the L2s (WiKAS, iKAS, WKAS)." : ""}</p>
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

        <div className="grid gA">
          {sameTicker.length > 0 && (
            <div className="card">
              <div className="c-head"><h3>Same ticker, different asset</h3></div>
              <p className="muted" style={{ marginTop: 0 }}>These share the name {a.symbol} but are separate assets with their own supply, holders and risks.</p>
              <div className="vlist">
                {sameTicker.slice(0, 6).map((x) => (
                  <div className="vrow" key={x.id}><span /><div><Link href={assetPath(x.id)}>{x.symbol} · {STANDARD_NAME[x.standard]} on {CHAIN_NAME[x.chain]}</Link><small className="mono">{short(x.ref)}</small></div><b>{x.mcap != null ? usd(x.mcap) : ""}</b></div>
                ))}
              </div>
            </div>
          )}
          <div className="card">
            <div className="c-head"><h3>Sources</h3></div>
            <div className="vlist">
              <div className="vrow"><span /><div><a href={explorer} target="_blank" rel="noopener noreferrer">{a.chain === "igra" ? "Igra explorer" : a.standard === "krc20" ? "KaspaCom market" : a.chain === "zkas" ? "ZKas explorer" : "Explorer"}</a><small>{a.standard === "krc20" ? "price, volume, holders" : a.chain === "zkas" ? "supply, emission, hashrate, shielded pool" : "supply, holders"}</small></div><b /></div>
              {cur?.sources.map(([l, u]) => <div className="vrow" key={u}><span /><div><a href={u} target="_blank" rel="noopener noreferrer">{l}</a><small>{new URL(u).host}</small></div><b /></div>)}
              <div className="vrow"><span /><div>dawns<small>DEX pools and lending markets read on-chain; updated {when(a.updatedAt)}</small></div><b /></div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
