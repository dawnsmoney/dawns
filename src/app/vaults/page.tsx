import type { Metadata } from "next";
import { Banner } from "@/components/Banner";
import { AssetCoin } from "@/components/bits";
import { VAULTS } from "@/lib/data";
import { pct } from "@/lib/format";

export const metadata: Metadata = { title: "Vaults" };

export default function VaultsPage() {
  return (
    <>
      <Banner short crumb={[{ label: "Phase 5 · concept" }]} title="Vaults"
        lede="An allocation dawns keeps managing after you deposit. Each vault runs under a written policy: caps, a reserve floor, a rebalance band and an exit target." />
      <div className="wrap" style={{ paddingTop: 40 }}>
        <div className="grid g3">
          {VAULTS.map((v) => (
            <div className="card vault" key={v.n}>
              <div className="c-head" style={{ margin: 0 }}><AssetCoin a={v.k} size={56} /><span className="tag">{v.risk}</span></div>
              <h3 style={{ fontSize: 24 }}>dawns {v.n}</h3>
              <div><div className="big">{pct(v.y)}</div><span className="muted" style={{ fontSize: 13 }}>native yield today, before fees · illustrative</span></div>
              <div className="stack">{v.alloc.map(([n, w, c]) => (<i key={n} style={{ width: `${w}%`, background: c }} />))}</div>
              <div className="legend" style={{ flexDirection: "column", gap: 8 }}>
                {v.alloc.map(([n, w, c]) => (
                  <span key={n} style={{ justifyContent: "space-between" }}><span style={{ display: "flex", gap: 8, alignItems: "center" }}><i style={{ background: c }} />{n}</span><b style={{ color: "#fff" }}>{w}%</b></span>
                ))}
              </div>
              <dl>
                <div><dt>Exit target</dt><dd>{v.exit}</dd></div>
                <div><dt>Max single strategy</dt><dd>{v.max}</dd></div>
                <div><dt>Min reserve</dt><dd>{v.alloc[v.alloc.length - 1][1]}%</dd></div>
                <div><dt>Rebalance band</dt><dd>±{v.band}</dd></div>
              </dl>
              <button className="btn iris" type="button" disabled>Deposit</button>
            </div>
          ))}
        </div>
        <p className="note" style={{ marginTop: 18 }}>Kaspa DeFi has two protocols with real depth today, so single-strategy caps are higher than they will be once more venues exist. Vaults ship after the data layer has earned trust.</p>
      </div>
    </>
  );
}
