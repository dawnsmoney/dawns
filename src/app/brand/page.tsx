import type { Metadata } from "next";
import { Banner } from "@/components/Banner";
import { Logo } from "@/components/Logo";

export const metadata: Metadata = { title: "Brand" };

const SWATCHES: [string, string, string][] = [
  ["Pre-dawn", "#100B2B", "App background"], ["Dusk card", "#1C1642", "Surfaces"], ["Iris", "#5B4BF0", "Primary actions"], ["Sky", "#4B34D6", "Hero sky"],
  ["Horizon rose", "#F08DA8", "Sky horizon"], ["Sunrise", "#FF8A5B → #FFD36A", "Call to action, logo"], ["Daylight", "#4ADE9B", "Healthy"], ["Amber", "#FFC061", "Watch"],
];

export default function BrandPage() {
  return (
    <>
      <Banner short crumb={[{ label: "Brand" }]} title="The dawns mark"
        lede="A sun half-risen over the horizon, standing next to its own stem so it reads as a lowercase d. The slats cut into the lower half are the first light breaking the horizon line." />
      <div className="wrap" style={{ paddingTop: 40, display: "grid", gap: 18 }}>
        <div className="brandbox" style={{ background: "#100B2B" }}><Logo id="b1" height={64} className="" /></div>
        <div className="grid g2">
          <div className="brandbox" style={{ background: "var(--sky)" }}><Logo id="b2" height={52} /></div>
          <div className="brandbox" style={{ background: "#F6F3FF" }}><Logo id="b3" height={52} variant="light" /></div>
        </div>
        <div className="grid g3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <div className="brandbox" style={{ background: "#100B2B" }}><img src="/brand/dawns-app-icon.svg" alt="dawns app icon" width={180} height={180} /></div>
          <div className="brandbox" style={{ background: "#1C1642" }}><Logo id="b5" markOnly height={120} /></div>
          <div className="card" style={{ display: "grid", gap: 10, alignContent: "center" }}>
            <span className="muted" style={{ fontSize: 13 }}>Display · Outfit</span>
            <span style={{ font: "600 40px/1 var(--display)", letterSpacing: "-.03em" }}>Plain daylight</span>
            <span className="muted" style={{ fontSize: 13, marginTop: 8 }}>Body · DM Sans</span>
            <span>Every number traces back to a contract and a block.</span>
          </div>
        </div>
        <div className="sw-row">
          {SWATCHES.map(([n, hex, use]) => (
            <div className="swatch" key={n}>
              <i style={{ background: hex.includes("→") ? "var(--sunrise)" : hex }} />
              <div><b>{n}</b><span className="mono muted" style={{ fontSize: 12 }}>{hex}</span><br /><span className="muted">{use}</span></div>
            </div>
          ))}
        </div>
        <p className="foot">Logo files: <a href="/brand/dawns-logo-on-dark.svg">on dark</a> · <a href="/brand/dawns-logo-on-light.svg">on light</a> · <a href="/brand/dawns-mark.svg">mark</a> · <a href="/brand/dawns-app-icon.svg">app icon</a></p>
      </div>
    </>
  );
}
