import { COIN, ProtocolCoin } from "./bits";
import { P, ECO } from "@/lib/data";
import { usd } from "@/lib/format";
import { Check } from "./icons";

function Coin3D({ cx, cy, r, k, rot, blur, children }: { cx: number; cy: number; r: number; k: string; rot: number; blur?: 1 | 2; children: React.ReactNode }) {
  const c = COIN[k];
  const id = `h3-${k}`;
  return (
    <g transform={`translate(${cx} ${cy}) rotate(${rot})`} filter={blur ? `url(#hblur${blur})` : undefined}>
      <defs>
        <linearGradient id={id} x1=".1" y1="0" x2=".9" y2="1">
          <stop offset="0" stopColor={c[0]} />
          <stop offset=".7" stopColor={c[1]} />
        </linearGradient>
      </defs>
      {[7, 6, 5, 4, 3, 2, 1].map((i) => (
        <circle key={i} cx={i * r * 0.022} cy={i * r * 0.02} r={r} fill={c[1]} filter={i === 7 && !blur ? "url(#hshadow)" : undefined} />
      ))}
      <circle r={r} fill={`url(#${id})`} />
      <circle r={r * 0.97} fill="none" stroke="rgba(255,255,255,.55)" strokeWidth={r * 0.03} />
      <circle r={r * 0.76} fill="none" stroke="rgba(255,255,255,.32)" strokeWidth={r * 0.04} />
      <path d={`M${-r * 0.78},${-r * 0.2} A${r * 0.8},${r * 0.8} 0 0 1 ${r * 0.1},${-r * 0.78}`} fill="none" stroke="#fff" strokeOpacity=".55" strokeWidth={r * 0.07} strokeLinecap="round" />
      <g transform={`scale(${r / 40})`}>{children}</g>
    </g>
  );
}

const Letter = ({ ch, size = 40 }: { ch: string; size?: number }) => (
  <text x="0" y="14" textAnchor="middle" fontFamily="var(--display)" fontWeight="700" fontSize={size} fill="#fff">{ch}</text>
);

const SunGlyph = () => (
  <>
    <path d="M-17,6 A17,17 0 0 1 17,6 Z" fill="#fff" />
    <rect x="-21" y="11" width="42" height="4" rx="2" fill="#fff" />
    <rect x="-13" y="19" width="26" height="4" rx="2" fill="#fff" opacity=".8" />
    <g stroke="#fff" strokeWidth="3.5" strokeLinecap="round">
      <path d="M0,-20v-5" /><path d="M-15,-13l-3.5,-3.5" /><path d="M15,-13l3.5,-3.5" />
    </g>
  </>
);

export function HeroArt() {
  const arch = "M170,470 V180 A110,110 0 0 1 390,180 V470 Z";
  return (
    <div className="art">
      <svg viewBox="0 0 560 520" role="img" aria-label="A glass window onto a sunrise, with floating coins">
        <defs>
          <linearGradient id="hsky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#8E8CFF" /><stop offset=".38" stopColor="#B7A2FF" /><stop offset=".68" stopColor="#F6AAC6" /><stop offset=".86" stopColor="#FFD39C" />
          </linearGradient>
          <linearGradient id="hsea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#8E78F2" /><stop offset="1" stopColor="#4E3BC9" /></linearGradient>
          <radialGradient id="hsun" cx=".5" cy=".45" r=".55"><stop offset="0" stopColor="#FFF6CF" /><stop offset=".45" stopColor="#FFC877" /><stop offset="1" stopColor="#FF8A7A" /></radialGradient>
          <radialGradient id="hglow" cx=".5" cy=".5" r=".5"><stop offset="0" stopColor="#FFC59A" stopOpacity=".55" /><stop offset="1" stopColor="#FFC59A" stopOpacity="0" /></radialGradient>
          <linearGradient id="hsheen" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#fff" stopOpacity=".42" /><stop offset=".5" stopColor="#fff" stopOpacity=".04" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></linearGradient>
          <clipPath id="harch"><path d={arch} /></clipPath>
          <filter id="hblur1" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="1.6" /></filter>
          <filter id="hblur2" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="3.5" /></filter>
          <filter id="hcloud" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="10" /></filter>
          <filter id="hshadow" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="6" dy="14" stdDeviation="12" floodColor="#1A0B5C" floodOpacity=".45" /></filter>
        </defs>
        <circle cx="290" cy="330" r="250" fill="url(#hglow)" />
        <ellipse cx="290" cy="486" rx="170" ry="16" fill="#1B0F5A" opacity=".35" filter="url(#hcloud)" />
        <path d="M192,452 V162 A110,110 0 0 1 412,162 V452 Z" fill="#C4B5FF" fillOpacity=".38" stroke="#fff" strokeOpacity=".55" strokeWidth="2" />
        <path d="M170,470 L192,452 M390,470 L412,452 M390,180 L412,162" stroke="#fff" strokeOpacity=".4" strokeWidth="2" />
        <g clipPath="url(#harch)">
          <rect x="160" y="60" width="240" height="420" fill="url(#hsky)" />
          <ellipse cx="225" cy="250" rx="70" ry="20" fill="#fff" opacity=".55" filter="url(#hcloud)" />
          <ellipse cx="345" cy="305" rx="60" ry="16" fill="#FFE3F0" opacity=".6" filter="url(#hcloud)" />
          <circle cx="280" cy="392" r="74" fill="url(#hsun)" />
          <rect x="160" y="392" width="240" height="90" fill="url(#hsea)" />
          <g fill="#FFD9A0" opacity=".6">
            <rect x="222" y="404" width="116" height="4" rx="2" /><rect x="238" y="418" width="84" height="4" rx="2" />
            <rect x="252" y="432" width="56" height="4" rx="2" /><rect x="264" y="446" width="32" height="3" rx="1.5" />
          </g>
          <path d="M160,60 L330,60 L160,330 Z" fill="url(#hsheen)" />
        </g>
        <path d={arch} fill="none" stroke="#fff" strokeOpacity=".85" strokeWidth="3" />
        <g className="bob3"><Coin3D cx={470} cy={150} r={20} k="kaspacom" rot={10} blur={2}><Letter ch="◆" /></Coin3D></g>
        <g className="bob2"><Coin3D cx={96} cy={196} r={34} k="USDC" rot={-12} blur={1}><Letter ch="$" size={42} /></Coin3D></g>
        <g className="bob"><Coin3D cx={112} cy={410} r={54} k="iKAS" rot={-16}><Letter ch="K" /></Coin3D></g>
        <g className="bob2"><Coin3D cx={452} cy={392} r={66} k="kaskad" rot={12}><SunGlyph /></Coin3D></g>
      </svg>
      <div className="float bob2" style={{ right: "2%", top: "10%" }}>
        <ProtocolCoin p={P.kaskad} size={30} />
        <span>Kaskad<small>100% asset coverage</small></span>
      </div>
      <div className="float bob3" style={{ left: 0, top: "48%" }}>
        <span className="pill good" style={{ padding: "6px 8px" }}><Check /></span>
        <span>{usd(ECO.tvl)} in Kaspa DeFi<small>every number traceable</small></span>
      </div>
    </div>
  );
}
