import type { Metadata } from "next";
import { Banner } from "@/components/Banner";

export const metadata: Metadata = { title: "Vaults" };

const VAULTS = [
  { n: "Stable Reserve", risk: "Conservative", rules: [["Assets", "USDC, USDT"], ["Max single strategy", "50%"], ["Min reserve", "25% idle"], ["Exit target", "Same day"], ["Enters a market only if", "utilization < 80%, not frozen, oracle within 1%"]] },
  { n: "Stable Balanced", risk: "Balanced", rules: [["Assets", "USDC, USDT, KAS/USD LP"], ["Max single strategy", "40%"], ["Min reserve", "15% idle"], ["Exit target", "< 24h"], ["Enters a market only if", "utilization < 85%, admin is a multisig"]] },
  { n: "KAS Yield", risk: "Growth", rules: [["Assets", "KAS, KAS LPs"], ["Max single strategy", "60%"], ["Min reserve", "10% idle"], ["Exit target", "< 24h"], ["Enters a market only if", "not frozen, $10K trade moves price < 3%"]] },
];

export default function VaultsPage() {
  return (
    <>
      <Banner short crumb={[{ label: "Concept" }]} title="Vaults"
        lede="An allocation dawns keeps managing after you deposit. Each vault runs under a written policy, and the same health signals you see on dawns decide where it may go." />
      <div className="wrap" style={{ paddingTop: 40 }}>
        <div className="grid g3">
          {VAULTS.map((v) => (
            <div className="card vault" key={v.n}>
              <div className="c-head" style={{ margin: 0 }}><h3 style={{ fontSize: 24 }}>dawns {v.n}</h3><span className="tag">{v.risk}</span></div>
              <dl style={{ gridTemplateColumns: "1fr" }}>{v.rules.map(([k, x]) => (<div key={k}><dt>{k}</dt><dd>{x}</dd></div>))}</dl>
              <button className="btn iris" type="button" disabled>Deposit</button>
            </div>
          ))}
        </div>
        <p className="note" style={{ marginTop: 18 }}>No yields are shown on purpose. Vaults ship after the data layer has earned trust, and their rates will be whatever the underlying markets pay at the time.</p>
      </div>
    </>
  );
}
