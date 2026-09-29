"use client";

import { useState } from "react";
import { track } from "@/lib/track";

let cached: Promise<string | null> | null = null;
/** The signed-in account's share code (null when signed out), fetched once per page. */
function myCode() {
  cached ??= fetch("/api/pioneer/code").then((r) => r.json()).then((j: { code: string | null }) => j.code).catch(() => null);
  return cached;
}

/**
 * Share a dawns page. Signed in, the link carries your Pioneer code: each new visitor
 * who arrives through it earns you points. Signed out, it is the plain link.
 */
export function Share({ path, text, compact }: { path: string; text: string; compact?: boolean }) {
  const [copied, setCopied] = useState(false);
  const link = async () => {
    const code = await myCode();
    const u = new URL(path, window.location.origin);
    if (code) u.searchParams.set("r", code);
    return u.toString();
  };
  const copy = async () => {
    const url = await link();
    track("share_copy", { path });
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { window.prompt("Copy this link", url); }
  };
  const x = async () => {
    const w = window.open("", "_blank");
    if (w) w.opener = null;
    const url = await link();
    track("share_x", { path });
    const href = `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
    if (w) w.location.href = href; else window.location.href = href;
  };
  return (
    <div className={`share${compact ? " compact" : ""}`}>
      <button type="button" className="btn ghost sm" onClick={x}>Post on X</button>
      <button type="button" className="btn ghost sm" onClick={copy}>{copied ? "Link copied" : "Copy link"}</button>
    </div>
  );
}
