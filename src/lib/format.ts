const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Compact USD: $1.47M, $855.9K, $385. Negative values use a true minus sign. */
export function usd(v: number, dp?: number): string {
  const a = Math.abs(v);
  const s = v < 0 ? "−" : "";
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

export type ValueFormat = "usd" | "usdFull" | "pct";

export function formatValue(v: number, f: ValueFormat) {
  if (f === "pct") return pct(v);
  if (f === "usdFull") return usdFull(v);
  return usd(v);
}

export function formatAxis(v: number, f: ValueFormat) {
  if (f === "pct") return Math.round(v * 100) + "%";
  return axisUsd(v);
}

export function niceTicks(min: number, max: number, n: number): number[] {
  const span = max - min || 1;
  const step0 = span / n;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) ?? step0;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const t: number[] = [];
  for (let v = lo; v <= hi + step * 1e-6; v += step) t.push(+v.toFixed(10));
  return t;
}
