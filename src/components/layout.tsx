"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Logo } from "./Logo";
import { Arrow, Chevron } from "./icons";
import { useWatchMap } from "./providers";

/** One expanding group, like a product menu: everything to read lives under Explore. */
const EXPLORE = [
  { href: "/", label: "Kaspa DeFi" },
  { href: "/assets", label: "Assets", badge: "New" },
  { href: "/protocols", label: "Protocols" },
  { href: "/opportunities", label: "Opportunities", badge: "Beta" },
  { href: "/bridge", label: "Igra bridge" },
  { href: "/vaults", label: "Vaults", badge: "Soon" },
];

export function Header() {
  const path = usePathname();
  const [solid, setSolid] = useState(false);
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const count = Object.keys(useWatchMap()).length;
  useEffect(() => {
    const on = () => setSolid(window.scrollY > 30);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  // close on navigation, outside click and Escape
  const [seen, setSeen] = useState(path);
  if (seen !== path) { setSeen(path); setOpen(false); }
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => { if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", down); document.removeEventListener("keydown", key); };
  }, [open]);
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  const inExplore = EXPLORE.some((n) => active(n.href));

  const row = (
    <>
      <button type="button" className={`navbtn ${inExplore || open ? "on" : ""}`} aria-expanded={open} aria-controls="explore-menu" onClick={() => setOpen((v) => !v)}>
        <span className="dot" />Explore<Chevron className={`chev ${open ? "up" : ""}`} />
      </button>
      <Link href="/allocate" className={active("/allocate") ? "on" : ""} aria-current={active("/allocate") ? "page" : undefined}>Allocate</Link>
      <Link href="/watchlist" className={active("/watchlist") ? "on" : ""}>
        Watchlist
        {count > 0 && <span className="cnt">{count}</span>}
        <span className="go"><Arrow /></span>
      </Link>
    </>
  );

  return (
    <header className={`top ${solid ? "solid" : ""}`}>
      <div className="bar">
        <Link className="brand" href="/" aria-label="dawns.money home">
          <span className="w"><Logo id="hdr" height={30} /></span>
          <span className="m"><Logo id="hdrm" markOnly height={34} /></span>
        </Link>
        <div className="navwrap" ref={wrap}>
          <nav className="pillnav" aria-label="Main" aria-hidden={open || undefined}>{row}</nav>
          {open && (
            <div className="navcard" id="explore-menu">
              <nav className="pillnav bare" aria-label="Main">{row}</nav>
              <ul>
                {EXPLORE.map((n) => (
                  <li key={n.href}>
                    <Link href={n.href} className={active(n.href) ? "on" : ""} aria-current={active(n.href) ? "page" : undefined}>
                      <span>{n.label}{n.badge && <span className={`badge ${n.badge === "New" ? "new" : ""}`}>{n.badge}</span>}</span>
                      <Arrow className="arr" />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="foot-site">
      <div className="wrap">
        <Link href="/" aria-label="dawns.money home"><Logo id="ftr" height={26} /></Link>
        <nav>
          <Link href="/assets">Assets</Link>
          <Link href="/protocols">Protocols</Link>
          <Link href="/bridge">Igra bridge</Link>
          <Link href="/watchlist">Watchlist</Link>
          <Link href="/brand">Brand</Link>
          <span className="mono" style={{ fontSize: 12.5 }}>Sources: Igra RPC · Kaspa L1 indexer · DefiLlama</span>
        </nav>
      </div>
    </footer>
  );
}
