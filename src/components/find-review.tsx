"use client";

import { useState } from "react";

/** Accept or reject one find (admin). Accepting credits the finder 1,000 points and, with an opportunity id, a "Discovered by" line. */
export function FindReview({ id }: { id: string }) {
  const [note, setNote] = useState("");
  const [opp, setOpp] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const act = async (action: "accept" | "reject") => {
    const r = await fetch("/api/admin/finds", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, action, note, opp }) });
    const j = await r.json().catch(() => ({}));
    setDone(r.ok ? (action === "accept" ? "Accepted" : "Rejected") : (j as { error?: string }).error ?? "Failed");
  };
  if (done) return <b>{done}</b>;
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <input className="search" placeholder="Note to the finder (shown to them)" value={note} onChange={(e) => setNote(e.target.value)} />
      <input className="search mono" placeholder="Opportunity id, if it is listed now (kaskad:USDT)" value={opp} onChange={(e) => setOpp(e.target.value)} />
      <div style={{ display: "flex", gap: 8 }}><button type="button" className="btn sun sm" onClick={() => act("accept")}>Accept · +1,000</button><button type="button" className="btn ghost sm" onClick={() => act("reject")}>Reject</button></div>
    </div>
  );
}
