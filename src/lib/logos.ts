import "server-only";
import { getAssets } from "./assets";
import { coinColors, GLYPH, symbolKey } from "@/components/bits";

/** The majors, whose bridged copies on Igra and Kasplex carry no icon of their own. */
const MAJORS: Record<string, string> = {
  KAS: "https://assets.coingecko.com/coins/images/25751/large/kaspa-icon-exchanges.png",
  USDC: "https://assets.coingecko.com/coins/images/6319/large/usdc.png",
  USDT: "https://assets.coingecko.com/coins/images/325/large/Tether.png",
  ETH: "https://assets.coingecko.com/coins/images/279/large/ethereum.png",
  WETH: "https://assets.coingecko.com/coins/images/279/large/ethereum.png",
  BTC: "https://assets.coingecko.com/coins/images/1/large/bitcoin.png",
};

/** A token's logo URL: the majors, else the best-known asset with that ticker that has one. */
export async function tokenLogo(sym: string): Promise<string | null> {
  const k = symbolKey(sym);
  if (MAJORS[k]) return MAJORS[k];
  const all = await getAssets().catch(() => []);
  const same = all.filter((a) => a.logo && symbolKey(a.symbol) === k)
    .sort((a, b) => (b.liquidity ?? 0) - (a.liquidity ?? 0) || (b.holders ?? 0) - (a.holders ?? 0));
  return same[0]?.logo ?? null;
}
export const protocolLogo = (id: string) => `https://icons.llamao.fi/icons/protocols/${encodeURIComponent(id)}?w=96&h=96`;

/** dawns' drawn coin as an SVG document: the fallback when no real logo exists. */
export function coinSvg(k: string, glyph: string) {
  const [a, b] = coinColors(k);
  const fs = glyph.length > 1 ? 19 : 26;
  const esc = glyph.replace(/[<>&"]/g, "");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><defs><linearGradient id="g" x1=".15" y1="0" x2=".85" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><circle cx="32" cy="32" r="31" fill="url(#g)"/><circle cx="32" cy="32" r="30" fill="none" stroke="rgba(255,255,255,.45)" stroke-width="1.5"/><circle cx="32" cy="32" r="23.5" fill="none" stroke="rgba(255,255,255,.3)" stroke-width="1.5"/><ellipse cx="23" cy="17" rx="15" ry="7.5" fill="#fff" opacity=".22" transform="rotate(-28 23 17)"/><text x="32" y="${32 + fs * 0.36}" text-anchor="middle" font-family="Outfit,Avenir Next,Segoe UI,sans-serif" font-weight="700" font-size="${fs}" fill="#fff">${esc}</text></svg>`;
}
export const glyphOf = (k: string) => GLYPH[k] ?? k.slice(0, 1);

const HEADERS = { "Cache-Control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=604800", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox" };

/** Fetch a logo and pass it through (images only, under 600 KB); otherwise the drawn coin. */
export async function serveLogo(url: string | null, k: string, glyph: string): Promise<Response> {
  if (url && /^https:\/\//.test(url)) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(6000), next: { revalidate: 86_400 } });
      const type = r.headers.get("content-type") ?? "";
      if (r.ok && /^image\/(png|jpe?g|webp|gif|svg\+xml|avif)/.test(type)) {
        const buf = await r.arrayBuffer();
        if (buf.byteLength > 0 && buf.byteLength < 600_000) return new Response(buf, { headers: { ...HEADERS, "Content-Type": type } });
      }
    } catch { /* fall through */ }
  }
  return new Response(coinSvg(k, glyph), { headers: { ...HEADERS, "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=3600, s-maxage=86400" } });
}
