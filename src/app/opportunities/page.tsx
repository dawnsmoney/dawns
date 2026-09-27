import type { Metadata } from "next";
import Link from "next/link";
import { Banner } from "@/components/Banner";
import { AssetCoin, HealthMeter, Pill } from "@/components/bits";
import { DataBridge } from "@/components/providers";
import { getSnapshot } from "@/lib/snapshot";
import { toLite } from "@/lib/view";
import { usd, pct } from "@/lib/format";

export const metadata: Metadata = { title: "Opportunities" };
export const revalidate = 120;

type Row = { name: string; pid: string; pname: string; asset: string; yieldPct: number | null; yieldNote: string; exit: string; status: Parameters<typeof HealthMeter>[0]["status"]; statusText: string; warn: string };

export default async function OpportunitiesPage() {
  const s = await getSnapshot();
  const rows: Row[] = [];
  for (const p of s.protocols) {
    if (p.lending)
      for (const m of p.lending.markets) {
        const exitShare = m.supplied ? Math.max(0, m.cash / m.supplied) : 0;
        rows.push({
          name: `${m.symbol} supply`, pid: p.id, pname: p.name, asset: m.symbol, yieldPct: m.supplyApy, yieldNote: "paid by borrowers",
          exit: `${usd(m.cashUsd)} now (${pct(exitShare, 0)})`, status: m.utilization >= 0.95 ? "crit" : m.frozen || m.utilization >= 0.8 ? "warn" : "good",
          statusText: m.utilization >= 0.95 ? "Exit blocked" : m.frozen ? "Frozen" : m.utilization >= 0.8 ? "Tight" : "Open",
          warn: m.utilization >= 0.95 ? "Rate is high because suppliers can't leave" : m.frozen ? "No new deposits accepted" : m.oracleDeviation != null && Math.abs(m.oracleDeviation) >= 0.02 ? "Oracle differs from market" : "—",
        });
      }
    if (p.dex && p.dex.fees24 != null && p.tvl > 0)
      rows.push({ name: "Liquidity provision (all pools)", pid: p.id, pname: p.name, asset: "KAS", yieldPct: (p.dex.fees24 * 365) / p.tvl, yieldNote: "trading fees, 24h annualised", exit: "Any time", status: p.status, statusText: p.statusText, warn: "Price exposure to both tokens" });
  }
  rows.sort((a, b) => (b.yieldPct ?? 0) - (a.yieldPct ?? 0));
  return (
    <>
      <DataBridge prov={s.prov} protocols={s.protocols.map(toLite)} signals={s.signals} />
      <Banner short crumb={[{ label: "Preview" }]} title="Opportunities"
        lede="Every yield next to what it costs to get out. Native yield only: token incentives are shown on each protocol, never added in." />
      <div className="wrap" style={{ paddingTop: 40 }}>
        <div className="card flush"><div className="tbl-wrap"><table>
          <thead><tr><th>Opportunity</th><th>Native yield</th><th>Source</th><th>Exit liquidity</th><th>Exit</th><th>Watch out for</th></tr></thead>
          <tbody>
            {rows.map((o) => (
              <tr key={o.pid + o.name}>
                <td><Link href={`/protocols/${o.pid}`} className="proto" style={{ textDecoration: "none" }}><AssetCoin a={o.asset} size={36} /><span><b>{o.name}</b><small>{o.pname}</small></span></Link></td>
                <td><b style={{ font: "600 17px var(--display)" }}>{o.yieldPct != null ? pct(o.yieldPct, 2) : "—"}</b></td>
                <td className="muted">{o.yieldNote}</td>
                <td>{o.exit}</td>
                <td><Pill t={o.status}>{o.statusText}</Pill></td>
                <td className="muted">{o.warn}</td>
              </tr>
            ))}
          </tbody>
        </table></div></div>
        <div className="preview" style={{ marginTop: 18 }}>
          <span>A high rate next to a blocked exit is a warning, not an opportunity. Next: dawns builds an allocation from your risk level and exit window.</span>
          <button className="btn iris" type="button" disabled>Build an allocation</button>
        </div>
      </div>
    </>
  );
}
