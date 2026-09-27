"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { PROV, P, RULES, type RuleKey } from "@/lib/data";
import { usd } from "@/lib/format";
import { Bell, Close } from "./icons";
import { Pill, ProtocolCoin } from "./bits";
import { Fresh } from "./Fresh";

/* ---------- watch store (localStorage, per viewer) ---------- */
export type RuleState = { on: boolean; v: number | null };
export type WatchEntry = { rules: Partial<Record<RuleKey, RuleState>>; ch: string[]; example?: boolean };
export type WatchMap = Record<string, WatchEntry>;

const KEY = "dawns.watch";
const SEEN = "dawns.seen";
let cache: WatchMap | null = null;
const listeners = new Set<() => void>();
const EMPTY: WatchMap = {};

function read(): WatchMap {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    cache = raw ? (JSON.parse(raw) as WatchMap) : {};
    if (!Object.keys(cache).length && !localStorage.getItem(SEEN)) {
      cache = { kaskad: { rules: { liq: { on: true, v: 500 }, util: { on: true, v: 70 }, large: { on: true, v: 50 }, tvl: { on: false, v: 15 }, contract: { on: true, v: null } }, ch: ["telegram"], example: true } };
      localStorage.setItem(SEEN, "1");
      localStorage.setItem(KEY, JSON.stringify(cache));
    }
  } catch {
    cache = {};
  }
  return cache;
}
function write(next: WatchMap) {
  cache = next;
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => { listeners.add(l); return () => listeners.delete(l); };

export function useWatchMap(): WatchMap {
  return useSyncExternalStore(subscribe, read, () => EMPTY);
}

/* ---------- context ---------- */
type Ctx = { openProv: (id: string) => void; openWatch: (id: string) => void; toast: (t: string) => void };
const UICtx = createContext<Ctx | null>(null);
export function useUI() {
  const c = useContext(UICtx);
  if (!c) throw new Error("useUI outside AppProviders");
  return c;
}

export function AppProviders({ children }: { children: React.ReactNode }) {
  const [prov, setProv] = useState<string | null>(null);
  const [watch, setWatch] = useState<string | null>(null);
  const [toastMsg, setToast] = useState<string | null>(null);
  const tRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toast = useCallback((t: string) => {
    setToast(t);
    if (tRef.current) clearTimeout(tRef.current);
    tRef.current = setTimeout(() => setToast(null), 2600);
  }, []);
  const close = useCallback(() => { setProv(null); setWatch(null); }, []);

  useEffect(() => {
    const open = prov || watch;
    document.body.style.overflow = open ? "hidden" : "";
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prov, watch, close]);

  return (
    <UICtx.Provider value={{ openProv: setProv, openWatch: setWatch, toast }}>
      {children}
      {prov && <ProvDrawer id={prov} onClose={close} />}
      {watch && <WatchModal id={watch} onClose={close} toast={toast} />}
      {toastMsg && <div className="toast" role="status">{toastMsg}</div>}
    </UICtx.Provider>
  );
}

function ProvDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const d = PROV[id];
  const x = useRef<HTMLButtonElement>(null);
  useEffect(() => { x.current?.focus(); }, []);
  if (!d) return null;
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label="How this was calculated">
        <button ref={x} className="x" type="button" onClick={onClose} aria-label="Close"><Close /></button>
        <span className="eyebrow" style={{ color: "#FFC28A" }}>How dawns calculated this</span>
        <div>
          <div className="muted" style={{ fontSize: 15, marginBottom: 8 }}>{d.label}</div>
          <div className="big">{d.value}</div>
        </div>
        <dl className="trail">
          {d.trail.map(([k, v]) => (<div key={k}><dt>{k}</dt><dd>{v}</dd></div>))}
          <div><dt>Checked</dt><dd><Fresh /> ago</dd></div>
        </dl>
        {d.note && <div className="note">{d.note}</div>}
        <p className="foot" style={{ margin: 0 }}>In the live version each step links to the contract and block on the explorer.</p>
      </aside>
    </>
  );
}

function WatchModal({ id, onClose, toast }: { id: string; onClose: () => void; toast: (t: string) => void }) {
  const p = P[id];
  const map = useWatchMap();
  const w = map[id];
  const rules = RULES[p.cat];
  const main = rules[0];
  const rest = rules.slice(1);
  const L = p.cat === "Lending";
  const [mn, mx, st] = L ? [100, 850, 10] : [5, 50, 1];
  const fmt = (v: number) => (L ? `$${v}K` : `${v}%`);

  const [mainV, setMainV] = useState<number>(w?.rules[main.key]?.v ?? main.def ?? mn);
  const [state, setState] = useState(() =>
    Object.fromEntries(rest.map((r) => [r.key, { on: w?.rules[r.key]?.on ?? r.key !== "tvl", v: w?.rules[r.key]?.v ?? r.def }])) as Record<RuleKey, RuleState>,
  );
  const [ch, setCh] = useState<string[]>(w?.ch ?? ["inapp"]);

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    const rs: WatchEntry["rules"] = { [main.key]: { on: true, v: mainV }, ...state };
    write({ ...read(), [id]: { rules: rs, ch } });
    onClose();
    toast(`Watching ${p.name}. ${Object.values(rs).filter((x) => x?.on).length} rules on.`);
  };
  const unwatch = () => {
    const next = { ...read() };
    delete next[id];
    write(next);
    onClose();
    toast(`Stopped watching ${p.name}.`);
  };

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <form className="modal" role="dialog" aria-modal="true" aria-label={`Watch ${p.name}`} onSubmit={save}>
        <button className="x" type="button" onClick={onClose} aria-label="Close"><Close /></button>
        <h2><ProtocolCoin p={p} size={40} />Watch {p.name} <Pill t={p.status}>{p.statusText}</Pill></h2>
        <p className="desc">dawns checks {p.name} at every block and tells you when something crosses a line you set. You decide what to do about it.</p>
        <div>
          <div className="slide-lab">{L ? "Alert me if available liquidity falls below" : "Alert me if a pool loses more than this in 24h"}</div>
          <div className="slide-val">{fmt(mainV)}</div>
          <input
            type="range" id={`v-${main.key}`} min={mn} max={mx} step={st} value={mainV} aria-label="Threshold"
            style={{ ["--f" as string]: `${((mainV - mn) / (mx - mn)) * 100}%` }}
            onChange={(e) => setMainV(+e.target.value)}
          />
          <div className="ticks"><span>{fmt(mn)}</span><span>{L ? `today ${usd(p.tvl)}` : ""}</span><span>{fmt(mx)}</span></div>
        </div>
        <div className="rules">
          {rest.map((r) => (
            <div className="rule" key={r.key}>
              <label htmlFor={`r-${r.key}`}>{r.label}</label>
              {r.unit ? (
                <span className="thr">
                  {r.unit === "$K" ? "$" : ""}
                  <input id={`v-${r.key}`} type="number" inputMode="decimal" aria-label="Threshold" value={state[r.key].v ?? ""}
                    onChange={(e) => setState((s) => ({ ...s, [r.key]: { ...s[r.key], v: +e.target.value } }))} />
                  {r.unit === "$K" ? "K" : "%"}
                </span>
              ) : <span />}
              <span className="sw">
                <input type="checkbox" id={`r-${r.key}`} checked={state[r.key].on}
                  onChange={(e) => setState((s) => ({ ...s, [r.key]: { ...s[r.key], on: e.target.checked } }))} />
                <span />
              </span>
            </div>
          ))}
        </div>
        <div>
          <div className="eyebrow" style={{ marginBottom: 10, color: "var(--ink-3)" }}>Send alerts to</div>
          <div className="channels">
            {[["inapp", "In-app"], ["telegram", "Telegram"], ["email", "Email"]].map(([k, label]) => (
              <label key={k}>
                <input type="checkbox" checked={ch.includes(k)} onChange={(e) => setCh((c) => (e.target.checked ? [...c, k] : c.filter((x) => x !== k)))} />
                {label}
              </label>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, justifyContent: "space-between", flexWrap: "wrap" }}>
          {w ? <button className="btn ghost" type="button" onClick={unwatch}>Stop watching</button> : <span />}
          <button className="btn sun" type="submit"><Bell />{w ? "Save rules" : "Start watching"}</button>
        </div>
      </form>
    </>
  );
}
