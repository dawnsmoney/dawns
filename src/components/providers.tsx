"use client";
import { track } from "@/lib/track";

import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Provenance, RuleKey, Signal, Status } from "@/lib/types";
import { RULES, type Kind } from "@/lib/rules";
import { tgLink } from "@/lib/tglink";
import { usd } from "@/lib/format";
import { Bell, Close, External } from "./icons";
import { Pill, ProtocolCoin } from "./bits";

/* ---------- watch store (localStorage, per viewer) ---------- */
export type RuleState = { on: boolean; v: number | null };
export type WatchEntry = { rules: Partial<Record<RuleKey, RuleState>>; ch: string[] };
export type WatchMap = Record<string, WatchEntry>;

const KEY = "dawns.watch.v2";
let cache: WatchMap | null = null;
const listeners = new Set<() => void>();
const EMPTY: WatchMap = {};
function read(): WatchMap {
  if (cache) return cache;
  try { cache = JSON.parse(localStorage.getItem(KEY) || "{}") as WatchMap; } catch { cache = {}; }
  return cache;
}
function write(next: WatchMap) {
  cache = next;
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => { listeners.add(l); return () => listeners.delete(l); };
export function useWatchMap(): WatchMap { return useSyncExternalStore(subscribe, read, () => EMPTY); }

/* ---------- server copy: signed-in viewers keep their rules on dawns, so Telegram can use them ---------- */
type ServerState = { signedIn: boolean; telegram: boolean };
let server: ServerState = { signedIn: false, telegram: false };
const OFF: ServerState = { signedIn: false, telegram: false };
const serverListeners = new Set<() => void>();
export function useServerWatch(): ServerState {
  return useSyncExternalStore((l) => { serverListeners.add(l); return () => serverListeners.delete(l); }, () => server, () => OFF);
}
function putEntry(protocol: string, entry: WatchEntry | null) {
  if (!server.signedIn) return;
  fetch("/api/watch", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ protocol, entry }) }).catch(() => null);
}
/** Pull the server copy; server entries win, local-only entries are pushed up (first sign-in). */
async function syncWatch() {
  try {
    const r = await fetch("/api/watch", { cache: "no-store" });
    const j = (await r.json()) as { signedIn: boolean; telegram?: boolean; entries?: WatchMap };
    server = { signedIn: !!j.signedIn, telegram: !!j.telegram };
    serverListeners.forEach((l) => l());
    if (!j.signedIn) return;
    const local = read(), remote = j.entries ?? {};
    for (const [id, e] of Object.entries(local)) if (!remote[id]) putEntry(id, e);
    write({ ...local, ...remote });
  } catch { /* offline or no database: local rules still work */ }
}

/* ---------- registry: what the current page knows about protocols ---------- */
export type ProtoLite = { id: string; name: string; letter: string; status: Status; statusText: string; kind: Kind; tvl: number; floor: boolean };
type Registry = { prov: Record<string, Provenance>; protocols: Record<string, ProtoLite>; signals: Signal[] };

type Ctx = {
  openProv: (id: string) => void;
  openWatch: (id: string) => void;
  toast: (t: string) => void;
  registry: Registry;
  register: (r: Partial<Registry>) => void;
};
const UICtx = createContext<Ctx | null>(null);
export function useUI() {
  const c = useContext(UICtx);
  if (!c) throw new Error("useUI outside AppProviders");
  return c;
}

/** Hand server-built data to client widgets (drawer, watch modal, watchlist). */
export function DataBridge({ prov, protocols, signals }: { prov?: Record<string, Provenance>; protocols?: ProtoLite[]; signals?: Signal[] }) {
  const { register } = useUI();
  useEffect(() => {
    register({
      prov,
      protocols: protocols ? Object.fromEntries(protocols.map((p) => [p.id, p])) : undefined,
      signals,
    });
  }, [prov, protocols, signals, register]);
  return null;
}

export function AppProviders({ children }: { children: React.ReactNode }) {
  const [prov, setProv] = useState<string | null>(null);
  const [watch, setWatch] = useState<string | null>(null);
  const [toastMsg, setToast] = useState<string | null>(null);
  const [registry, setRegistry] = useState<Registry>({ prov: {}, protocols: {}, signals: [] });
  const tRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const register = useCallback((r: Partial<Registry>) => {
    setRegistry((cur) => ({
      prov: r.prov ? { ...cur.prov, ...r.prov } : cur.prov,
      protocols: r.protocols ? { ...cur.protocols, ...r.protocols } : cur.protocols,
      signals: r.signals ?? cur.signals,
    }));
  }, []);
  const toast = useCallback((t: string) => {
    setToast(t);
    if (tRef.current) clearTimeout(tRef.current);
    tRef.current = setTimeout(() => setToast(null), 2600);
  }, []);
  const close = useCallback(() => { setProv(null); setWatch(null); }, []);
  useEffect(() => {
    syncWatch();
    const again = () => { syncWatch(); };
    window.addEventListener("dawns:auth", again);
    return () => window.removeEventListener("dawns:auth", again);
  }, []);

  useEffect(() => {
    const open = prov || watch;
    document.body.style.overflow = open ? "hidden" : "";
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prov, watch, close]);

  return (
    <UICtx.Provider value={{ openProv: (id: string) => { track("prov_open", { id }); setProv(id); }, openWatch: setWatch, toast, registry, register }}>
      {children}
      {prov && registry.prov[prov] && <ProvDrawer d={registry.prov[prov]} onClose={close} />}
      {watch && registry.protocols[watch] && <WatchModal p={registry.protocols[watch]} onClose={close} toast={toast} />}
      {toastMsg && <div className="toast" role="status">{toastMsg}</div>}
    </UICtx.Provider>
  );
}

function ProvDrawer({ d, onClose }: { d: Provenance; onClose: () => void }) {
  const x = useRef<HTMLButtonElement>(null);
  useEffect(() => { x.current?.focus(); }, []);
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
          {d.trail.map(([k, v], i) => (<div key={i}><dt>{k}</dt><dd>{v}</dd></div>))}
        </dl>
        {d.note && <div className="note">{d.note}</div>}
        {d.links && d.links.length > 0 && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {d.links.map((l) => (<a key={l} className="btn ghost sm" href={l} target="_blank" rel="noopener noreferrer"><External />{l.includes("/block/") ? "Block on explorer" : "Contract on explorer"}</a>))}
          </div>
        )}
      </aside>
    </>
  );
}

function WatchModal({ p, onClose, toast }: { p: ProtoLite; onClose: () => void; toast: (t: string) => void }) {
  const map = useWatchMap();
  const w = map[p.id];
  const rules = RULES[p.kind];
  const main = rules[0];
  const rest = rules.slice(1);
  const L = p.kind === "lending";
  const sliderMode = main.unit === "$K" ? "usd" : "pct";
  const [mn, mx, st] = sliderMode === "usd" ? [50, Math.max(100, Math.ceil((p.tvl * 1.5) / 1000 / 50) * 50), 10] : [5, 50, 1];
  const fmt = (v: number) => (sliderMode === "usd" ? `$${v}K` : `${v}%`);

  const [mainV, setMainV] = useState<number>(w?.rules[main.key]?.v ?? main.def ?? mn);
  const [state, setState] = useState(() =>
    Object.fromEntries(rest.map((r) => [r.key, { on: w?.rules[r.key]?.on ?? r.key !== "tvl", v: w?.rules[r.key]?.v ?? r.def }])) as Record<RuleKey, RuleState>,
  );
  const [ch, setCh] = useState<string[]>(w?.ch ?? ["inapp"]);
  const tg = tgLink(`watch_${p.id}`);
  const srv = useServerWatch();

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    const rs: WatchEntry["rules"] = { [main.key]: { on: true, v: mainV }, ...state };
    write({ ...read(), [p.id]: { rules: rs, ch } });
    putEntry(p.id, { rules: rs, ch });
    onClose();
    track("watch_saved", { protocol: p.id });
    toast(`Watching ${p.name}. ${Object.values(rs).filter((x) => x?.on).length} rules on.`);
  };
  const unwatch = () => {
    const next = { ...read() };
    delete next[p.id];
    write(next);
    putEntry(p.id, null);
    onClose();
    track("watch_removed", { protocol: p.id });
    toast(`Stopped watching ${p.name}.`);
  };

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <form className="modal" role="dialog" aria-modal="true" aria-label={`Watch ${p.name}`} onSubmit={save}>
        <button className="x" type="button" onClick={onClose} aria-label="Close"><Close /></button>
        <h2><ProtocolCoin p={p} size={40} />Watch {p.name} <Pill t={p.status}>{p.statusText}</Pill></h2>
        <p className="desc">dawns checks {p.name} and tells you when something crosses a line you set. You decide what to do about it. Rules are saved in this browser, and to your profile when you are signed in. With Telegram connected to your profile, dawns alerts you on these exact thresholds.</p>
        <div>
          <div className="slide-lab">{main.key === "liq" && L ? "Alert me if available liquidity falls below" : main.label}</div>
          <div className="slide-val">{fmt(mainV)}</div>
          <input
            type="range" id={`v-${main.key}`} min={mn} max={mx} step={st} value={Math.min(mx, Math.max(mn, mainV))} aria-label="Threshold"
            style={{ ["--f" as string]: `${((Math.min(mx, Math.max(mn, mainV)) - mn) / (mx - mn)) * 100}%` }}
            onChange={(e) => setMainV(+e.target.value)}
          />
          <div className="ticks"><span>{fmt(mn)}</span><span>{sliderMode === "usd" ? `today ${usd(p.tvl)}` : ""}</span><span>{fmt(mx)}</span></div>
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
            <label>
              <input type="checkbox" checked={ch.includes("inapp")} onChange={(e) => setCh((c) => (e.target.checked ? [...c, "inapp"] : c.filter((x) => x !== "inapp")))} />
              In-app
            </label>
            {srv.signedIn && srv.telegram ? (
              <label>
                <input type="checkbox" checked={ch.includes("telegram")} onChange={(e) => setCh((c) => (e.target.checked ? [...c, "telegram"] : c.filter((x) => x !== "telegram")))} />
                Telegram, with these thresholds
              </label>
            ) : srv.signedIn ? (
              <a className="btn ghost sm" href="/allocate"><Bell />Connect Telegram to use these thresholds</a>
            ) : tg ? (
              <a className="btn ghost sm" href={tg} target="_blank" rel="noopener noreferrer" onClick={() => { track("telegram_click", { protocol: p.id }); setCh((c) => (c.includes("telegram") ? c : [...c, "telegram"])); }}>
                <Bell />{ch.includes("telegram") ? "Telegram connected · open again" : "Get alerts on Telegram"}
              </a>
            ) : <label><input type="checkbox" disabled />Telegram (soon)</label>}
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
