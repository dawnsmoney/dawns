import type { Status, AssetSym, Protocol } from "@/lib/data";
import { pct } from "@/lib/format";
import { Alert, Check, Info } from "./icons";

const PILL_ICON = { good: Check, warn: Alert, crit: Alert, info: Info };

export function Pill({ t, children }: { t: Status; children: React.ReactNode }) {
  const Icon = PILL_ICON[t];
  return (
    <span className={`pill ${t}`}>
      <Icon />
      {children}
    </span>
  );
}

export function HealthMeter({ status }: { status: Status }) {
  const n = status === "good" ? 3 : status === "warn" ? 2 : 1;
  const col = status === "good" ? "#4ADE9B" : status === "warn" ? "#FFC061" : "#AFA5FF";
  return (
    <span className="hm" title={`${n} of 3`} aria-label={`Health ${n} of 3`}>
      {[0, 1, 2].map((i) => (
        <i key={i} style={i < n ? { background: col } : undefined} />
      ))}
    </span>
  );
}

/** Percent change with arrow. unit "pp" renders percentage points. */
export function Change({ v, unit }: { v: number; unit?: "pp" }) {
  const cls = v > 0.0005 ? "up" : v < -0.0005 ? "down" : "flat";
  const arrow = v > 0.0005 ? "↑" : v < -0.0005 ? "↓" : "→";
  const txt = Math.abs(v * 100).toFixed(1) + (unit === "pp" ? "pp" : "%");
  return <span className={cls}>{arrow} {txt}</span>;
}

export function UtilMeter({ v }: { v: number }) {
  const col = v >= 0.8 ? "#FF7A7A" : v >= 0.7 ? "#FFC061" : "#7B6CFF";
  return (
    <span className="meter">
      <span className="trk"><i style={{ width: `${Math.min(100, v * 100)}%`, background: col }} /></span>
      <span>{pct(v)}</span>
    </span>
  );
}

/* ---------- glossy coins ---------- */
export const COIN: Record<string, [string, string]> = {
  kaskad: ["#FFD36A", "#FF7B4F"], zealous: ["#8BF5CF", "#179C75"], kaspacom: ["#CBBEFF", "#5E4BE6"], kasdex: ["#FFB6C9", "#DC4F79"],
  iKAS: ["#7CF0D2", "#138C72"], USDC: ["#8FC6FF", "#2C68DC"], USDT: ["#9CF2BE", "#1B9466"], ZEAL: ["#FFD36A", "#E07A34"],
  KSKD: ["#FFB6C9", "#D24C77"], Other: ["#B9B3D6", "#6E6788"], NACHO: ["#B9B3D6", "#6E6788"],
};
const GLYPH: Record<string, string> = { iKAS: "K", USDC: "$", USDT: "₮", ZEAL: "Z", KSKD: "K", Other: "•", NACHO: "N" };

export function Coin({ size, k, glyph }: { size: number; k: string; glyph: string }) {
  const c = COIN[k] ?? COIN.Other;
  const id = `coin-${k}`;
  const fs = glyph.length > 1 ? 19 : 26;
  return (
    <svg className="coin" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1=".15" y1="0" x2=".85" y2="1">
          <stop offset="0" stopColor={c[0]} />
          <stop offset="1" stopColor={c[1]} />
        </linearGradient>
      </defs>
      <circle cx="32" cy="32" r="31" fill={`url(#${id})`} />
      <circle cx="32" cy="32" r="30" fill="none" stroke="rgba(255,255,255,.45)" strokeWidth="1.5" />
      <circle cx="32" cy="32" r="23.5" fill="none" stroke="rgba(255,255,255,.3)" strokeWidth="1.5" />
      <ellipse cx="23" cy="17" rx="15" ry="7.5" fill="#fff" opacity=".22" transform="rotate(-28 23 17)" />
      <text x="32" y={32 + fs * 0.36} textAnchor="middle" fontFamily="var(--display)" fontWeight="700" fontSize={fs} fill="#fff">
        {glyph}
      </text>
    </svg>
  );
}
export const ProtocolCoin = ({ p, size }: { p: Protocol; size: number }) => <Coin size={size} k={p.id} glyph={p.letter} />;
export const AssetCoin = ({ a, size }: { a: AssetSym; size: number }) => <Coin size={size} k={a} glyph={GLYPH[a] ?? a[0]} />;

export function Sparkline({ values }: { values: number[] }) {
  const W = 96, H = 28, n = values.length;
  const mn = Math.min(...values), mx = Math.max(...values);
  const x = (i: number) => 2 + (i * (W - 6)) / (n - 1);
  const y = (v: number) => 3 + (H - 6) - ((v - mn) / (mx - mn || 1)) * (H - 6);
  const c = values[n - 1] >= values[0] ? "#4ADE9B" : "#FF7A7A";
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true">
      <path d={"M" + values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("L")} fill="none" stroke="#CFC8F0" strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx={x(n - 1)} cy={y(values[n - 1])} r="3" fill={c} />
    </svg>
  );
}

type Cloud = [string, string, string, string, string, string, string];
const DEFAULT_CLOUDS: Cloud[] = [
  ["-12%", "auto", "18%", "auto", "55%", "170px", "rgba(255,160,200,.42)"],
  ["auto", "-10%", "24%", "auto", "48%", "150px", "rgba(255,205,160,.38)"],
  ["28%", "auto", "auto", "30%", "34%", "110px", "rgba(170,150,255,.28)"],
  ["60%", "auto", "auto", "14%", "26%", "90px", "rgba(210,190,255,.2)"],
];
export function Clouds({ set = DEFAULT_CLOUDS }: { set?: Cloud[] }) {
  return (
    <>
      {set.map((c, i) => (
        <div key={i} className="cloud" style={{ left: c[0], right: c[1], bottom: c[2], top: c[3], width: c[4], height: c[5], background: c[6] }} />
      ))}
    </>
  );
}
export const BANNER_CLOUDS: Cloud[] = [
  ["-10%", "auto", "-30%", "auto", "50%", "160px", "rgba(255,160,200,.42)"],
  ["auto", "-10%", "-20%", "auto", "45%", "140px", "rgba(255,205,160,.38)"],
  ["35%", "auto", "auto", "20%", "30%", "90px", "rgba(170,150,255,.25)"],
];
export const BAND_CLOUDS: Cloud[] = [
  ["-15%", "auto", "8%", "auto", "60%", "200px", "rgba(255,160,200,.4)"],
  ["auto", "-12%", "14%", "auto", "50%", "170px", "rgba(255,205,160,.35)"],
  ["20%", "auto", "auto", "6%", "40%", "120px", "rgba(170,150,255,.3)"],
];
