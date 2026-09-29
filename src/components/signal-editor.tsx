"use client";

import { useState } from "react";
import type { SignalData, SignalItem } from "@/lib/signal";

const post = async (body: unknown) => {
  const r = await fetch("/api/admin/signal", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error ?? "Failed");
  return j as Record<string, unknown>;
};

/** Edit one week's Signal: title, intro, the items (reword, reorder, drop), then publish, post to Telegram, copy the X thread. */
export function SignalEditor({ id, data, status, telegramAt, site, canTelegram }: { id: string; data: SignalData; status: string; telegramAt: string | null; site: string; canTelegram: boolean }) {
  const [d, setD] = useState<SignalData>(data);
  const [msg, setMsg] = useState<string | null>(null);
  const [st, setSt] = useState(status);
  const setItem = (i: number, p: Partial<SignalItem>) => setD({ ...d, items: d.items.map((x, j) => (j === i ? { ...x, ...p } : x)) });
  const move = (i: number, k: number) => { const it = [...d.items]; const [x] = it.splice(i, 1); it.splice(Math.max(0, Math.min(it.length, i + k)), 0, x); setD({ ...d, items: it }); };
  const run = (label: string, f: () => Promise<unknown>) => async () => { setMsg("…"); try { await f(); setMsg(label); } catch (e) { setMsg((e as Error).message); } };
  const tweets = [`${d.title}\n\n${d.intro}`, ...d.items.map((x, i) => `${String(i + 1).padStart(2, "0")} · ${x.head}\n\n${x.line}${x.href ? `\n\n${site}${x.href}` : ""}`), `Every figure is read on-chain, with how it was calculated.\n\n${site}/signal/${d.week}`];
  // X counts every link as 23 characters
  const xlen = (t: string) => t.replace(/https?:\/\/\S+/g, "x".repeat(23)).length;
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <label className="cl-field"><span><b>Title</b></span><input className="search" value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} /></label>
      <label className="cl-field"><span><b>Intro</b></span><input className="search" value={d.intro} onChange={(e) => setD({ ...d, intro: e.target.value })} /></label>
      {d.items.map((x, i) => (
        <div key={x.key} className="card" style={{ display: "grid", gap: 8, padding: 14 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}><b>{String(i + 1).padStart(2, "0")}</b><span className="muted" style={{ fontSize: 12.5 }}>{x.href ?? "no link"} · {xlen(tweets[i + 1])}/280 on X</span>
            <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}><button type="button" className="btn ghost sm" onClick={() => move(i, -1)}>↑</button><button type="button" className="btn ghost sm" onClick={() => move(i, 1)}>↓</button><button type="button" className="btn ghost sm" onClick={() => setD({ ...d, items: d.items.filter((_, j) => j !== i) })}>Drop</button></span></div>
          <input className="search" value={x.head} onChange={(e) => setItem(i, { head: e.target.value })} />
          <textarea className="search" rows={2} value={x.line} onChange={(e) => setItem(i, { line: e.target.value })} />
        </div>
      ))}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <button type="button" className="btn ghost" onClick={run("Saved", () => post({ action: "save", id, data: d }))}>Save</button>
        {st !== "published"
          ? <button type="button" className="btn sun" onClick={run("Published on /signal", async () => { await post({ action: "save", id, data: d }); await post({ action: "publish", id }); setSt("published"); })}>Save and publish</button>
          : <button type="button" className="btn ghost" onClick={run("Back to draft", async () => { await post({ action: "unpublish", id }); setSt("draft"); })}>Unpublish</button>}
        {canTelegram && st === "published" && <button type="button" className="btn ghost" onClick={run("Posted to Telegram", () => post({ action: "telegram", id }))}>{telegramAt ? "Post to Telegram again" : "Post to Telegram"}</button>}
        <button type="button" className="btn ghost" onClick={run("X thread copied", () => navigator.clipboard.writeText(tweets.join("\n\n———\n\n")))}>Copy the X thread</button>
        {msg && <small className="muted">{msg}</small>}
      </div>
    </div>
  );
}

/** Remake this week's draft from today's data (a published issue is never overwritten). */
export function SignalDraftButton() {
  const [msg, setMsg] = useState<string | null>(null);
  return <span style={{ display: "inline-flex", gap: 10, alignItems: "center" }}><button type="button" className="btn ghost sm" onClick={async () => { setMsg("…"); try { const r = await post({ action: "draft" }); setMsg(String(r.result)); location.reload(); } catch (e) { setMsg((e as Error).message); } }}>Draft this week from today&apos;s data</button>{msg && <small className="muted">{msg}</small>}</span>;
}
