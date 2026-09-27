import "server-only";

/** DefiLlama public API: ecosystem coverage, history and market prices. */
const API = "https://api.llama.fi";
const COINS = "https://coins.llama.fi";
const REVALIDATE = 300;

async function get<T>(url: string): Promise<T> {
  const r = await fetch(url, { next: { revalidate: REVALIDATE }, signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return r.json() as Promise<T>;
}

export const KASPA_CHAINS = ["Igra", "Kasplex"] as const;

export interface LlamaListItem {
  name: string; slug: string; category: string; chains: string[]; tvl: number; url?: string;
  chainTvls?: Record<string, number>; change_1d?: number | null; change_7d?: number | null; parentProtocol?: string;
}
export async function kaspaProtocols(): Promise<LlamaListItem[]> {
  const all = await get<LlamaListItem[]>(`${API}/protocols`);
  return all.filter((p) => p.category !== "CEX" && p.chains?.some((c) => (KASPA_CHAINS as readonly string[]).includes(c)));
}

type Pt = { date: number; totalLiquidityUSD: number };
type TokPt = { date: number; tokens: Record<string, number> };
export interface LlamaProtocol {
  name: string; description?: string; url?: string; audit_links?: string[]; twitter?: string;
  tvl: Pt[];
  chainTvls: Record<string, { tvl: Pt[]; tokens?: TokPt[]; tokensInUsd?: TokPt[] }>;
  currentChainTvls: Record<string, number>;
}
export const llamaProtocol = (slug: string) => get<LlamaProtocol>(`${API}/protocol/${slug}`);

export async function llamaPrices(ids: string[]) {
  const j = await get<{ coins: Record<string, { price: number; symbol: string; timestamp: number }> }>(`${COINS}/prices/current/${ids.join(",")}`);
  return j.coins;
}
export async function llamaChange24h(id: string): Promise<number | null> {
  try {
    const j = await get<{ coins: Record<string, number> }>(`${COINS}/percentage/${id}?period=24h`);
    return (j.coins[id] ?? null) === null ? null : j.coins[id] / 100;
  } catch { return null; }
}
export async function dexSummary(slug: string) {
  try {
    const j = await get<{ total24h?: number; total7d?: number; change_1d?: number }>(`${API}/summary/dexs/${slug}?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true`);
    return { vol24: j.total24h ?? null, vol7: j.total7d ?? null };
  } catch { return { vol24: null, vol7: null }; }
}
export async function feesSummary(slug: string) {
  try {
    const j = await get<{ total24h?: number }>(`${API}/summary/fees/${slug}?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true`);
    return j.total24h ?? null;
  } catch { return null; }
}
