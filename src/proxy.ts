import { NextResponse, type NextRequest } from "next/server";

/**
 * One address, two sites: a phone gets the dedicated mobile screens (src/app/m), a
 * desktop the full site, at the same URL. The choice can be overridden with the
 * `view` cookie ("m" or "d"), set by the "Desktop site" / "Mobile site" links.
 */
const PHONE = /Android.+Mobile|iPhone|iPod|Windows Phone|webOS|BlackBerry|Opera Mini|IEMobile/i;

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/m/") || pathname === "/m") return NextResponse.next();
  const pref = req.cookies.get("view")?.value;
  const phone = pref === "m" || (pref !== "d" && PHONE.test(req.headers.get("user-agent") ?? ""));
  if (!phone || !MOBILE.some((re) => re.test(pathname))) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = pathname === "/" ? "/m" : `/m${pathname}`;
  return NextResponse.rewrite(url);
}

/** Routes that have a mobile screen. Anything else (admin, brand) stays on the desktop site. */
const MOBILE = [
  /^\/$/, /^\/protocols(\/[^/]+)?$/, /^\/bridge$/, /^\/opportunities$/, /^\/intelligence$/, /^\/portfolio$/, /^\/allocate$/,
  /^\/strategies(\/[^/]+)?$/, /^\/strategists\/[^/]+$/,
  /^\/vaults(\/[^/]+)?$/, /^\/managers(\/[^/]+)?$/,
  /^\/assets$/, /^\/assets\/compare$/, /^\/assets\/[^/]+\/[^/]+\/[^/]+$/, /^\/watchlist$/,
];

export const config = {
  matcher: ["/((?!api|_next|m/|.*\\.[a-z0-9]+$).*)"],
};
