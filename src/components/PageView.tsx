"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { track } from "@/lib/track";

/** One first-party page view per route change (no tracking cookies; see /api/e). A share link sets one referral cookie. */
export function PageView() {
  const path = usePathname();
  useEffect(() => {
    let ref = "";
    try { ref = document.referrer ? new URL(document.referrer).host : ""; } catch { /* no referrer */ }
    // a share link (?r=code): remember it for a sign-up within 30 days, and tell the link's owner a visitor came
    let r: string | null = null;
    try {
      r = new URLSearchParams(location.search).get("r");
      if (r && /^[a-hj-km-np-z2-9]{7}$/.test(r)) document.cookie = `dawns_ref=${r}; path=/; max-age=${30 * 86_400}; samesite=lax; secure`;
      else r = null;
    } catch { r = null; }
    const props: Record<string, string> = {};
    if (ref && ref !== location.host) props.ref = ref;
    if (r) props.r = r;
    track("pageview", Object.keys(props).length ? props : undefined);
  }, [path]);
  return null;
}
