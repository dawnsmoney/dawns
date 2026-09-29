"use client";

import { useState } from "react";

/** Set a report's status (admin). Confirmed or fixed pays a signed-in reporter 500 points, once. */
export function FeedbackReview({ id, status }: { id: string; status: string }) {
  const [st, setSt] = useState(status);
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const set = async (s: string) => {
    setErr(null);
    const r = await fetch("/api/admin/feedback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, status: s, note }) });
    if (r.ok) setSt(s); else setErr(((await r.json().catch(() => ({}))) as { error?: string }).error ?? "Failed");
  };
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <input className="search" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        {[["confirmed", "Confirm · +500"], ["fixed", "Fixed"], ["dismissed", "Dismiss"], ["new", "Back to new"]].map(([k, l]) => (
          <button key={k} type="button" className={`btn ${st === k ? "sun" : "ghost"} sm`} onClick={() => set(k)}>{l}</button>
        ))}
        {err && <small className="cl-err">{err}</small>}
      </div>
    </div>
  );
}
