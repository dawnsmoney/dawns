const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Compact USD: $1.47M, $855.9K, $385. Negative values use a true minus sign. */
export function usd(v: number, dp?: number): string {
  const a = Math.abs(v);
  const s = v < 0 ? "−" : "";
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(dp ?? 2)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(dp ?? 2)}M`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(dp ?? 1)}K`;
  return `${s}$${a.toFixed(0)}`;
}

export const usdFull = (v: number) => "$" + Math.round(v).toLocaleString("en-US");

export const pct = (v: number, dp = 1) => (v * 100).toFixed(dp) + "%";

export const shortDate = (t: number) => {
  const d = new Date(t);
  return `${MON[d.getUTCMonth()]} ${d.getUTCDate()}`;
};

export function axisUsd(v: number) {
  return usd(v, v >= 1e6 ? 1 : 0);
}

export type ValueFormat = "usd" | "usdFull" | "pct" | "num" | "price";
/** Plain quantities (supply, holders): 697M, 12.4K. */
export const num = (v: number) => (Math.abs(v) >= 1e9 ? `${(v / 1e9).toFixed(2)}B` : Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(Math.abs(v) >= 1e8 ? 0 : 1)}M` : Math.abs(v) >= 1e3 ? `${(v / 1e3).toFixed(1)}K` : v.toFixed(0));

export function formatValue(v: number, f: ValueFormat) {
  if (f === "num") return num(v);
  if (f === "pct") return pct(v);
  if (f === "usdFull") return usdFull(v);
  if (f === "price") return price(v);
  return usd(v);
}

/** `step` is the gap between ticks: a price axis shows as many decimals as it takes to tell ticks apart. */
export function formatAxis(v: number, f: ValueFormat, step?: number) {
  if (f === "price") {
    if (v === 0) return "$0";
    const d = step && step > 0 ? Math.min(10, Math.max(0, -Math.floor(Math.log10(step)) + (step / Math.pow(10, Math.floor(Math.log10(step))) % 1 ? 1 : 0))) : 2;
    return Math.abs(v) >= 1000 && d === 0 ? axisUsd(v) : "$" + v.toFixed(d);
  }
  if (f === "num") return num(v);
  if (f === "pct") return Math.round(v * 100) + "%";
  return axisUsd(v);
}

export function niceTicks(min: number, max: number, n: number): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) { min = 0; max = 1; }
  // a flat series (or float noise around one value) gets a visible range instead of a zero-width one
  const flat = max - min <= Math.max(Math.abs(max), Math.abs(min)) * 1e-6;
  if (flat) { const pad = Math.abs(max) * 0.05 || 1; min -= pad; max += pad; }
  const span = max - min || 1;
  const step0 = span / n;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) ?? step0;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const t: number[] = [];
  for (let v = lo, i = 0; v <= hi + step * 1e-6 && i < 50; v += step, i++) t.push(+v.toFixed(10));
  return t;
}

/** Prices span $70,000 to $0.00000001: keep 3 significant digits whatever the size. */
export function price(v: number | null) {
  if (v == null) return "—";
  if (v >= 1000) return "$" + Math.round(v).toLocaleString("en-US");
  if (v >= 1) return "$" + v.toFixed(2);
  if (v === 0) return "$0";
  const d = Math.min(12, Math.max(2, 2 - Math.floor(Math.log10(v))));
  return "$" + v.toFixed(d);
}
