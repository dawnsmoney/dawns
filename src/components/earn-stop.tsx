"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Stop watching an Earn option (Portfolio). */
export function EarnStop({ opp }: { opp: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button type="button" className="btn ghost sm" disabled={busy} onClick={async () => {
      setBusy(true);
      await fetch("/api/earn/watch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ opp, on: false }) }).catch(() => null);
      router.refresh();
    }}>{busy ? "…" : "Stop watching"}</button>
  );
}
