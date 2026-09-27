"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Logo } from "./Logo";
import { Arrow } from "./icons";
import { useWatchMap } from "./providers";

const NAV = [
  { href: "/", label: "Kaspa DeFi", dot: true },
  { href: "/protocols", label: "Protocols" },
  { href: "/opportunities", label: "Opportunities", soon: "Next" },
  { href: "/vaults", label: "Vaults", soon: "Later" },
];

export function Header() {
  const path = usePathname();
  const [solid, setSolid] = useState(false);
  const count = Object.keys(useWatchMap()).length;
  useEffect(() => {
    const on = () => setSolid(window.scrollY > 30);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  return (
    <header className={`top ${solid ? "solid" : ""}`}>
      <div className="bar">
        <Link className="brand" href="/" aria-label="dawns.money home">
          <span className="w"><Logo id="hdr" height={30} /></span>
          <span className="m"><Logo id="hdrm" markOnly height={34} /></span>
        </Link>
        <nav className="pillnav" aria-label="Main">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={active(n.href) ? "on" : ""} aria-current={active(n.href) ? "page" : undefined}>
              {n.dot && <span className="dot" />}
              {n.label}
              {n.soon && <span className="soon">{n.soon}</span>}
            </Link>
          ))}
          <Link href="/watchlist" className={active("/watchlist") ? "on" : ""}>
            Watchlist
            {count > 0 && <span className="cnt">{count}</span>}
            <span className="go"><Arrow /></span>
          </Link>
        </nav>
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
          <Link href="/protocols">Protocols</Link>
          <Link href="/watchlist">Watchlist</Link>
          <Link href="/brand">Brand</Link>
          <span className="mono" style={{ fontSize: 12.5 }}>Sources: Igra RPC · Kaspa L1 indexer · DefiLlama</span>
        </nav>
      </div>
    </footer>
  );
}
