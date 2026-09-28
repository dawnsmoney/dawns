"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { track } from "@/lib/track";

/** One first-party page view per route change (no cookies; see /api/e). */
export function PageView() {
  const path = usePathname();
  useEffect(() => {
    let ref = "";
    try { ref = document.referrer ? new URL(document.referrer).host : ""; } catch { /* no referrer */ }
    track("pageview", ref && ref !== location.host ? { ref } : undefined);
  }, [path]);
  return null;
}
