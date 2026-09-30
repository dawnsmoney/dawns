"use client";

import { useState } from "react";
import { track } from "@/lib/track";

/** The badge a protocol can put on its own site, with the snippet to copy. */
export function ProofEmbed({ id, name, origin }: { id: string; name: string; origin: string }) {
  const [style, setStyle] = useState<"dark" | "light">("dark");
  const [done, setDone] = useState(false);
  const img = `${origin}/api/proof/${id}/badge${style === "light" ? "?theme=light" : ""}`;
  const code = `<a href="${origin}/proof/${id}" target="_blank" rel="noopener"><img src="${img}" alt="${name} proof of reserves, read on-chain by dawns" height="44"></a>`;
  const copy = async () => {
    try { await navigator.clipboard.writeText(code); setDone(true); track("proof_embed_copy", { id }); setTimeout(() => setDone(false), 1800); } catch { /* clipboard blocked: the code is selectable */ }
  };
  return (
    <div className="prf-embed">
      <div className={`prf-embed-view ${style}`}>
        {/* eslint-disable-next-line @next/next/no-img-element -- the live badge itself, as sites will show it */}
        <img src={`/api/proof/${id}/badge${style === "light" ? "?theme=light" : ""}`} alt={`${name} proof of reserves badge`} height={44} />
      </div>
      <div className="prf-embed-pick" role="radiogroup" aria-label="Badge style">
        {(["dark", "light"] as const).map((t) => <button key={t} type="button" role="radio" aria-checked={style === t} className={style === t ? "on" : ""} onClick={() => setStyle(t)}>{t === "dark" ? "Dark" : "Light"}</button>)}
      </div>
      <pre className="prf-code" tabIndex={0}>{code}</pre>
      <button type="button" className="btn sun sm" onClick={copy}>{done ? "Copied" : "Copy the code"}</button>
    </div>
  );
}

/** "Build one for us": a protocol asks for a custom proof dashboard. */
export function ProofRequest({ about }: { about: string }) {
  const [who, setWho] = useState("");
  const [contact, setContact] = useState("");
  const [want, setWant] = useState("");
  const [st, setSt] = useState<{ busy?: boolean; ok?: boolean; err?: string }>({});
  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!who.trim() || !contact.trim()) return setSt({ err: "Add your protocol and how to reach you." });
    setSt({ busy: true });
    const text = `Custom proof dashboard for ${who.trim()} (seen on ${about}). ${want.trim() || "No details yet."}`;
    const r = await fetch("/api/feedback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "proof", text, contact: contact.trim(), path: location.pathname }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    if (r?.ok) { track("proof_request", { about }); setSt({ ok: true }); }
    else setSt({ err: (j as { error?: string }).error ?? "Couldn't send it. Try again in a moment." });
  };
  if (st.ok) return <p className="prf-sent">Thank you. Arty from dawns will get back to you, usually within a day.</p>;
  return (
    <form className="prf-form" onSubmit={send}>
      <label><span>Protocol or vault</span><input value={who} onChange={(e) => setWho(e.target.value)} placeholder="Your protocol or vault" maxLength={80} /></label>
      <label><span>How to reach you</span><input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Telegram, X or email" maxLength={80} /></label>
      <label className="wide"><span>What should it show? <em>optional</em></span><textarea value={want} onChange={(e) => setWant(e.target.value)} rows={3} maxLength={1200} placeholder="Treasury wallets, off-chain reserves, your branding, alerts to your team…" /></label>
      <div className="wide prf-form-go"><button type="submit" className="btn sun" disabled={st.busy}>{st.busy ? "Sending…" : "Ask for a custom dashboard"}</button>{st.err && <span className="down">{st.err}</span>}</div>
    </form>
  );
}
