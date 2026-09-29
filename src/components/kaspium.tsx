"use client";

import { useEffect, useRef, useState } from "react";
import type { Account } from "./wallet";

/**
 * Sign in with Kaspium (or any Kaspa wallet that cannot sign messages): send a one-time
 * exact amount from your address back to itself. The KAS stays in your wallet; only the
 * network fee is spent. dawns sees the transaction on Kaspa L1 and signs you in.
 * Opened by signInWith("kaspium"); mounted once in AppProviders.
 */
type Req = { resolve: (a: Account) => void; reject: (e: Error) => void };
type Challenge = { nonce: string; address: string; kas: string; uri: string; expiresAt: number };

export function openKaspium(): Promise<Account> {
  return new Promise((resolve, reject) => window.dispatchEvent(new CustomEvent<Req>("dawns:kaspium", { detail: { resolve, reject } })));
}

async function post<T>(body: unknown): Promise<T> {
  const r = await fetch("/api/auth/kaspa-pay", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error ?? "Something went wrong.");
  return j as T;
}

export function KaspiumDialog() {
  const [req, setReq] = useState<Req | null>(null);
  const [addr, setAddr] = useState("");
  const [ch, setCh] = useState<Challenge | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const done = useRef(false);

  useEffect(() => {
    const on = (e: Event) => { done.current = false; setReq((e as CustomEvent<Req>).detail); setCh(null); setQr(null); setErr(null); };
    window.addEventListener("dawns:kaspium", on);
    return () => window.removeEventListener("dawns:kaspium", on);
  }, []);

  // poll the chain every 5 s until the self-send lands or the request expires
  useEffect(() => {
    if (!ch || !req) return;
    const t = setInterval(async () => {
      try {
        const r = await post<{ status: string; account?: Account }>({ nonce: ch.nonce });
        if (r.status === "ok" && !done.current) { done.current = true; clearInterval(t); req.resolve(r.account ?? null); setReq(null); }
        else if (r.status === "expired" || Date.now() > ch.expiresAt) { clearInterval(t); setErr("This request expired. Start again for a new amount."); setCh(null); }
      } catch { /* keep polling */ }
    }, 5000);
    return () => clearInterval(t);
  }, [ch, req]);

  if (!req) return null;
  const close = () => { if (!done.current) req.reject(new Error("Sign-in cancelled.")); setReq(null); };
  const start = async () => {
    setBusy(true); setErr(null);
    try {
      const c = await post<Challenge>({ address: addr.trim() });
      setCh(c);
      const QR = await import("qrcode");
      setQr(await QR.toDataURL(c.uri, { margin: 1, width: 220, color: { dark: "#100B2B", light: "#FFFFFF" } }));
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const copy = (k: string, v: string) => { navigator.clipboard?.writeText(v).then(() => { setCopied(k); setTimeout(() => setCopied(null), 1500); }).catch(() => {}); };

  return (
    <>
      <div className="scrim kx-scrim" onClick={close} />
      <div className="modal kx" role="dialog" aria-modal="true" aria-label="Sign in with Kaspium">
        <button type="button" className="x btn ghost sm" onClick={close} aria-label="Close">✕</button>
        <h2>Sign in with Kaspium</h2>
        {!ch ? (
          <>
            <p className="muted" style={{ margin: 0 }}>Kaspium cannot sign messages, so you prove the address is yours by sending a small exact amount <b>to yourself</b>. The KAS stays in your wallet; you pay only the network fee.</p>
            <label className="eyebrow muted" htmlFor="kx-a">Your Kaspium address</label>
            <input id="kx-a" className="kx-in" value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="kaspa:q…" spellCheck={false} autoComplete="off" />
            <small className="muted">In Kaspium: Receive → copy your address, then paste it here.</small>
            {err && <p className="kx-err">{err}</p>}
            <button type="button" className="btn iris" disabled={busy || !/^kaspa:[a-z0-9]{50,70}$/i.test(addr.trim())} onClick={start}>{busy ? "Preparing…" : "Continue"}</button>
          </>
        ) : (
          <>
            <ol className="kx-steps">
              <li>In Kaspium, tap <b>Send</b>.</li>
              <li>Send to <b>your own address</b>:<button type="button" className="kx-copy mono" onClick={() => copy("a", ch.address)}>{ch.address.slice(0, 18)}…{ch.address.slice(-8)} <em>{copied === "a" ? "Copied" : "Copy"}</em></button></li>
              <li>Exactly this amount:<button type="button" className="kx-copy kx-amt" onClick={() => copy("k", ch.kas)}>{ch.kas} KAS <em>{copied === "k" ? "Copied" : "Copy"}</em></button></li>
            </ol>
            <div className="kx-row">
              {/* eslint-disable-next-line @next/next/no-img-element -- a data: URL QR code, nothing to optimise */}
              {qr && <img src={qr} alt="Payment request to your own address, for scanning with Kaspium" width={180} height={180} className="kx-qr" />}
              <div className="kx-side">
                <a className="btn sun" href={ch.uri}>Open in Kaspium</a>
                <small className="muted">On this phone the button opens Kaspium with both filled in. From a computer, scan the code with Kaspium.</small>
              </div>
            </div>
            <p className="kx-wait"><span className="dot" />Waiting for the transaction on Kaspa L1… this page signs you in by itself. Expires {new Date(ch.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.</p>
            {err && <p className="kx-err">{err}</p>}
          </>
        )}
      </div>
    </>
  );
}
