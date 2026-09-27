import type { Metadata } from "next";
import Link from "next/link";
import { Banner } from "@/components/Banner";
import { AssetCoin, HealthMeter } from "@/components/bits";
import { OPPORTUNITIES, P } from "@/lib/data";
import { pct } from "@/lib/format";

export const metadata: Metadata = { title: "Opportunities" };

export default function OpportunitiesPage() {
  return (
    <>
      <Banner short crumb={[{ label: "Phase 3 · preview" }]} title="Opportunities"
        lede="Every yield next to the health of the protocol paying it. Native yield and token incentives stay in separate columns." />
      <div className="wrap" style={{ paddingTop: 40 }}>
        <div className="card flush"><div className="tbl-wrap"><table>
          <thead><tr><th>Opportunity</th><th>Native yield</th><th>Incentive</th><th>30d avg</th><th>Exit liquidity</th><th>Protocol health</th><th>Watch out for</th></tr></thead>
          <tbody>
            {OPPORTUNITIES.map((o) => {
              const p = P[o.p];
              return (
                <tr key={o.name}>
                  <td><Link href={`/protocols/${o.p}`} className="proto" style={{ textDecoration: "none" }}><AssetCoin a={o.asset} size={36} /><span><b>{o.name}</b><small>{p.name}</small></span></Link></td>
                  <td><b style={{ font: "600 17px var(--display)" }}>{pct(o.native)}</b></td>
                  <td><span className="tag">{o.incentive}</span></td>
                  <td>{pct(o.avg30)}</td><td>{o.exit}</td>
                  <td><span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}><HealthMeter status={p.status} />{p.statusText}</span></td>
                  <td className="muted">{o.watch}</td>
                </tr>
              );
            })}
          </tbody>
        </table></div></div>
        <div className="preview" style={{ marginTop: 18 }}>
          <span>Next: pick a risk level and an exit window. dawns builds the allocation and the transactions for your wallet to sign.</span>
          <button className="btn iris" type="button" disabled>Build an allocation</button>
        </div>
      </div>
    </>
  );
}
