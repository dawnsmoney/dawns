"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { connectWith, shortAddr, useWalletOptions } from "./wallet";
import { AddressForm } from "./portfolio";

const KEY = "dawns:portfolio";
const read = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
const write = (v: string) => { try { if (v) localStorage.setItem(KEY, v); else localStorage.removeItem(KEY); } catch { /* private mode */ } };
const list = (v?: string | null) => [...new Set((v ?? "").split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean))];

/**
 * Connect wallets the way every portfolio app does, but read-only: connecting only shares
 * the address (no signature, no session). EVM wallets, WalletConnect, KasWare and Kastle
 * connect; Kaspium has no dApp link, so its address is pasted. Addresses stack, so one
 * view can hold a MetaMask and a Kaspa wallet together; the list is remembered on this device.
 */
export function PortfolioConnect({ value, mine }: { value?: string; mine?: string | null }) {
  const router = useRouter();
  const wallets = useWalletOptions();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [kx, setKx] = useState(false);
  const [kaddr, setKaddr] = useState("");
  const [last, setLast] = useState<string | null>(null);
  const cur = list(value);

  useEffect(() => { if (cur.length) write(cur.join(",")); else { const t = setTimeout(() => setLast(read()), 0); return () => clearTimeout(t); } }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = (addrs: string[]) => { const v = [...new Set(addrs)].slice(0, 5).join(","); write(v); router.push(v ? `/portfolio?a=${encodeURIComponent(v)}` : "/portfolio"); };
  const add = async (key: string) => {
    if (key === "kaspium") { setKx(true); return; }
    setBusy(key); setErr(null);
    try { const { address } = await connectWith(key); go([...cur, address.toLowerCase()]); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  };

  return (
    <div className="pf-connect">
      <div className="pf-connect-h">
        <b>{cur.length ? "Wallets in this view" : "Connect a wallet"}</b>
        <small className="muted">Read-only: connecting shares your address, nothing is signed or stored.</small>
      </div>
      {cur.length > 0 && (
        <div className="pf-chips">
          {cur.map((a) => <span key={a} className="pf-chip"><i className={a.startsWith("kaspa:") ? "k" : "e"} />{shortAddr(a)}<button type="button" aria-label={`Remove ${a}`} onClick={() => go(cur.filter((x) => x !== a))}>×</button></span>)}
        </div>
      )}
      <div className="pf-wallets">
        {wallets.map((w) => w.installed ? (
          <button key={w.key} type="button" className="btn glass sm" disabled={!!busy} onClick={() => add(w.key)}>
            {/* eslint-disable-next-line @next/next/no-img-element -- wallet icons are data: URIs from EIP-6963 */}
            {w.icon && /^data:image\//.test(w.icon) && <img src={w.icon} alt="" width={16} height={16} style={{ borderRadius: 4 }} />}
            {busy === w.key ? "Check your wallet…" : `${cur.length ? "Add " : ""}${w.label}`}
          </button>
        ) : w.open ? <a key={w.key} className="btn ghost sm" href={w.open}>Open in the {w.label} app</a>
          : <a key={w.key} className="btn ghost sm" href={w.install} target="_blank" rel="noopener noreferrer">Get {w.label}</a>)}
      </div>
      {kx && (
        <form className="pf-row" onSubmit={(e) => { e.preventDefault(); const a = kaddr.trim().toLowerCase(); if (/^kaspa:[a-z0-9]{61,63}$/.test(a)) go([...cur, a]); else setErr("Paste your Kaspium address: kaspa:q… (Receive → copy)."); }}>
          <input value={kaddr} onChange={(e) => setKaddr(e.target.value)} placeholder="kaspa:q… from Kaspium → Receive" spellCheck={false} autoComplete="off" aria-label="Kaspium address" />
          <button className="btn iris" type="submit">Add</button>
        </form>
      )}
      {err && <p className="kx-err">{err}</p>}
      {!cur.length && last && <button type="button" className="pf-mine linkish" onClick={() => go(list(last))}>Continue with your last wallets ({list(last).map(shortAddr).join(", ")})</button>}
      <details className="more pf-paste"><summary>Or paste any address</summary><AddressForm value={value} mine={mine} /></details>
    </div>
  );
}
