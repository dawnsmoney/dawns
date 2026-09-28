import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getAssets, getAssetHistory } from "@/lib/assets";
import { analyse, dimensions } from "@/lib/assets/analysis";
import { supplyParts, holderCat, catOf } from "@/lib/assets/holders";
import { CHAIN_NAME, STANDARD_NAME, assetId, assetPath, valueCredible, type Asset, type AssetChain, type AssetStandard } from "@/lib/assets/types";
import { holdingsOf } from "@/lib/assets/view";
import { getSnapshot } from "@/lib/snapshot";
import { MCard, MFlags, MHead, MKv, MList, MNote, MRow, MStats } from "@/components/m/kit";
import { MMore, MTabs } from "@/components/m/tabs";
import { MOpp } from "@/components/m/opps";
import { AssetCoin, Pill } from "@/components/bits";
import { Compare, CopyId, Ring, SplitBar } from "@/components/viz";
import { AreaChart } from "@/components/charts";
import { DepthCard, MovesCard, UnlocksCard } from "@/components/asset-sections";
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
export async function generateMetadata({ params }: P): Promise<Metadata> {
  const a = await find(params);
  return a ? { title: `${a.symbol} · ${STANDARD_NAME[a.standard]} on ${CHAIN_NAME[a.chain]}`, description: analyse(a).what.slice(0, 180) } : { title: "Asset not found" };
}
const whole = (v: number | null, sym: string) => (v == null ? "—" : `${v >= 1e9 ? (v / 1e9).toFixed(2) + "B" : v >= 1e6 ? (v / 1e6).toFixed(2) + "M" : v >= 1e3 ? (v / 1e3).toFixed(1) + "K" : v.toFixed(2)} ${sym}`);
const short = (s: string) => (s.length > 20 ? `${s.slice(0, 10)}…${s.slice(-6)}` : s);
const when = (ms: number | null) => (ms == null ? "—" : new Date(ms).toISOString().slice(0, 10));

export default async function MAsset({ params }: P) {
  const a = await find(params);
  if (!a) notFound();
  const [s, hist, all] = await Promise.all([getSnapshot(), getAssetHistory(a.id), getAssets()]);
  const r = analyse(a);
  const tiles = dimensions(a, r);
  const parts = supplyParts(a.topHolders, a.top10);
  const opps = s.opportunities.filter((o) => a.pools.includes(o.id));
  const held = holdingsOf(a, s);
  const priced = hist.filter((d) => d.price != null).length >= 2;
  const holdersHist = hist.filter((d) => d.holders != null).length >= 3;
  const isKas = a.id === "kaspa:native:KAS";
  const twins = all.filter((x) => x.id !== a.id && (isKas ? /^(w?i?kas|wikas|ikas|wkas)$/i.test(x.symbol) : x.symbol.toUpperCase() === a.symbol.toUpperCase())).slice(0, 6);
  const gap = a.poolPrice != null && a.price != null && Math.abs(a.price / a.poolPrice - 1) >= 0.05;
  const tabs = [
    { key: "r", label: "Reading", badge: r.flags.length || null },
    { key: "m", label: "Market" },
    ...(parts.length || a.net ? [{ key: "h", label: a.net ? "Supply" : "Holders" }] : []),
    { key: "d", label: "DeFi", badge: opps.length || null },
  ];
  return (
    <>
      <MHead back={{ href: "/assets", label: "Assets" }} eyebrow={`${STANDARD_NAME[a.standard]} · ${CHAIN_NAME[a.chain]}`}
        title={<span style={{ display: "flex", alignItems: "center", gap: 12 }}><AssetCoin a={a.symbol} size={40} />{a.symbol}</span>} sub={r.what} clamp />
      <div className="m-screen">
        <MStats items={[
          { label: "Price", value: price(a.price), sub: a.priceSrc ?? undefined },
          { label: a.standard === "native" ? "Market value" : "Value on chain", value: a.mcap != null ? usd(a.mcap) : "—", sub: a.mcap != null && !valueCredible(a) ? "not realizable: too little trading" : `${whole(a.supply, a.symbol)}` },
          { label: "Holders", value: a.holders != null ? a.holders.toLocaleString("en-US") : a.chain === "zkas" ? "Shielded" : "—", sub: a.top10 != null ? `top 10 hold ${pct(a.top10, 0)}` : undefined },
          { label: "Traded 24h", value: a.vol24 != null ? usd(a.vol24) : "—", sub: a.liquidity ? `${usd(a.liquidity)} in DEX pools` : undefined },
        ]} />
        <MTabs tabs={tabs}>
          <div className="m-panel">
            <MCard title="dawns' reading" tag={<Pill t={r.grade.t}>{r.grade.label}</Pill>}>
              <MStats items={tiles.map((t) => ({ label: t.title, value: t.big, sub: t.small, tone: t.t === "info" ? undefined : t.t }))} />
            </MCard>
            {r.flags.length > 0 && <MCard title="Findings"><MFlags flags={r.flags} /></MCard>}
            {r.questions.length > 0 && <MCard title="Questions to investigate"><ol className="m-opp-notes" style={{ paddingLeft: 20 }}>{r.questions.map((q) => <li key={q}>{q}</li>)}</ol></MCard>}
            <MNote>Research, not advice: dawns shows what the data says and what it cannot show. It never says buy or sell.</MNote>
          </div>
          <div className="m-panel">
            {gap && a.price != null && a.poolPrice != null && (
              <MCard title="Two prices"><Compare a={{ label: "Headline", value: a.price, display: price(a.price) }} b={{ label: `${CHAIN_NAME[a.chain]} pools`, value: a.poolPrice, display: price(a.poolPrice) }} /><MNote>What you could sell for on {CHAIN_NAME[a.chain]} is the pool price.</MNote></MCard>
            )}
            {a.depth && a.depth.d10 > 0 && <DepthCard a={a} />}
            {priced && <MCard title="Price" tag="daily"><AreaChart label={`${a.symbol} price`} dates={hist.map((d) => Date.parse(d.day))} series={[{ name: "Price", color: "#8578E6", values: hist.map((d) => d.price ?? 0) }]} fmt="usdFull" height={180} /></MCard>}
            {holdersHist && <MCard title="Holders" tag="daily"><AreaChart label={`${a.symbol} holders`} dates={hist.filter((d) => d.holders != null).map((d) => Date.parse(d.day))} series={[{ name: "Holders", color: "#199e70", values: hist.filter((d) => d.holders != null).map((d) => d.holders!) }]} fmt="num" zero={false} height={170} /></MCard>}
            {!gap && !a.depth && !priced && !holdersHist && <MNote>No market readings for this asset yet.</MNote>}
          </div>
          {(parts.length || a.net) ? (
            <div className="m-panel">
              {parts.length > 0 && (
                <MCard title="Who holds it" tag={a.top10 != null ? `top 10: ${pct(a.top10, 0)}` : undefined}>
                  <SplitBar parts={parts.map((p) => ({ key: p.key, label: p.label, color: p.color, share: p.share }))} label={`${a.symbol} supply by holder kind`} height={18} />
                  <MList>
                    <MMore first={5} label="All top holders">
                      {(a.topHolders ?? []).map((h, i) => <MRow key={h.address} title={h.label ?? short(h.address)} sub={`#${i + 1} · ${catOf(holderCat(h))?.label ?? ""}`} value={pct(h.share, 1)} />)}
                    </MMore>
                  </MList>
                </MCard>
              )}
              {a.unlocks && <UnlocksCard a={a} />}
              {a.moves && a.moves.length > 0 && <MovesCard a={a} />}
              {(a.maxSupply || a.net) && (
                <MCard title="Supply" tag={whole(a.supply, a.symbol)}>
                  {a.net?.path?.length ? <AreaChart label={`${a.symbol} supply, next 24 months`} dates={a.net.path.map((x) => x.t)} series={[{ name: "Supply", color: "#9085e9", values: a.net.path.map((x) => x.supply) }]} fmt="num" zero={false} height={170} /> : null}
                  <div className="rings">
                    {a.maxSupply != null && a.supply != null && a.maxSupply > 0 && <Ring value={a.supply / a.maxSupply} size={110} label={a.standard === "krc20" ? "Minted" : "Of max supply"} sub={`of ${whole(a.maxSupply, a.symbol)}`} color="#9085e9" />}
                    {a.net?.inflation != null && <Ring value={Math.min(1, a.net.inflation)} size={110} display={`+${pct(a.net.inflation, 1)}`} label="New supply, 12 months" color="#d95926" />}
                  </div>
                  <MKv rows={[
                    ...(a.net?.nextReduction ? [["Next reduction", `${when(a.net.nextReduction.at)} to ${a.net.nextReduction.amount.toFixed(4)}/block`] as [string, string]] : []),
                    ...(a.launched ? [["Launched", when(a.launched)] as [string, string]] : []),
                  ]} />
                </MCard>
              )}
            </div>
          ) : null}
          <div className="m-panel">
            {opps.length ? <div className="m-opps">{opps.map((o) => <MOpp key={o.id} o={o} />)}</div> : <MNote>{a.pools.length ? "It sits in pools or markets below the $5K dawns lists." : "No pool or lending market dawns reads holds it."}</MNote>}
            {held.length > 0 && (
              <MCard title="Held in protocols" flush>
                <MList>{held.map((h) => <MRow key={h.protocol} href={`/protocols/${h.protocol}`} title={h.name} sub={h.where.slice(0, 3).join(" · ")} value={usd(h.usd)} />)}</MList>
              </MCard>
            )}
            {twins.length > 0 && (
              <MCard title={isKas ? "KAS on other chains" : `Also called ${a.symbol}`} flush>
                <MList>{twins.map((x) => <MRow key={x.id} href={assetPath(x.id)} icon={<AssetCoin a={x.symbol} size={30} />} title={x.name !== x.symbol ? x.name : x.symbol} sub={`${STANDARD_NAME[x.standard]} · ${CHAIN_NAME[x.chain]}`} value={price(x.price)} />)}</MList>
              </MCard>
            )}
          </div>
        </MTabs>
        <CopyId text={a.id} />
        <Link className="m-btn ghost" href={`/assets/compare?ids=${encodeURIComponent(a.id)}`}>Compare with…</Link>
      </div>
    </>
  );
}
