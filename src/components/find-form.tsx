"use client";

import { useState } from "react";
import { track } from "@/lib/track";

/** Submit a market, pool or vault dawns does not list yet. Reviewed by hand; accepted finds earn 1,000 points and a credit. */
export function FindForm({ signedIn }: { signedIn: boolean }) {
  const [f, setF] = useState({ protocol: "", target: "", asset: "", link: "", why: "" });
  const [state, setState] = useState<{ busy?: boolean; ok?: boolean; err?: string }>({});
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setState({ busy: true });
    const r = await fetch("/api/pioneer/finds", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(f) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    if (r?.ok) { track("find_submitted"); setState({ ok: true }); setF({ protocol: "", target: "", asset: "", link: "", why: "" }); }
    else setState({ err: (j as { error?: string }).error ?? "Something went wrong." });
  };
  if (!signedIn) return <p className="muted" style={{ margin: 0 }}>Sign in with a wallet to submit a find: accepted finds are credited to you.</p>;
  if (state.ok) return <div className="find-ok"><b>Thanks, it&apos;s in the queue.</b> dawns checks every find by hand: whether it can be read on-chain, how its yield is paid, and how you would leave. You&apos;ll see the decision here. <button type="button" className="btn ghost sm" onClick={() => setState({})}>Submit another</button></div>;
  return (
    <form className="find-form" onSubmit={send}>
      <label><span>Protocol</span><input className="search" value={f.protocol} onChange={set("protocol")} placeholder="Kaskad, ZealousSwap, …" maxLength={60} required /></label>
      <label><span>Market, pool or vault</span><input className="search" value={f.target} onChange={set("target")} placeholder="WKAS/USDT pool, USDC supply, …" maxLength={120} required /></label>
      <label><span>Asset <small>optional</small></span><input className="search" value={f.asset} onChange={set("asset")} placeholder="USDT" maxLength={40} /></label>
      <label><span>Link or contract <small>optional</small></span><input className="search mono" value={f.link} onChange={set("link")} placeholder="https://… or 0x…" maxLength={300} /></label>
      <label className="wide"><span>Why it is interesting</span><textarea className="search" rows={3} value={f.why} onChange={set("why")} placeholder="Where the yield comes from, what changed, why dawns should read it." maxLength={800} required /></label>
      <div className="wide find-foot">{state.err && <small className="cl-err">{state.err}</small>}<button type="submit" className="btn sun" disabled={state.busy}>{state.busy ? "Sending…" : "Submit the find"}</button></div>
    </form>
  );
}
