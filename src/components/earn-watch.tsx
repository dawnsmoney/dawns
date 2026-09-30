"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { openConnect } from "./connect";

type S = { signedIn: boolean; telegram: boolean; opps: string[] };

/**
 * "Watch it for me": dawns records the option's numbers and what your wallets hold in
 * it, then tells you in Telegram when its yield halves, capital leaves, the exit
 * tightens or the price swings. Stop any time.
 */
export function EarnWatchToggle({ opp, kind }: { opp: string; kind: "supply" | "lp" }) {
  const [s, setS] = useState<S | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const load = () => fetch("/api/earn/watch").then((r) => r.json()).then(setS).catch(() => setS({ signedIn: false, telegram: false, opps: [] }));
  useEffect(() => { load(); }, []);
  const on = !!s?.opps.includes(opp);
  const toggle = async () => {
    setErr(null);
    if (!s?.signedIn) { try { await openConnect(); await load(); } catch { /* closed */ } return; }
    setBusy(true);
    const r = await fetch("/api/earn/watch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ opp, on: !on }) }).catch(() => null);
    if (!r?.ok) setErr(((await r?.json().catch(() => ({}))) as { error?: string })?.error ?? "Couldn't save that.");
    await load(); setBusy(false);
  };
  return (
    <div className={`ewatch${on ? " on" : ""}`}>
      <div>
        <b>{on ? "dawns is watching this for you" : "Watch it for me"}</b>
        <span>dawns tells you when the yield halves, capital starts leaving{kind === "supply" ? ", less than a fifth could leave" : ", the price swings enough to cost you"}, or the market is frozen. It compares with today&apos;s numbers and what your wallet holds here.</span>
        {on && s && !s.telegram && <span className="ewatch-warn">Alerts go to Telegram: <Link href="/portfolio">link it in Portfolio</Link> to get them.</span>}
        {err && <small className="cl-err">{err}</small>}
      </div>
      <button type="button" className={`btn ${on ? "ghost" : "sun"} sm`} disabled={busy || !s} onClick={toggle}>{!s ? "…" : !s.signedIn ? "Sign in to watch" : on ? "Stop watching" : "Watch it"}</button>
    </div>
  );
}
