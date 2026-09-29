"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { track } from "@/lib/track";
import { useAccount } from "./connect";

/** Open the report dialog from anywhere (the /test page's step, links). */
export const openReport = () => window.dispatchEvent(new Event("dawns:report"));

const KINDS = [
  { k: "bug", label: "Something broke", ph: "What did you do, and what happened? A wallet error, a number that looks wrong, a button that did nothing…" },
  { k: "confusing", label: "Confusing", ph: "What did you expect, and what did the page tell you instead?" },
  { k: "idea", label: "An idea", ph: "What would make dawns more useful to you?" },
] as const;

/**
 * "Report a problem", on every page. The page, the device and (when signed in) the
 * account ride along, so a report needs no back-and-forth. Confirmed reports from a
 * signed-in Pioneer earn points.
 */
export function ReportButton({ mobile }: { mobile?: boolean }) {
  const path = usePathname();
  const { account } = useAccount();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<(typeof KINDS)[number]["k"]>("bug");
  const [text, setText] = useState("");
  const [contact, setContact] = useState("");
  const [st, setSt] = useState<{ busy?: boolean; ok?: boolean; err?: string }>({});
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const on = () => { setOpen(true); setSt({}); track("report_open"); };
    window.addEventListener("dawns:report", on);
    return () => window.removeEventListener("dawns:report", on);
  }, []);
  useEffect(() => {
    if (!open) return;
    box.current?.focus();
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [open]);
  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setSt({ busy: true });
    const page = typeof window !== "undefined" ? `${location.pathname}${location.search}` : path;
    const device = `${navigator.userAgent.slice(0, 150)} · ${innerWidth}×${innerHeight}`;
    const r = await fetch("/api/feedback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind, text, contact, path: page, device }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    if (r?.ok) { track("report_sent", { kind }); setSt({ ok: true }); setText(""); }
    else setSt({ err: (j as { error?: string }).error ?? "Couldn't send it. Try again, or tell us in Telegram." });
  };
  const cur = KINDS.find((x) => x.k === kind)!;
  if (path?.startsWith("/admin") || path?.startsWith("/m/admin")) return null;
  return (
    <>
      <button type="button" className={`rep-btn${mobile ? " m" : ""}`} onClick={openReport} aria-label="Report a problem"><span aria-hidden>!</span><em>Report a problem</em></button>
      {open && (
        <div className="rep-back" onPointerDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div className="rep" role="dialog" aria-modal="true" aria-labelledby="rep-h">
            <div className="rep-top"><b id="rep-h">Report a problem</b><button type="button" className="rep-x" onClick={() => setOpen(false)} aria-label="Close">×</button></div>
            {st.ok ? (
              <div className="rep-ok">
                <p><b>Thanks, it&apos;s with dawns now.</b> Every report is read.{account ? " If it turns out to be a real problem, you get 500 Pioneer points." : ""}</p>
                <div style={{ display: "flex", gap: 8 }}><button type="button" className="btn ghost sm" onClick={() => setSt({})}>Report another</button><button type="button" className="btn sun sm" onClick={() => setOpen(false)}>Done</button></div>
              </div>
            ) : (
              <form onSubmit={send} className="rep-form">
                <div className="rep-kinds" role="radiogroup" aria-label="What kind">
                  {KINDS.map((x) => <button key={x.k} type="button" role="radio" aria-checked={kind === x.k} className={kind === x.k ? "on" : ""} onClick={() => setKind(x.k)}>{x.label}</button>)}
                </div>
                <textarea ref={box} className="search" rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder={cur.ph} maxLength={2000} required />
                {!account && <input className="search" value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Telegram or X handle, if you'd like a reply (optional)" maxLength={80} />}
                <small className="muted">Sent with it: this page ({path}), your browser and screen size{account ? ", and your dawns account" : ""}. Never your keys or balances.</small>
                <div className="rep-foot">{st.err && <small className="cl-err">{st.err}</small>}<button type="submit" className="btn sun" disabled={st.busy || text.trim().length < 10}>{st.busy ? "Sending…" : "Send"}</button></div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
