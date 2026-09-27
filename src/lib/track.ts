/** First-party product events (no cookies). Page views come from Vercel Web Analytics. */
export function track(name: string, props?: Record<string, string | number | boolean>) {
  try {
    const body = JSON.stringify({ name, path: location.pathname, props });
    if (!navigator.sendBeacon?.("/api/e", new Blob([body], { type: "application/json" })))
      fetch("/api/e", { method: "POST", body, keepalive: true, headers: { "content-type": "application/json" } }).catch(() => null);
  } catch { /* never break the page for analytics */ }
}
