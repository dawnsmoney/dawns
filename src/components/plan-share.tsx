"use client";
import { useState } from "react";
import { track } from "@/lib/track";
import type { Policy } from "@/lib/allocator";
import { useUI } from "./providers";

/** Share the rules of a plan as an image: never the returns, the amount only if chosen. */
export function PlanShare({ policy, disabled }: { policy: Policy; disabled?: boolean }) {
  const { toast } = useUI();
  const [open, setOpen] = useState(false);
  const [showAmount, setShowAmount] = useState(false);
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<{ image: string; text: string; key: string } | null>(null);
  const key = JSON.stringify([policy, showAmount]);
  const make = async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/share/plan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ policy, showAmount }) });
      const j = (await r.json()) as { image?: string; text?: string; error?: string };
      if (!r.ok || !j.image) throw new Error(j.error ?? "Couldn't make the card.");
      setMade({ image: j.image, text: j.text ?? "", key });
      track("plan_shared", { risk: policy.risk, exit: policy.exit, amount: showAmount });
    } catch (e) { toast((e as Error).message); }
    setBusy(false);
  };
  if (!open) return (
    <div style={{ borderTop: "1px solid var(--line)", paddingTop: 14 }}>
      <button type="button" className="btn ghost sm" disabled={disabled} onClick={() => setOpen(true)}>Share my rules</button>
    </div>
  );
  const stale = made && made.key !== key;
  return (
    <div style={{ display: "grid", gap: 12, borderTop: "1px solid var(--line)", paddingTop: 14 }}>
      <span className="muted" style={{ fontSize: 14 }}>A card with the rules you plan by: limits, exit window, risk and the mandate check. It never shows yield or returns, and no wallet.</span>
      <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14 }}>
        <input type="checkbox" checked={showAmount} onChange={(e) => setShowAmount(e.target.checked)} /> Show the amount
      </label>
      {made && !stale && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={made.image} alt="Your plan share card" width={1200} height={630} style={{ width: "100%", height: "auto", borderRadius: 12, border: "1px solid var(--line)", background: "#100B2B" }} />
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {(!made || stale) && <button type="button" className="btn iris sm" disabled={busy || disabled} onClick={make}>{busy ? "Drawing…" : "Make the card"}</button>}
        {made && !stale && (
          <>
            <a className="btn sun sm" href={`${made.image}?dl=1`} download>Download PNG</a>
            <button type="button" className="btn ghost sm" onClick={async () => { try { await navigator.clipboard.writeText(made.text); toast("Post text copied. Attach the image."); } catch { toast("Couldn't copy."); } }}>Copy post text</button>
          </>
        )}
        <button type="button" className="btn ghost sm" onClick={() => setOpen(false)}>Close</button>
      </div>
    </div>
  );
}
