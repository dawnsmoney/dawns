"use client";

import { useEffect, useState } from "react";
import { track } from "@/lib/track";
import { openReport } from "./report";

/** One "test_open" per visit, for the tester funnel in /admin/testing. */
export function TestOpen() {
  useEffect(() => { track("test_open"); }, []);
  return null;
}

export function ReportLink({ label = "Report a problem" }: { label?: string }) {
  return <button type="button" className="btn ghost sm" onClick={openReport}>{label}</button>;
}

const SAFE = [["clear", "Yes, clearly"], ["partly", "Partly"], ["no", "No"]] as const;
const MAIN = [["yes", "Yes"], ["not-yet", "Not yet"], ["no", "No"]] as const;

function Pick({ value, set, opts }: { value: string; set: (v: string) => void; opts: readonly (readonly [string, string])[] }) {
  return <div className="rep-kinds" role="radiogroup">{opts.map(([v, l]) => <button key={v} type="button" role="radio" aria-checked={value === v} className={value === v ? "on" : ""} onClick={() => set(v)}>{l}</button>)}</div>;
}

/** The three questions at the end of the tester path. Signed-in only, so each person counts once. */
export function Survey({ signedIn, done }: { signedIn: boolean; done: boolean }) {
  const [a, setA] = useState({ safe: "", safeWhy: "", stuck: "", mainnet: "", mainnetWhy: "" });
  const [st, setSt] = useState<{ busy?: boolean; ok?: boolean; err?: string }>({ ok: done });
  const [again, setAgain] = useState(false);
  const set = (k: keyof typeof a) => (v: string) => setA({ ...a, [k]: v });
  if (!signedIn) return <p className="muted" style={{ margin: 0 }}>Sign in first, so your answers count once.</p>;
  if (st.ok && !again) return <div className="find-ok"><b>Thank you.</b> Your answers are in; they decide what gets fixed first. <button type="button" className="btn ghost sm" onClick={() => setAgain(true)}>Change them</button></div>;
  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setSt({ busy: true });
    const r = await fetch("/api/feedback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "survey", answers: a, path: location.pathname, device: `${navigator.userAgent.slice(0, 150)} · ${innerWidth}×${innerHeight}` }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    if (r?.ok) { setSt({ ok: true }); setAgain(false); } else setSt({ err: (j as { error?: string }).error ?? "Couldn't send it." });
  };
  return (
    <form className="survey" onSubmit={send}>
      <fieldset><legend><span>1</span>From the vault pages alone, could you tell what keeps a deposit safe, and what doesn&apos;t?</legend>
        <Pick value={a.safe} set={set("safe")} opts={SAFE} /><textarea className="search" rows={2} value={a.safeWhy} onChange={(e) => set("safeWhy")(e.target.value)} placeholder="What made it clear, or what was missing?" maxLength={800} /></fieldset>
      <fieldset><legend><span>2</span>Where did you get stuck, if anywhere?</legend>
        <textarea className="search" rows={2} value={a.stuck} onChange={(e) => set("stuck")(e.target.value)} placeholder="The wallet, the faucet, a step that didn't make sense…" maxLength={800} /></fieldset>
      <fieldset><legend><span>3</span>Would you put real KAS in a vault like this on mainnet?</legend>
        <Pick value={a.mainnet} set={set("mainnet")} opts={MAIN} /><textarea className="search" rows={2} value={a.mainnetWhy} onChange={(e) => set("mainnetWhy")(e.target.value)} placeholder="Why, or what would you need to see first?" maxLength={800} /></fieldset>
      <div className="find-foot">{st.err && <small className="cl-err">{st.err}</small>}<button type="submit" className="btn sun" disabled={st.busy || !a.safe || !a.mainnet}>{st.busy ? "Sending…" : "Send answers"}</button></div>
    </form>
  );
}
