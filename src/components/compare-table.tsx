import Link from "next/link";
import { AssetCoin, Pill } from "./bits";
import { SplitBar } from "./viz";
import { analyse } from "@/lib/assets/analysis";
import { supplyParts, SLOT } from "@/lib/assets/holders";
import { CHAIN_NAME, STANDARD_NAME, assetPath, valueCredible, unlockedAt, type Asset } from "@/lib/assets/types";
import { usd, pct, price } from "@/lib/format";

const count = (v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e4 ? `${(v / 1e3).toFixed(1)}K` : Math.round(v).toLocaleString("en-US"));
const sub = (a: Asset) => (a.standard === "native" ? CHAIN_NAME[a.chain] : `${STANDARD_NAME[a.standard]} · ${CHAIN_NAME[a.chain]}`);

interface Row { label: string; hint?: string; get: (a: Asset) => { v: number | null; text: string; note?: string } ; bar?: "max" | "share" }

const unlock12 = (a: Asset) => {
  const u = a.unlocks;
  if (!u) return null;
  const at = (t: number) => u.pools.reduce((s, p) => s + unlockedAt(p, t), 0);
  return (at(a.updatedAt + 365 * 864e5) - at(a.updatedAt)) / (a.supply ?? u.total);
};

const ROWS: { group: string; rows: Row[] }[] = [
  { group: "Market", rows: [
    { label: "Price", get: (a) => ({ v: null, text: price(a.price), note: a.poolPrice != null && a.price != null && Math.abs(a.price / a.poolPrice - 1) >= 0.05 ? `pools: ${price(a.poolPrice)}` : undefined }) },
    { label: "Value on chain", hint: "price × circulating; only where a market could carry it", bar: "max", get: (a) => (a.mcap != null && valueCredible(a) ? { v: a.mcap, text: usd(a.mcap) } : { v: null, text: "—", note: a.mcap != null ? "not realizable" : undefined }) },
    { label: "Traded, 24h", bar: "max", get: (a) => ({ v: a.vol24, text: a.vol24 != null ? usd(a.vol24) : "—" }) },
    { label: "Price, 7 days", get: (a) => (a.price != null && a.price7 ? { v: null, text: `${a.price >= a.price7 ? "+" : "−"}${pct(Math.abs(a.price / a.price7 - 1), 1)}` } : { v: null, text: "—" }) },
  ] },
  { group: "Liquidity", rows: [
    { label: "In DeFi pools", bar: "max", get: (a) => ({ v: a.liquidity, text: a.liquidity ? usd(a.liquidity) : "—" }) },
    { label: "Sell before −2%", hint: "across the pools dawns reads", bar: "max", get: (a) => ({ v: a.depth?.d2 ?? null, text: a.depth ? usd(a.depth.d2) : "—" }) },
    { label: "Sell before −10%", bar: "max", get: (a) => ({ v: a.depth?.d10 ?? null, text: a.depth ? usd(a.depth.d10) : "—", note: a.depth && a.mcap && valueCredible(a) ? `${pct(a.depth.d10 / a.mcap, 1)} of its value` : undefined }) },
    { label: "DeFi venues", bar: "max", get: (a) => ({ v: a.pools.length, text: String(a.pools.length) }) },
  ] },
  { group: "Holders", rows: [
    { label: "Holders", bar: "max", get: (a) => ({ v: a.holders, text: a.holders != null ? count(a.holders) : a.chain === "zkas" ? "Shielded" : "—", note: a.holders != null && a.holders7 ? `${a.holders >= a.holders7 ? "+" : "−"}${pct(Math.abs(a.holders / a.holders7 - 1), 1)} in 7 days` : undefined }) },
    { label: "Top 10 hold", bar: "share", get: (a) => ({ v: a.top10, text: a.top10 != null ? pct(a.top10, 0) : "—" }) },
  ] },
  { group: "Supply", rows: [
    { label: "Of max supply", bar: "share", get: (a) => (a.maxSupply && a.supply != null ? { v: a.supply / a.maxSupply, text: pct(a.supply / a.maxSupply, 0) } : { v: null, text: a.maxSupply == null && a.supply != null ? "no cap" : "—" }) },
    { label: "New supply, 12 months", hint: "emission or on-chain unlocks, of circulating", bar: "share", get: (a) => { const x = a.net?.inflation ?? unlock12(a); return x != null ? { v: Math.min(1, x), text: `+${pct(x, x >= 1 ? 0 : 1)}`, note: a.net ? "emission" : "vesting unlocks" } : { v: null, text: "—" }; } },
    { label: "Pre-minted", bar: "share", get: (a) => (a.premineShare != null ? { v: a.premineShare, text: pct(a.premineShare, 1) } : { v: null, text: "—" }) },
  ] },
];

/** Assets side by side on the same measures; bars compare within a row. */
export function CompareTable({ picked }: { picked: Asset[] }) {
  const cols = `minmax(150px,1fr) repeat(${Math.max(1, picked.length)}, minmax(0,1.3fr))`;
  return (
          <div className="card cmp">
            <div className="cmp-row cmp-head" style={{ gridTemplateColumns: cols }}>
              <span />
              {picked.map((a, i) => {
                const r = analyse(a);
                return (
                  <Link key={a.id} href={assetPath(a.id)} className="cmp-asset" style={{ ["--c" as string]: SLOT[i] }}>
                    <AssetCoin a={a.symbol} size={36} />
                    <span><b>{a.symbol}</b><small>{sub(a)}</small></span>
                    <Pill t={r.grade.t}>{r.grade.t === "crit" ? "High" : r.grade.t === "warn" ? "Watch" : "OK"}</Pill>
                  </Link>
                );
              })}
            </div>
            {ROWS.map((g) => (
              <div key={g.group} className="cmp-group">
                <div className="eyebrow muted cmp-g">{g.group}</div>
                {g.rows.map((row) => {
                  const vals = picked.map(row.get);
                  const m = Math.max(...vals.map((x) => x.v ?? 0), 1e-12);
                  if (vals.every((x) => x.text === "—")) return null;
                  return (
                    <div key={row.label} className="cmp-row" style={{ gridTemplateColumns: cols }}>
                      <span className="cmp-l">{row.label}{row.hint && <small>{row.hint}</small>}</span>
                      {vals.map((x, i) => (
                        <span key={picked[i].id} className="cmp-c">
                          <b>{x.text}</b>
                          {row.bar && x.v != null && <span className="cmp-bar"><i style={{ width: `${Math.max(1.5, (row.bar === "share" ? Math.min(1, x.v) : x.v / m) * 100)}%`, background: SLOT[i] }} /></span>}
                          {x.note && <small>{x.note}</small>}
                        </span>
                      ))}
                    </div>
                  );
                })}
              </div>
            ))}
            <div className="cmp-group">
              <div className="eyebrow muted cmp-g">Who holds it</div>
              <div className="cmp-row" style={{ gridTemplateColumns: cols }}>
                <span className="cmp-l">Top 10 by kind<small>hover a segment</small></span>
                {picked.map((a) => {
                  const parts = supplyParts(a.topHolders, a.top10);
                  return <span key={a.id} className="cmp-c">{parts.length ? <SplitBar parts={parts.map((p) => ({ key: p.key, label: p.label, color: p.color, share: p.share }))} label={`${a.symbol} by holder kind`} height={18} legend={false} /> : <b className="muted">—</b>}</span>;
                })}
              </div>
            </div>
          </div>
        );
}
