"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Write today's journal entry now (replaces today's, if any). Takes up to a minute or two. */
export function JournalRun({ hasToday }: { hasToday: boolean }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();
  const run = async () => {
    setBusy(true); setMsg("Claude is reading today's data…");
    const r = await fetch("/api/admin/journal", { method: "POST" });
    const j = (await r.json().catch(() => ({}))) as { result?: string; error?: string };
    setBusy(false); setMsg(j.result ?? j.error ?? "Failed");
    router.refresh();
  };
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
      <button type="button" className="btn iris sm" disabled={busy} onClick={run}>{busy ? "Writing…" : hasToday ? "Rewrite today's entry" : "Write today's entry now"}</button>
      {msg && <small className="muted">{msg}</small>}
    </div>
  );
}
