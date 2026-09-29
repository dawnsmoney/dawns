import type { Status } from "@/lib/types";
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
  const col = status === "good" ? "#4ADE9B" : status === "warn" ? "#FFC061" : status === "crit" ? "#FF7A7A" : "#AFA5FF";
  return (
    <span className="hm" title={`${n} of 3`} aria-label={`Health ${n} of 3`}>
      {[0, 1, 2].map((i) => (
        <i key={i} style={i < n ? { background: col } : undefined} />
      ))}
    </span>
  );
}

/** Percent change with arrow. unit "pp" renders percentage points. Null renders a dash. */
export function Change({ v, unit }: { v: number | null; unit?: "pp" }) {
  if (v == null || !isFinite(v)) return <span className="flat">—</span>;
  const cls = v > 0.0005 ? "up" : v < -0.0005 ? "down" : "flat";
  const arrow = v > 0.0005 ? "↑" : v < -0.0005 ? "↓" : "→";
  const txt = Math.abs(v * 100).toFixed(1) + (unit === "pp" ? "pp" : "%");
  return <span className={cls}>{arrow} {txt}</span>;
}

export function UtilMeter({ v }: { v: number }) {
  const col = v >= 0.95 ? "#FF7A7A" : v >= 0.8 ? "#FFC061" : "#7B6CFF";
  return (
    <span className="meter">
      <span className="trk"><i style={{ width: `${Math.min(100, v * 100)}%`, background: col }} /></span>
      <span>{pct(v)}</span>
    </span>
  );
}

/* ---------- glossy coins ---------- */
export const COIN: Record<string, [string, string]> = {
  kaskad: ["#FFD36A", "#FF7B4F"], zealousswap: ["#8BF5CF", "#179C75"], "kaspacom-dex": ["#CBBEFF", "#5E4BE6"], kasdex: ["#FFB6C9", "#DC4F79"],
  "igra-attestation": ["#A8E0FF", "#3F7FD8"], "krokoswap-v3": ["#C9F28B", "#5E9E2A"], "krokoswap-v2": ["#C9F28B", "#5E9E2A"], "kaspacom-lfg": ["#CBBEFF", "#5E4BE6"],
  KAS: ["#7CF0D2", "#138C72"], USDC: ["#8FC6FF", "#2C68DC"], USDT: ["#9CF2BE", "#1B9466"], WETH: ["#C9C3F5", "#5E5AA8"], ETH: ["#C9C3F5", "#5E5AA8"],
  BTC: ["#FFD08A", "#E08A1E"], ZEAL: ["#FFD36A", "#E07A34"], KSKD: ["#FFB6C9", "#D24C77"], NACHO: ["#FFC9A3", "#D9733A"], IGRA: ["#A8E0FF", "#3F7FD8"],
};
const FALLBACK: [string, string][] = [["#B9B3D6", "#6E6788"], ["#A8E0FF", "#3F7FD8"], ["#FFC9A3", "#D9733A"], ["#C9F28B", "#5E9E2A"], ["#F5B3E8", "#A8479A"]];
const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
export const coinColors = (k: string) => COIN[k] ?? COIN[k.toUpperCase()] ?? FALLBACK[hash(k) % FALLBACK.length];
export const GLYPH: Record<string, string> = { KAS: "K", USDC: "$", USDT: "₮", WETH: "Ξ", ETH: "Ξ", BTC: "₿" };
export const symbolKey = (s: string) => (/^(w?i?kas|wikas|ikas|wkas)$/i.test(s) ? "KAS" : /^(cbbtc|wbtc)$/i.test(s) ? "BTC" : s.toUpperCase());

export function Coin({ size, k, glyph }: { size: number; k: string; glyph: string }) {
  const c = coinColors(k);
  const id = `coin-${k.replace(/[^A-Za-z0-9-]/g, "")}`;
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
      <text x="32" y={32 + fs * 0.36} textAnchor="middle" fontFamily="var(--display)" fontWeight="700" fontSize={fs} fill="#fff">{glyph}</text>
    </svg>
  );
}
/**
 * Real logos: /api/logo serves the token's or protocol's own icon (Blockscout, KaspaCom,
 * DefiLlama, CoinGecko for the majors), cached, and falls back to dawns' drawn coin, so
 * an <img> is always safe to render.
 */
export const ProtocolCoin = ({ p, size }: { p: { id: string; letter: string }; size: number }) => (
  // eslint-disable-next-line @next/next/no-img-element -- small cached logos from our own route
  <img className="coin logo" src={`/api/logo/protocol/${encodeURIComponent(p.id)}?l=${encodeURIComponent(p.letter)}`} width={size} height={size} alt="" loading="lazy" decoding="async" />
);
export function AssetCoin({ a, size }: { a: string; size: number }) {
  const k = symbolKey(a);
  // eslint-disable-next-line @next/next/no-img-element -- small cached logos from our own route
  return <img className="coin logo" src={`/api/logo/token/${encodeURIComponent(k)}`} width={size} height={size} alt="" loading="lazy" decoding="async" />;
}

export function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return <span className="muted">—</span>;
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

/* Categorical palette validated for the dark surface (see prototype dataviz check). */
export const SERIES = ["#D17A30", "#2FA88F", "#8578E6", "#D55A7C", "#4F8EE0", "#6E6788"];
export const assetColor = (sym: string) => ({ KAS: "#2FA88F", USDC: "#4F8EE0", USDT: "#8578E6", ZEAL: "#D17A30", KSKD: "#D55A7C" } as Record<string, string>)[symbolKey(sym)] ?? "#6E6788";
