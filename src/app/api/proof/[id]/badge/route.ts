import { getSnapshot } from "@/lib/snapshot";
import { proofOf, proofHeadline } from "@/lib/proof";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
// rough widths for the badge's system font, so the pill fits its text
const w = (s: string, px: number, bold = false) => Math.ceil(s.length * px * (bold ? 0.6 : 0.55));

/**
 * The live proof badge a protocol embeds on its own site: its headline figure, read by
 * dawns at the last snapshot, linking back to the proof page. An SVG, cached briefly.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const light = new URL(req.url).searchParams.get("theme") === "light";
  const s = await getSnapshot().catch(() => null);
  const p = s ? proofOf(s, id) : null;
  const hl = p ? proofHeadline(p) : null;
  const tone = !p ? "#8A83A8" : p.status === "good" ? "#4ADE9B" : p.status === "warn" ? "#F5B83D" : "#FF6B6B";
  const top = "PROOF OF RESERVES · DAWNS";
  const main = p && hl ? `${p.name} · ${hl.label} ${hl.value}` : "Proof not available";
  const W = Math.max(w(top, 9.5), w(main, 14, true)) + 78;
  const bg = light ? "#FFFFFF" : "#16102E", ink = light ? "#1B1035" : "#FFFFFF", sub = light ? "#6E6788" : "#A69FD0", line = light ? "#E4E0F5" : "#3A3066";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="44" viewBox="0 0 ${W} 44" role="img" aria-label="${esc(main)}, read on-chain by dawns">
<title>${esc(main)}, read on-chain by dawns</title>
<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFD27A"/><stop offset=".55" stop-color="#FF9A62"/><stop offset="1" stop-color="#F0679A"/></linearGradient><clipPath id="c"><rect x="14" y="10" width="26" height="15"/></clipPath></defs>
<rect x=".5" y=".5" width="${W - 1}" height="43" rx="12" fill="${bg}" stroke="${line}"/>
<circle cx="27" cy="25" r="12" fill="url(#s)" clip-path="url(#c)"/>
<rect x="14" y="27.5" width="26" height="2" rx="1" fill="#FF9A62"/><rect x="17" y="31.5" width="20" height="2" rx="1" fill="#F0679A" opacity=".8"/>
<text x="52" y="17" font-family="Helvetica,Arial,sans-serif" font-size="9.5" letter-spacing=".8" fill="${sub}">${top}</text>
<text x="52" y="33" font-family="Helvetica,Arial,sans-serif" font-size="14" font-weight="700" fill="${ink}">${esc(main)}</text>
<circle cx="${W - 16}" cy="22" r="4" fill="${tone}"/>
</svg>`;
  return new Response(svg, { headers: { "content-type": "image/svg+xml; charset=utf-8", "cache-control": "public, max-age=120, s-maxage=120, stale-while-revalidate=600", "access-control-allow-origin": "*" } });
}
