import Link from "next/link";
import { P, ECO, EVENTS, DATES, C, dawnReport, ecoComposition, ecoStack } from "@/lib/data";
import { usd, usdFull, pct } from "@/lib/format";
import { Change, Clouds, BAND_CLOUDS, COIN, HealthMeter, Pill, ProtocolCoin } from "@/components/bits";
import { Arrow, Bell, Info } from "@/components/icons";
import { HeroArt } from "@/components/HeroArt";
import { ProvButton, ProvRow, WatchButton, CopyReport } from "@/components/actions";
import { RangeChart, Donut } from "@/components/charts";
import { Feed, ProtocolList } from "@/components/sections";

function BigSpark({ values }: { values: number[] }) {
  const W = 420, H = 86, n = values.length, mn = Math.min(...values), mx = Math.max(...values);
  const x = (i: number) => 4 + (i * (W - 12)) / (n - 1);
  const y = (v: number) => 6 + (H - 12) - ((v - mn) / (mx - mn)) * (H - 12);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "min(420px,100%)", height: "auto" }} aria-hidden="true">
      <defs>
        <linearGradient id="bsl" x1="0" x2="1"><stop offset="0" stopColor="#7CF0D2" stopOpacity=".25" /><stop offset="1" stopColor="#7CF0D2" /></linearGradient>
      </defs>
      <path d={"M" + values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("L")} fill="none" stroke="url(#bsl)" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(n - 1)} cy={y(values[n - 1])} r="5" fill="#7CF0D2" stroke="#2A1F5E" strokeWidth="2" />
    </svg>
  );
}

export default function Home() {
  const k = P.kaskad, z = P.zealous;
  const start = ECO.prev24, sc = (v: number) => (v / start) * 100, endV = ECO.tvl, afterPrice = start + ECO.price;
  const cents = (ECO.tvl % 1).toFixed(2).slice(1);
  return (
    <>
      <section className="sky">
        <Clouds />
        <div className="wrap">
          <div className="hero">
            <div>
              <Link className="chip" href="/brand"><b>Prototype</b>TVLs from DefiLlama · other figures are samples <Arrow /></Link>
              <h1>Kaspa DeFi,<br />in plain daylight</h1>
              <div className="sub">Know what your capital stands on with <em>dawns.money</em></div>
              <p className="lede">Live, on-chain health for every protocol in Kaspa DeFi. Every number traces back to a contract and a block.</p>
              <div className="ctas">
                <Link className="btn sun" href="/protocols">Explore protocols <span className="sq"><Arrow /></span></Link>
                <WatchButton id="kaskad" variant="glass" label="Watch a protocol" />
              </div>
            </div>
            <HeroArt />
          </div>
          <div className="strip">
            <ProvButton id="eco-tvl"><span>Kaspa DeFi TVL <Info /></span><b>{usd(ECO.tvl)}</b><small><Change v={ECO.d24} /> 24h</small></ProvButton>
            <ProvButton id="eco-lend"><span>Lending liquidity <Info /></span><b>{usd(k.tvl)}</b><small><Change v={k.d24} /> 24h</small></ProvButton>
            <ProvButton id="eco-dex"><span>DEX liquidity <Info /></span><b>{usd(ECO.dexLiq)}</b><small><Change v={ECO.dexLiq / ECO.dexPrev - 1} /> 24h</small></ProvButton>
            <ProvButton id="eco-util"><span>Lending utilization <Info /></span><b>{pct(k.util!)}</b><small><Change v={k.utilD7!} unit="pp" /> 7d</small></ProvButton>
          </div>
        </div>
        <div className="fade" />
      </section>

      <section className="s wrap">
        <div className="s-head">
          <div className="badges">
            <span className="badge"><i />{usd(ECO.tvl)} locked in Kaspa DeFi</span>
            <span className="badge"><i style={{ background: "linear-gradient(135deg,#8BF5CF,#179C75)" }} />Updated every block</span>
          </div>
          <h2>How healthy is Kaspa DeFi<br />today?</h2>
          <p>Two protocols hold 97% of the value dawns tracks on Kaspa. Here is how each one looks right now.</p>
        </div>
        <div className="grid g2">
          {[k, z].map((p) => {
            const L = p.cat === "Lending";
            return (
              <div key={p.id} className="card feat" style={{ ["--glow" as string]: COIN[p.id][1] }}>
                <div className="top">
                  <ProtocolCoin p={p} size={76} />
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}><span className="tag">{p.cat}</span><Pill t={p.status}>{p.statusText}</Pill></div>
                </div>
                <div>
                  <h3>{p.name}</h3>
                  <p style={{ marginTop: 10 }}>
                    {L
                      ? "Multi-asset lending on Kaspa, running on Igra. Suppliers earn from borrowers, with iKAS as the main collateral. Loans are backed by $1.09M of collateral, 310% of debt."
                      : "The deepest DEX in Kaspa DeFi. 14 pools, all paired against iKAS. Trading fees go to liquidity providers."}
                  </p>
                </div>
                <div className="row">
                  <div className="stats">
                    <div><span>Liquidity</span><b>{usd(p.tvl)}</b></div>
                    <div><span>{L ? "Utilization" : "24h volume"}</span><b>{L ? pct(p.util!) : usd(p.vol24!)}</b></div>
                    <div><span>Health</span><b style={{ display: "flex", alignItems: "center", height: 22 }}><HealthMeter status={p.status} /></b></div>
                  </div>
                  <Link className="btn iris" href={`/protocols/${p.id}`}>View health</Link>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="s wrap">
        <div className="l-head"><div><h2>Protocol health</h2><p>Every Kaspa DeFi protocol with mapped contracts.</p></div></div>
        <ProtocolList />
      </section>

      <section className="sky band">
        <Clouds set={BAND_CLOUDS} />
        <div className="wrap">
          <div className="s-head">
            <h2 style={{ color: "#fff" }}>The Kaspa DeFi economy<br />in numbers</h2>
            <p style={{ color: "rgba(255,255,255,.78)" }}>Figures come from on-chain reads at the latest block. Click any card to see the calculation.</p>
          </div>
          <div className="panel">
            <ProvRow id="eco-tvl" className="card big-tvl">
              <div>
                <div className="lab">Total value locked in Kaspa DeFi <Pill t={ECO.d24 < 0 ? "crit" : "good"}>{(ECO.d24 * 100).toFixed(1)}% 24h</Pill></div>
                <div className="n">{usdFull(ECO.tvl)}<small>{cents}</small></div>
              </div>
              <BigSpark values={ECO.series.slice(-60)} />
            </ProvRow>
            <div className="grid gA">
              <div className="grid" style={{ gap: 16 }}>
                <ProvRow id="eco-lend" className="card tight mini">
                  <div className="lab"><span>Lending liquidity</span><span>Utilization <b style={{ color: "#fff" }}>{pct(k.util!)}</b></span></div>
                  <div className="n">{usd(k.tvl)}</div><div className="ctx"><Change v={k.d24} /> 24h</div>
                </ProvRow>
                <ProvRow id="eco-dex" className="card tight mini">
                  <div className="lab"><span>DEX liquidity</span><span>24h volume <b style={{ color: "#fff" }}>{usd(ECO.dexVol)}</b></span></div>
                  <div className="n">{usd(ECO.dexLiq)}</div><div className="ctx"><Change v={ECO.dexLiq / ECO.dexPrev - 1} /> 24h</div>
                </ProvRow>
                <ProvRow id="eco-stable" className="card tight mini">
                  <div className="lab"><span>Stablecoin liquidity</span><span>USDC + USDT</span></div>
                  <div className="n">{usd(ECO.stable)}</div><div className="ctx"><Change v={ECO.stable7} /> 7d</div>
                </ProvRow>
              </div>
              <div className="card">
                <div className="c-head"><h3>Where the value sits</h3><span className="tag">by asset</span></div>
                <Donut items={ecoComposition()} />
              </div>
            </div>
            <div className="grid gA">
              <div className="card"><RangeChart title="Value locked by protocol" label="Kaspa DeFi TVL by protocol" series={ecoStack()} dates={DATES} stacked zero legend height={260} /></div>
              <div className="card">
                <div className="c-head"><h3>Why TVL moved today</h3><span className="tag">24h</span></div>
                <div className="wf">
                  <div className="wf-row"><span>Yesterday</span><span className="lane"><i style={{ left: 0, width: `${sc(start)}%`, background: "rgba(255,255,255,.28)" }} /></span><b>{usd(start)}</b></div>
                  <div className="wf-row"><span>KAS −8.9%</span><span className="lane"><i style={{ left: `${sc(afterPrice)}%`, width: `${sc(-ECO.price)}%`, background: C.s4 }} /></span><b className="down">{usd(ECO.price, 0)}</b></div>
                  <div className="wf-row"><span>Net outflows</span><span className="lane"><i style={{ left: `${sc(endV)}%`, width: `${sc(-ECO.flows)}%`, background: C.s4, opacity: 0.6 }} /></span><b className="down">{usd(ECO.flows, 0)}</b></div>
                  <div className="wf-row"><span>Now</span><span className="lane"><i style={{ left: 0, width: `${sc(endV)}%`, background: "var(--sunrise)" }} /></span><b>{usd(endV)}</b></div>
                </div>
                <p className="note" style={{ margin: "20px 0 0" }}>
                  {Math.round((ECO.price / (ECO.tvl - ECO.prev24)) * 100)}% of the drop is the KAS price. Users withdrew {usd(-ECO.flows, 0)} net, mostly iKAS from Kaskad and iKAS/USDC liquidity from Zealous.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="s wrap">
        <div className="grid gA">
          <div className="card">
            <div className="c-head"><h3>What changed · last 48h</h3><Link className="btn ghost sm" href="/watchlist"><Bell />Get alerts</Link></div>
            <Feed list={EVENTS} />
          </div>
          <div className="card report">
            <span className="eyebrow">Dawn report</span>
            <h3 style={{ fontSize: 26, marginTop: 10 }}>Today in Kaspa DeFi</h3>
            <pre id="rep">{dawnReport()}</pre>
            <CopyReport text={dawnReport()} />
            <p style={{ fontSize: 13, color: "rgba(255,255,255,.75)", margin: "14px 0 0" }}>Written from today&apos;s events. Goes out every morning at 07:00 Athens.</p>
          </div>
        </div>
      </section>

      <section className="s wrap">
        <div className="s-head"><h2>From daylight to capital</h2><p>Information first. Capital products come once people trust the data.</p></div>
        <div className="road">
          <div className="now"><span className="n">1 · LIVE</span><b>Intelligence</b><p>Protocol health, flows, and the source of every number.</p></div>
          <div className="now"><span className="n">2 · LIVE</span><b>Watch &amp; alerts</b><p>Your thresholds on liquidity, utilization, outflows and upgrades.</p></div>
          <div><span className="n">3 · NEXT</span><b>Opportunities</b><p>Yield shown next to the health of whoever pays it.</p></div>
          <div><span className="n">4</span><b>Allocation</b><p>A portfolio built from your risk and exit policy.</p></div>
          <div><span className="n">5</span><b>Vaults</b><p>Managed, policy-bound strategies. Non-custodial.</p></div>
        </div>
      </section>
    </>
  );
}
