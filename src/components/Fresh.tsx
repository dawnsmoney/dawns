"use client";

import { useSyncExternalStore } from "react";

/* One shared 1s clock for every counter on the page. */
let now = 0;
const subs = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
function subscribe(cb: () => void) {
  subs.add(cb);
  if (!timer) {
    now = Date.now();
    timer = setInterval(() => { now = Date.now(); subs.forEach((s) => s()); }, 1000);
  }
  return () => {
    subs.delete(cb);
    if (!subs.size && timer) { clearInterval(timer); timer = null; }
  };
}
const getNow = () => now || Date.now();
const getServerNow = () => 0;

/** Live "N s/min ago" counter from a server timestamp (ms). */
export function Fresh({ since }: { since: number }) {
  const t = useSyncExternalStore(subscribe, getNow, getServerNow);
  if (!t) return <span>just now</span>;
  const s = Math.max(0, Math.round((t - since) / 1000));
  return <span>{s < 90 ? `${s}s ago` : s < 5400 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)}h ago`}</span>;
}
