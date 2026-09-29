"use client";

import { useEffect } from "react";
import { track } from "@/lib/track";

/**
 * Tells dawns once a day that this browser opened Intelligence. The server credits a
 * signed-in Pioneer ("Come back to Intelligence"); for anyone else it is one product event.
 */
export function IntelDay() {
  useEffect(() => {
    const d = new Date().toISOString().slice(0, 10);
    try { if (localStorage.getItem("dawns_intel_day") === d) return; localStorage.setItem("dawns_intel_day", d); } catch { /* storage off: send anyway */ }
    track("intel_day");
  }, []);
  return null;
}

/** One "opportunity_open" when an opportunity's own page is read (a Pioneer earns for each new one). */
export function OppOpen({ id }: { id: string }) {
  useEffect(() => { track("opportunity_open", { id }); }, [id]);
  return null;
}
