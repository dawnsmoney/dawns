"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useUI } from "./providers";

export type StudioDraft = { id: string; day: string; kind: "asset" | "opp" | "count" | "plan" | "week"; title: string; sub: string; reading: string; status: "draft" | "approved" | "skipped" | "sent"; origin: string; v: string; path: string; caption: string | null };
const KIND_LABEL: Record<StudioDraft["kind"], string> = { asset: "Asset", opp: "Opportunity · Capital Report", count: "Weekly count", plan: "Plan", week: "This week in capital" };
export type StudioOption = { id: string; label: string };

const STATUS_PILL: Record<StudioDraft["status"], [string, string]> = {
  draft: ["info", "Draft"], approved: ["good", "Approved"], skipped: ["warn", "Skipped"], sent: ["good", "Sent to Telegram"],
};

async function post(body: Record<string, unknown>) {
  const r = await fetch("/api/admin/cards", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = (await r.json().catch(() => ({}))) as { error?: string; id?: string };
  if (!r.ok) throw new Error(j.error ?? `Something went wrong (HTTP ${r.status}).`);
  return j;
}

/** Make a card now for any asset or opportunity. */
export function CardMaker({ assets, opps }: { assets: StudioOption[]; opps: StudioOption[] }) {
  const router = useRouter();
  const { toast } = useUI();
  const [kind, setKind] = useState<"asset" | "opp" | "count" | "week">("asset");
  const needsRef = kind === "asset" || kind === "opp";
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState(false);
  const list = kind === "asset" ? assets : opps;
  return (
    <div className="card" style={{ display: "grid", gap: 14 }}>
      <div className="c-head"><h3>Make a card now</h3></div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <div className="seg">
          <button type="button" className={kind === "asset" ? "on" : ""} onClick={() => { setKind("asset"); setRef(""); }}>Asset</button>
          <button type="button" className={kind === "opp" ? "on" : ""} onClick={() => { setKind("opp"); setRef(""); }}>Opportunity</button>
          <button type="button" className={kind === "count" ? "on" : ""} onClick={() => { setKind("count"); setRef(""); }}>Weekly count</button>
          <button type="button" className={kind === "week" ? "on" : ""} onClick={() => { setKind("week"); setRef(""); }}>This week</button>
        </div>
        {needsRef && <select value={ref} onChange={(e) => setRef(e.target.value)} aria-label="Subject"
          style={{ flex: "1 1 260px", minWidth: 0, height: 42, borderRadius: 12, background: "rgba(0,0,0,.2)", color: "#fff", border: "1px solid var(--line-2)", padding: "0 12px", font: "500 15px var(--body)" }}>
          <option value="">{kind === "asset" ? "Pick an asset…" : "Pick an opportunity…"}</option>
          {list.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>}
        <button className="btn iris sm" type="button" disabled={(needsRef && !ref) || busy} onClick={async () => {
          setBusy(true);
          try { await post({ action: "create", kind, ref }); toast("Card drafted from live data."); router.refresh(); } catch (e) { toast((e as Error).message); }
          setBusy(false);
        }}>{busy ? "Drafting…" : "Make card"}</button>
      </div>
      <p className="muted" style={{ fontSize: 13.5, margin: 0 }}>Uses the current snapshot. Making a card again today replaces today&apos;s card for the same subject.</p>
    </div>
  );
}

/** One draft: preview, edit the reading, approve or skip, download, send to the Telegram channel. */
export function CardDraftView({ d, canTelegram }: { d: StudioDraft; canTelegram: boolean }) {
  const router = useRouter();
  const { toast } = useUI();
  const [text, setText] = useState(d.reading);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const act = async (name: string, body: Record<string, unknown>, done: string) => {
    setBusy(name);
    try { await post({ id: d.id, ...body }); toast(done); router.refresh(); } catch (e) { toast((e as Error).message); }
    setBusy(null); setConfirm(false);
  };
  const [tone, label] = STATUS_PILL[d.status];
  const dirty = text.trim() !== d.reading;
  const src = `/api/admin/cards/${d.id}?v=${encodeURIComponent(d.v)}`;
  return (
    <div className="card" style={{ display: "grid", gap: 14, opacity: d.status === "skipped" ? 0.6 : 1 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <b style={{ font: "600 18px var(--display)" }}>{d.title}</b>
          <span className="muted" style={{ fontSize: 13.5, marginLeft: 10 }}>{KIND_LABEL[d.kind]} · {d.sub} · {d.origin === "daily" ? "daily pick" : "made by hand"}</span>
        </div>
        <span className={`pill ${tone}`}>{label}</span>
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={`Share card: ${d.title}`} width={1200} height={630} loading="lazy" style={{ width: "100%", height: "auto", borderRadius: 12, border: "1px solid var(--line)", background: "#100B2B" }} />
      <label style={{ display: "grid", gap: 6 }}>
        <span className="eyebrow muted">What we found · {text.length}/320</span>
        <textarea value={text} maxLength={320} rows={3} onChange={(e) => setText(e.target.value)}
          style={{ width: "100%", resize: "vertical", borderRadius: 12, background: "rgba(0,0,0,.2)", color: "#fff", border: "1px solid var(--line-2)", padding: "10px 12px", font: "400 15px/1.45 var(--body)" }} />
      </label>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button className="btn ghost sm" type="button" disabled={!dirty || !!busy} onClick={() => act("text", { action: "text", reading: text }, "Reading saved.")}>{busy === "text" ? "Saving…" : "Save text"}</button>
        {d.status !== "approved" && d.status !== "sent" && <button className="btn iris sm" type="button" disabled={dirty || !!busy} onClick={() => act("ok", { action: "status", status: "approved" }, "Approved.")}>Approve</button>}
        {d.status !== "skipped" && d.status !== "sent" && <button className="btn ghost sm" type="button" disabled={!!busy} onClick={() => act("skip", { action: "status", status: "skipped" }, "Skipped.")}>Skip</button>}
        {d.status === "skipped" && <button className="btn ghost sm" type="button" disabled={!!busy} onClick={() => act("back", { action: "status", status: "draft" }, "Back to draft.")}>Restore</button>}
        {(d.status === "approved" || d.status === "sent") && (
          <>
            <a className="btn sun sm" href={`${src}&dl=1`} download>Download PNG</a>
            <button className="btn ghost sm" type="button" disabled={dirty} onClick={async () => {
              const url = `https://www.dawns.money${d.path}`;
              const post = d.caption ? d.caption.replace("{reading}", text).replace("{url}", url) : `${text}\n\n${url}`;
              try { await navigator.clipboard.writeText(post); toast("Post text copied. Attach the PNG on X."); } catch { toast("Couldn't copy."); }
            }}>{d.kind === "opp" && d.caption ? "Copy Capital Report" : "Copy post text"}</button>
            {canTelegram && (confirm
              ? <button className="btn sun sm" type="button" disabled={!!busy} onClick={() => act("tg", { action: "telegram" }, "Posted to the Telegram channel.")}>{busy === "tg" ? "Sending…" : "Confirm: post to channel"}</button>
              : <button className="btn ghost sm" type="button" disabled={dirty || !!busy} onClick={() => setConfirm(true)}>{d.status === "sent" ? "Send to Telegram again" : "Send to Telegram"}</button>)}
          </>
        )}
      </div>
      {dirty && <p className="muted" style={{ fontSize: 13, margin: 0 }}>Save the text to update the image before approving or posting.</p>}
    </div>
  );
}
