"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Logo } from "../Logo";
import { useWatchMap } from "../providers";
import { AccountButton } from "../connect";

/* The phone app's frame: a slim top bar and a tab bar at the thumb. */

const TABS = [
  { href: "/opportunities", label: "Yield", icon: "yield" },
  { href: "/vaults", label: "Vaults", icon: "vault" },
  { href: "/intelligence", label: "Intel", icon: "intel" },
  { href: "/portfolio", label: "Portfolio", icon: "wallet" },
] as const;
const MORE = [
  { href: "/", label: "Kaspa DeFi", sub: "The ecosystem today: value, liquidity, signals" },
  { href: "/strategies", label: "Strategies", sub: "Written, versioned, evaluated daily" },
  { href: "/assets", label: "Assets", sub: "Every Kaspa token, who holds it, how deep it trades" },
  { href: "/protocols", label: "Protocols", sub: "Health of every Kaspa DeFi protocol" },
  { href: "/bridge", label: "Igra bridge", sub: "KAS locked vs iKAS, exits and payouts" },
  { href: "/allocate", label: "Allocate", sub: "A split for your risk and exit window" },
  { href: "/managers", label: "Managers", sub: "Who runs the vaults, and their record" },
  { href: "/watchlist", label: "Watchlist", sub: "Protocols you get alerts for" },
];

function Icon({ k }: { k: string }) {
  const p = { width: 22, height: 22, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  if (k === "home") return <svg {...p}><path d="M4 11l8-6 8 6v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z" /></svg>;
  if (k === "yield") return <svg {...p}><path d="M4 19V11M10 19V6M16 19v-9M22 19H2" /></svg>;
  if (k === "strat") return <svg {...p}><circle cx="6" cy="6" r="2.5" /><circle cx="18" cy="6" r="2.5" /><circle cx="12" cy="18" r="2.5" /><path d="M7.5 8l3.5 7.5M16.5 8L13 15.5" /></svg>;
  if (k === "intel") return <svg {...p}><path d="M3 17l5-5 4 3 8-8" /><path d="M15 7h5v5" /></svg>;
  if (k === "wallet") return <svg {...p}><rect x="3" y="6" width="18" height="14" rx="2.5" /><path d="M3 10h18M16.5 15h1.5" /></svg>;
  if (k === "vault") return <svg {...p}><rect x="3" y="5" width="18" height="15" rx="2.5" /><circle cx="12" cy="12.5" r="3.2" /><path d="M12 9.3v-1M12 16.7v-1M8.8 12.5h-1M16.2 12.5h-1" /></svg>;
  return <svg {...p}><circle cx="5" cy="12" r="1.4" /><circle cx="12" cy="12" r="1.4" /><circle cx="19" cy="12" r="1.4" /></svg>;
}

const setView = (v: "d" | "m") => { document.cookie = `view=${v}; path=/; max-age=${60 * 60 * 24 * 180}; samesite=lax`; window.location.reload(); };

export function MShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const [more, setMore] = useState(false);
  const watching = Object.keys(useWatchMap()).length;
  const [seen, setSeen] = useState(path);
  if (seen !== path) { setSeen(path); setMore(false); }
  useEffect(() => {
    if (!more) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") setMore(false); };
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [more]);
  const active = (href: string) => (href === "/" ? path === "/" || path === "/m" : path.startsWith(href) || path.startsWith(`/m${href}`));
  const inMore = MORE.some((m) => active(m.href));
  return (
    <div className="m-app">
      <header className="m-top">
        <Link href="/" className="m-brand" aria-label="dawns.money home"><Logo id="mtop" height={24} /></Link>
        <span className="m-top-r"><AccountButton compact />
        <Link href="/watchlist" className="m-topbtn" aria-label={`Watchlist${watching ? `, ${watching} protocols` : ""}`}>
          <svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden><path d="M4 11V7a4 4 0 0 1 8 0v4l1.2 1.5H2.8z" /><path d="M6.6 14a1.5 1.5 0 0 0 2.8 0" /></svg>
          {watching > 0 && <span className="m-dot">{watching}</span>}
        </Link></span>
      </header>
      <main className="m-main">{children}</main>
      <nav className="m-tabs" aria-label="Main">
        {TABS.map((t) => (
          <Link key={t.href} href={t.href} className={active(t.href) ? "on" : ""} aria-current={active(t.href) ? "page" : undefined}><Icon k={t.icon} /><span>{t.label}</span></Link>
        ))}
        <button type="button" className={more || inMore ? "on" : ""} aria-expanded={more} onClick={() => setMore((v) => !v)}><Icon k="more" /><span>More</span></button>
      </nav>
      {more && (
        <div className="m-sheet-bg" onClick={() => setMore(false)}>
          <div className="m-sheet" role="dialog" aria-label="More" onClick={(e) => e.stopPropagation()}>
            <span className="m-grab" aria-hidden />
            {MORE.map((m) => (
              <Link key={m.href} href={m.href} className={`m-sheet-row ${active(m.href) ? "on" : ""}`}><span><b>{m.label}</b><small>{m.sub}</small></span><i aria-hidden>›</i></Link>
            ))}
            <button type="button" className="m-sheet-row plain" onClick={() => setView("d")}><span><b>Desktop site</b><small>The full site with every table and chart</small></span><i aria-hidden>›</i></button>
          </div>
        </div>
      )}
    </div>
  );
}

/** On the desktop site, when it is viewed on a phone by choice: a way back. */
export function BackToMobile() {
  return <button type="button" className="btn ghost sm" onClick={() => setView("m")}>Mobile site</button>;
}
