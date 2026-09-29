import "server-only";
import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Status } from "./types";
import type { CardData } from "./cards";

/* The 1200×630 share card, drawn with next/og (Satori: every box with children is a flex box). */
const W = 1200, H = 630;
const C = { bg: "#100B2B", card: "rgba(28,22,66,0.82)", line: "rgba(140,124,240,0.24)", text: "#F4F1FF", muted: "#A79FD0", horizon: "#8C7CF0", sun: "#FFD27A" };
const TONE: Record<Status, string> = { good: "#4ADE9B", warn: "#FFC061", crit: "#FF7A7A", info: "#A79FD0" };

// the mark: a sun half-risen beside its own stem, over the horizon line (no masks: Satori draws it plainly)
const MARK = `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFD27A"/><stop offset=".55" stop-color="#FF9A62"/><stop offset="1" stop-color="#F0679A"/></linearGradient></defs><path d="M9.5 41a15.5 15.5 0 0 1 31 0Z" fill="url(#s)"/><rect x="37" y="5" width="9.5" height="36" rx="4.75" fill="url(#s)"/><rect x="6" y="46" width="52" height="4.5" rx="2.25" fill="#8C7CF0"/></svg>`)}`;

type Font = { name: string; data: ArrayBuffer; weight: 400 | 500 | 600; style: "normal" };
let fonts: Promise<Font[]> | null = null;
function loadFonts() {
  const dir = join(process.cwd(), "src/fonts/og");
  const f = (file: string, name: string, weight: Font["weight"]) => readFile(join(dir, file)).then((b) => ({ name, weight, style: "normal" as const, data: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer }));
  fonts ??= Promise.all([
    f("outfit-latin-400-normal.woff", "Outfit", 400), f("outfit-latin-600-normal.woff", "Outfit", 600),
    f("dm-sans-latin-400-normal.woff", "DM Sans", 400), f("dm-sans-latin-500-normal.woff", "DM Sans", 500),
  ]).catch((e) => { fonts = null; throw e; });
  return fonts;
}

/** Glyphs outside the bundled Latin subset are swapped for close equivalents. */
const clean = (s: string) => s.replace(/≈/g, "~").replace(/[→]/g, "->").replace(/ /g, " ");
const shortPath = (p: string) => (p.length <= 44 ? p : `${p.slice(0, 30)}…${p.slice(-10)}`);
const dateOf = (t: number) => new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Athens" });

export async function renderCard(d: CardData, reading: string, headers?: Record<string, string>) {
  const title = clean(d.title);
  const titleSize = title.length > 22 ? 50 : title.length > 14 ? 60 : 72;
  const text = clean(reading);
  const textSize = text.length > 220 ? 23 : text.length > 150 ? 26 : 29;
  return new ImageResponse(
    (
      <div style={{ width: W, height: H, display: "flex", flexDirection: "column", padding: "52px 60px 40px", color: C.text, fontFamily: "DM Sans", backgroundColor: C.bg,
        backgroundImage: "radial-gradient(circle at 100% 115%, rgba(240,141,168,0.32), rgba(16,11,43,0) 45%), radial-gradient(circle at 0% 0%, rgba(75,52,214,0.45), rgba(16,11,43,0) 50%)" }}>
        {/* top row */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={MARK} width={44} height={44} alt="" />
            <div style={{ display: "flex", marginLeft: 12, fontFamily: "Outfit", fontSize: 30 }}>
              <span style={{ fontWeight: 600 }}>dawns</span><span style={{ fontWeight: 400, color: C.muted }}>.money</span>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center" }}>
            <div style={{ display: "flex", fontFamily: "Outfit", fontWeight: 600, fontSize: 16, letterSpacing: 2.5, color: "#2A1405", padding: "8px 16px", borderRadius: 99, backgroundImage: "linear-gradient(90deg, #FF8A5B, #FFD36A)" }}>{d.kicker}</div>
            <div style={{ display: "flex", marginLeft: 16, fontSize: 18, color: C.muted }}>{dateOf(d.asOf)}</div>
          </div>
        </div>
        {/* subject */}
        <div style={{ display: "flex", alignItems: "center", marginTop: 30 }}>
          <div style={{ display: "flex", fontFamily: "Outfit", fontWeight: 600, fontSize: titleSize, letterSpacing: -1.5, lineHeight: 1 }}>{title}</div>
          <div style={{ display: "flex", marginLeft: 20, fontSize: 19, color: C.muted, border: `1px solid ${C.line}`, padding: "6px 14px", borderRadius: 99 }}>{clean(d.sub)}</div>
          <div style={{ display: "flex", alignItems: "center", marginLeft: "auto", fontSize: 18, color: TONE[d.grade.t] }}>
            <div style={{ display: "flex", width: 12, height: 12, borderRadius: 99, backgroundColor: TONE[d.grade.t], marginRight: 9 }} />{clean(d.grade.label)}
          </div>
        </div>
        {/* tiles */}
        <div style={{ display: "flex", marginTop: 28 }}>
          {d.tiles.map((t, i) => (
            <div key={i} style={{ display: "flex", flexDirection: "column", flex: 1, marginLeft: i ? 16 : 0, padding: "18px 20px", borderRadius: 16, backgroundColor: C.card, border: `1px solid ${C.line}` }}>
              <div style={{ display: "flex", alignItems: "center", fontSize: 14.5, color: C.muted, textTransform: "uppercase", letterSpacing: 1.2 }}>
                <div style={{ display: "flex", width: 9, height: 9, borderRadius: 99, backgroundColor: TONE[t.t], marginRight: 8 }} />{clean(t.title)}
              </div>
              <div style={{ display: "flex", fontFamily: "Outfit", fontWeight: 600, fontSize: t.big.length > 9 ? 31 : 38, marginTop: 8, color: t.t === "warn" || t.t === "crit" ? TONE[t.t] : C.text }}>{clean(t.big)}</div>
              <div style={{ display: "flex", fontSize: 16.5, color: C.muted, marginTop: 4, lineHeight: 1.3 }}>{clean(t.small)}</div>
            </div>
          ))}
        </div>
        {/* reading */}
        <div style={{ display: "flex", flex: 1, marginTop: 26, marginBottom: 18 }}>
          <div style={{ display: "flex", width: 6, borderRadius: 99, backgroundImage: "linear-gradient(180deg, #FFD27A, #FF9A62, #F0679A)" }} />
          <div style={{ display: "flex", flexDirection: "column", marginLeft: 20, flex: 1 }}>
            <div style={{ display: "flex", fontFamily: "Outfit", fontWeight: 600, fontSize: 15, letterSpacing: 2.5, color: C.sun }}>{d.readingLabel ?? "WHAT WE FOUND"}</div>
            <div style={{ display: "flex", fontSize: textSize, lineHeight: 1.38, marginTop: 8 }}>{text}</div>
          </div>
        </div>
        {/* foot */}
        <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 16, borderTop: `1px solid ${C.line}`, fontSize: 17, color: C.muted }}>
          <div style={{ display: "flex" }}>{d.lead ?? "Every number traceable on-chain"}&nbsp;<span style={{ color: C.text }}>dawns.money{shortPath(d.path)}</span></div>
          <div style={{ display: "flex" }}>{clean(d.foot)}{d.block ? ` · Igra block ${d.block.toLocaleString("en-US")}` : ""}</div>
        </div>
      </div>
    ),
    { width: W, height: H, fonts: await loadFonts(), headers },
  );
}
