"use client";

import { useState } from "react";
import { useUI, useWatchMap } from "./providers";
import { Bell, Copy, Info } from "./icons";
import { P } from "@/lib/data";

/** Any element that opens the "how dawns calculated this" drawer. */
export function ProvButton({ id, className, children }: { id: string; className?: string; children: React.ReactNode }) {
  const { openProv } = useUI();
  return (
    <button type="button" className={className} onClick={() => openProv(id)}>
      {children}
    </button>
  );
}

export function ProvRow({ id, className, children }: { id: string; className?: string; children: React.ReactNode }) {
  const { openProv } = useUI();
  return (
    <div className={`${className ?? ""} clickable`} role="button" tabIndex={0} onClick={() => openProv(id)} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && openProv(id)}>
      {children}
    </div>
  );
}

export function Kpi({ label, value, ctx, prov }: { label: string; value: string; ctx: React.ReactNode; prov?: string }) {
  const { openProv } = useUI();
  return (
    <button className="kpi" type="button" onClick={prov ? () => openProv(prov) : undefined} style={prov ? undefined : { cursor: "default" }}>
      <span className="lab">{label}{prov && <Info />}</span>
      <span className="val">{value}</span>
      <span className="ctx">{ctx}</span>
    </button>
  );
}

export function WatchButton({ id, variant = "ghost", label }: { id: string; variant?: "ghost" | "sun" | "glass"; label?: React.ReactNode }) {
  const { openWatch } = useUI();
  const map = useWatchMap();
  const p = P[id];
  if (p.floor) return <span className="tag">Alerts off</span>;
  const on = !!map[id];
  const cls = on && !label ? "watching sm" : variant === "sun" ? "sun" : variant === "glass" ? "glass" : "ghost sm";
  return (
    <button type="button" className={`btn ${cls}`} onClick={(e) => { e.stopPropagation(); openWatch(id); }}>
      <Bell />
      {label ?? (on ? "Watching" : "Watch")}
    </button>
  );
}

export function CopyReport({ text }: { text: string }) {
  const { toast } = useUI();
  const [busy, setBusy] = useState(false);
  const fallback = () => {
    const el = document.getElementById("rep");
    if (!el) return;
    const r = document.createRange();
    r.selectNodeContents(el);
    const s = getSelection();
    s?.removeAllRanges();
    s?.addRange(r);
    toast("Text selected. Press Copy.");
  };
  return (
    <button className="btn sun" type="button" disabled={busy} onClick={async () => {
      setBusy(true);
      try { await navigator.clipboard.writeText(text); toast("Post copied. Paste it into X."); } catch { fallback(); }
      setBusy(false);
    }}>
      <Copy />Copy post
    </button>
  );
}
