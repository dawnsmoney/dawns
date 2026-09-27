import Link from "next/link";
import { getSnapshot } from "@/lib/snapshot";
import { toLite, toRow, names } from "@/lib/view";
import { usd, usdFull, pct } from "@/lib/format";
import { Clouds, BAND_CLOUDS, COIN, HealthMeter, Pill, ProtocolCoin, SERIES, assetColor } from "@/components/bits";
import { Arrow, Bell, Info } from "@/components/icons";
import { HeroArt } from "@/components/HeroArt";
import { ProvButton, ProvRow, WatchButton, CopyReport } from "@/components/actions";
import { RangeChart, Donut } from "@/components/charts";
import { Feed, ProtocolList } from "@/components/sections";
import { DataBridge } from "@/components/providers";
import { Fresh } from "@/components/Fresh";
import type { Snapshot } from "@/lib/types";

export const revalidate = 120;

function BigSpark({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const W = 420, H = 86, n = values.length, mn = Math.min(...values), mx = Math.max(...values);
  const x = (i: number) => 4 + (i * (W - 12)) / (n - 1);
  const y = (v: number) => 6 + (H - 12) - ((v - mn) / (mx - mn || 1)) * (H - 12);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "min(420px,100%)", height: "auto" }} aria-hidden="true">
      <defs><linearGradient id="bsl" x1="0" x2="1"><stop offset="0" stopColor="#7CF0D2" stopOpacity=".25" /><stop offset="1" stopColor="#7CF0D2" /></linearGradient></defs>
      <path d={"M" + values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("L")} fill="none" stroke="url(#bsl)" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(n - 1)} cy={y(values[n - 1])} r="5" fill="#7CF0D2" stroke="#2A1F5E" strokeWidth="2" />
    </svg>
  );
}

function dawnReport(s: Snapshot) {
  const top = s.signals.slice(0, 3).map((g) => `· ${g.strong}`).join("\n");
  const d = new Date(s.asOf);
  const date = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  const lend = s.protocols.find((p) => p.lending);
  return `dawns check · Kaspa DeFi · ${date}

TVL ${usd(s.eco.tvl)}${s.kasUsd ? ` · KAS $${s.kasUsd.toPrecision(3)}${s.kas24 != null ? ` (${s.kas24 >= 0 ? "+" : ""}${(s.kas24 * 100).toFixed(1)}% 24h)` : ""}` : ""}
${lend?.lending ? `${lend.name}: ${usd(lend.lending.suppliedUsd)} supplied, ${usd(lend.lending.borrowedUsd)} borrowed, ${usd(lend.lending.cashUsd)} withdrawable\n` : ""}DEX liquidity ${usd(s.eco.dexLiq)}
${top ? `\nWorth a look:\n${top}\n` : ""}
Read on-chain, every number traceable.
dawns.money`;
}

export default async function Home() {
  const s = await getSnapshot();
  const lend = s.protocols.find((p) => p.lending);
  const dexes = s.protocols.filter((p) => p.kind === "dex" && p.tvl > 0);
  const featured = [lend, s.protocols.find((p) => p.dex)].filter(Boolean) as NonNullable<typeof lend>[];
  const rows = s.protocols.map(toRow);
  const n = names(s);
  const onchainShare = s.eco.tvl ? s.protocols.filter((p) => p.source === "onchain").reduce((a, p) => a + p.tvl, 0) / s.eco.tvl : 0;
  const top2 = s.eco.tvl ? [...s.protocols].sort((a, b) => b.tvl - a.tvl).slice(0, 2).reduce((a, p) => a + p.tvl, 0) / s.eco.tvl : 0;

  // composition: top 5 + other
  const comp = s.eco.composition.filter((c) => c.usd > 0);
  const top5 = comp.slice(0, 5);
  const rest = comp.slice(5).reduce((a, c) => a + c.usd, 0);
  const donut = [...top5.map((c, i) => ({ n: c.sym, v: c.usd, c: assetColor(c.sym) !== "#6E6788" ? assetColor(c.sym) : SERIES[i % 5] })), ...(rest > 0 ? [{ n: "Other", v: rest, c: "#6E6788" }] : [])];
  const used = new Set<string>();
  donut.forEach((d) => { if (used.has(d.c) && d.n !== "Other") d.c = SERIES.find((x) => !used.has(x)) ?? d.c; used.add(d.c); });

  const moved = s.eco.priceEffect + s.eco.qtyEffect;
  const before = s.eco.tvl - moved;
  const scale = Math.max(before, s.eco.tvl, 1);
  const sc = (v: number) => (Math.abs(v) / scale) * 100;
  const stackSeries = s.eco.stack.map((x, i) => ({ name: x.name, color: SERIES[i], values: x.values }));
  const spot = lend?.lending ? { id: lend.id, letter: lend.letter, name: lend.name, line: `${pct(lend.lending.coverage)} asset coverage` } : null;

  return (
    <>
      <DataBridge prov={s.prov} protocols={s.protocols.map(toLite)} signals={s.signals} />
      <section className="sky">
        <Clouds />
        <div className="wrap">
          <div className="hero">
            <div>
              <Link className="chip" href="/protocols"><b>Live</b>{onchainShare > 0 ? `${pct(onchainShare, 0)} of tracked value read on-chain` : "Kaspa DeFi, tracked"} <Arrow /></Link>
              <h1>Kaspa DeFi,<br />in plain daylight</h1>
              <div className="sub">Know what your capital stands on with <em>dawns.money</em></div>
              <p className="lede">Live health for every protocol in Kaspa DeFi. Every number traces back to a contract and a block.</p>
              <div className="ctas">
                <Link className="btn sun" href="/protocols">Explore protocols <span className="sq"><Arrow /></span></Link>
                {lend && <WatchButton id={lend.id} variant="glass" label="Watch a protocol" />}
              </div>
            </div>
            <HeroArt tvl={s.eco.tvl} spot={spot} />
          </div>
          <div className="strip">
            <ProvButton id="eco-tvl"><span>Kaspa DeFi TVL <Info /></span><b>{usd(s.eco.tvl)}</b><small>{s.protocols.length} protocols · updated <Fresh since={s.asOf} /></small></ProvButton>
            <ProvButton id="eco-lend"><span>Lending liquidity <Info /></span><b>{usd(s.eco.lendingLiq)}</b><small>withdrawable now</small></ProvButton>
            <ProvButton id="eco-dex"><span>DEX liquidity <Info /></span><b>{usd(s.eco.dexLiq)}</b><small>{dexes.length} DEXs</small></ProvButton>
            <ProvButton id="eco-util"><span>Lending utilization <Info /></span><b>{s.eco.lendingUtil != null ? pct(s.eco.lendingUtil) : "—"}</b><small>{s.eco.lendingBorrowed != null ? `${usd(s.eco.lendingBorrowed)} borrowed` : ""}</small></ProvButton>
          </div>
        </div>
        <div className="fade" />
      </section>

      {featured.length > 0 && (
        <section className="s wrap">
          <div className="s-head">
            <div className="badges">
              <span className="badge"><i />{usd(s.eco.tvl)} in Kaspa DeFi</span>
              {s.blocks.igra && <span className="badge"><i style={{ background: "linear-gradient(135deg,#8BF5CF,#179C75)" }} />Igra block #{s.blocks.igra.block.toLocaleString("en-US")}</span>}
            </div>
            <h2>How healthy is Kaspa DeFi<br />today?</h2>
            <p>The two largest protocols hold {pct(top2, 0)} of the value dawns tracks. Here is how each one looks right now.</p>
          </div>
          <div className="grid g2">
            {featured.map((p) => {
              const L = !!p.lending;
              return (
                <div key={p.id} className="card feat" style={{ ["--glow" as string]: (COIN[p.id] ?? ["", "#7B6CFF"])[1] }}>
                  <div className="top">
                    <ProtocolCoin p={p} size={76} />
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}><span className="tag">{p.category}</span><Pill t={p.status}>{p.statusText}</Pill></div>
                  </div>
                  <div>
                    <h3>{p.name}</h3>
                    <p style={{ marginTop: 10 }}>
                      {L && p.lending
                        ? `Lending on Kaspa via Igra. ${usd(p.lending.suppliedUsd)} supplied across ${p.lending.markets.length} markets, ${usd(p.lending.borrowedUsd)} borrowed. ${p.flags[0] ? p.flags[0][1] + "." : ""}`
                        : p.dex
                          ? `${p.dex.pairCount} pools across ${p.chains.join(" and ")}. The largest, ${p.dex.pools[0]?.symbols.join("/")}, holds ${pct(p.dex.pools[0]?.share ?? 0, 0)} of liquidity.`
                          : ""}
                    </p>
                  </div>
                  <div className="row">
                    <div className="stats">
                      <div><span>{L ? "Withdrawable" : "Liquidity"}</span><b>{usd(p.tvl)}</b></div>
                      <div><span>{L ? "Utilization" : "24h volume"}</span><b>{L ? pct(p.lending!.utilization) : p.dex?.vol24 != null ? usd(p.dex.vol24) : "—"}</b></div>
                      <div><span>Health</span><b style={{ display: "flex", alignItems: "center", height: 22 }}><HealthMeter status={p.status} /></b></div>
                    </div>
                    <Link className="btn iris" href={`/protocols/${p.id}`}>View health</Link>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section className="s wrap">
        <div className="l-head"><div><h2>Protocol health</h2><p>Every Kaspa DeFi protocol on Igra and Kasplex. Rows marked On-chain are read by dawns directly.</p></div></div>
        <ProtocolList rows={rows} />
      </section>

      <section className="sky band">
        <Clouds set={BAND_CLOUDS} />
        <div className="wrap">
          <div className="s-head">
            <h2 style={{ color: "#fff" }}>The Kaspa DeFi economy<br />in numbers</h2>
            <p style={{ color: "rgba(255,255,255,.78)" }}>On-chain reads at the latest block, with DefiLlama for history. Click any card to see the calculation.</p>
          </div>
          <div className="panel">
            <ProvRow id="eco-tvl" className="card big-tvl">
              <div>
                <div className="lab">Total value locked in Kaspa DeFi {s.kas24 != null && <Pill t={s.kas24 < 0 ? "crit" : "good"}>KAS {(s.kas24 * 100).toFixed(1)}% 24h</Pill>}</div>
                <div className="n">{usdFull(s.eco.tvl)}</div>
              </div>
              <BigSpark values={s.eco.series.slice(-60).map((p) => p.v)} />
            </ProvRow>
            <div className="grid gA">
              <div className="grid" style={{ gap: 16 }}>
                <ProvRow id="eco-lend" className="card tight mini">
                  <div className="lab"><span>Lending liquidity</span><span>Utilization <b style={{ color: "#fff" }}>{s.eco.lendingUtil != null ? pct(s.eco.lendingUtil) : "—"}</b></span></div>
                  <div className="n">{usd(s.eco.lendingLiq)}</div><div className="ctx muted">withdrawable now</div>
                </ProvRow>
                <ProvRow id="eco-dex" className="card tight mini">
                  <div className="lab"><span>DEX liquidity</span><span>{dexes.length} DEXs</span></div>
                  <div className="n">{usd(s.eco.dexLiq)}</div><div className="ctx muted">{dexes.slice(0, 2).map((d) => `${d.name} ${usd(d.tvl)}`).join(" · ")}</div>
                </ProvRow>
                <ProvRow id="eco-stable" className="card tight mini">
                  <div className="lab"><span>Stablecoin liquidity</span><span>USDC + USDT</span></div>
                  <div className="n">{usd(s.eco.stable)}</div><div className="ctx muted">{pct(s.eco.tvl ? s.eco.stable / s.eco.tvl : 0)} of TVL</div>
                </ProvRow>
              </div>
              <div className="card">
                <div className="c-head"><h3>Where the value sits</h3><span className="tag">by asset</span></div>
                {donut.length ? <Donut items={donut} /> : <p className="muted">No composition data this run.</p>}
              </div>
            </div>
            <div className="grid gA">
              <div className="card">
                {s.eco.dates.length > 2
                  ? <RangeChart title="Value locked by protocol" label="Kaspa DeFi TVL by protocol" series={stackSeries} dates={s.eco.dates} stacked zero legend height={260} />
                  : <p className="muted">History unavailable this run.</p>}
                <p className="foot">Daily history from DefiLlama, with mispriced days smoothed out.</p>
              </div>
              <div className="card">
                <div className="c-head"><h3>What moved TVL</h3><span className="tag">last day</span></div>
                <div className="wf">
                  <div className="wf-row"><span>Before</span><span className="lane"><i style={{ left: 0, width: `${sc(before)}%`, background: "rgba(255,255,255,.28)" }} /></span><b>{usd(before)}</b></div>
                  <div className="wf-row"><span>Price</span><span className="lane"><i style={{ left: `${sc(Math.min(before, before + s.eco.priceEffect))}%`, width: `${sc(s.eco.priceEffect)}%`, background: s.eco.priceEffect < 0 ? SERIES[3] : SERIES[1] }} /></span><b className={s.eco.priceEffect < 0 ? "down" : "up"}>{usd(s.eco.priceEffect, 0)}</b></div>
                  <div className="wf-row"><span>Net flows</span><span className="lane"><i style={{ left: `${sc(Math.min(before + s.eco.priceEffect, before + moved))}%`, width: `${sc(s.eco.qtyEffect)}%`, background: s.eco.qtyEffect < 0 ? SERIES[3] : SERIES[1], opacity: 0.65 }} /></span><b className={s.eco.qtyEffect < 0 ? "down" : "up"}>{usd(s.eco.qtyEffect, 0)}</b></div>
                </div>
                <p className="note" style={{ margin: "20px 0 0" }}>
                  Price effect is the change in value of tokens that stayed put. Net flows are tokens that arrived or left, valued at today&apos;s price. Both come from DefiLlama&apos;s daily token balances.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="s wrap">
        <div className="grid gA">
          <div className="card">
            <div className="c-head"><h3>Signals right now</h3><Link className="btn ghost sm" href="/watchlist"><Bell />Get alerts</Link></div>
            <Feed list={s.signals} names={n} />
          </div>
          <div className="card report">
            <span className="eyebrow">Dawn report</span>
            <h3 style={{ fontSize: 26, marginTop: 10 }}>Today in Kaspa DeFi</h3>
            <pre id="rep">{dawnReport(s)}</pre>
            <CopyReport text={dawnReport(s)} />
            <p style={{ fontSize: 13, color: "rgba(255,255,255,.75)", margin: "14px 0 0" }}>Written from the latest on-chain reads.</p>
          </div>
        </div>
      </section>

      <section className="s wrap">
        <div className="s-head"><h2>From daylight to capital</h2><p>Information first. Capital products come once people trust the data.</p></div>
        <div className="road">
          <div className="now"><span className="n">1 · LIVE</span><b>Intelligence</b><p>Protocol health, flows, and the source of every number.</p></div>
          <div className="now"><span className="n">2 · BETA</span><b>Watch &amp; alerts</b><p>Your thresholds on liquidity, utilization and risk changes.</p></div>
          <div><span className="n">3 · NEXT</span><b>Opportunities</b><p>Yield shown next to the health of whoever pays it.</p></div>
          <div><span className="n">4</span><b>Allocation</b><p>A portfolio built from your risk and exit policy.</p></div>
          <div><span className="n">5</span><b>Vaults</b><p>Managed, policy-bound strategies. Non-custodial.</p></div>
        </div>
      </section>
    </>
  );
}
