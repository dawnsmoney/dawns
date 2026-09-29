"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Pill } from "./bits";
import { SplitBar } from "./viz";
import { ApyWaterfall, ExitStack } from "./strategy";
import { LEG_COLORS, splitParts } from "@/lib/strategies/parts";
import { DEFAULT_DOC, MAX_LEGS, PAUSE, evaluate, parseDoc, strategyId, type PauseRule, type StrategyDoc } from "@/lib/strategies/model";
import type { Opportunity } from "@/lib/types";
import { pct, usd } from "@/lib/format";
import { loadAccount, shortAddr, type Account } from "./wallet";
import { openConnect } from "./connect";

const bp = (b: number) => `${(b / 100).toFixed(b % 100 ? 1 : 0)}%`;

function Seg<T extends string | number>({ items, value, onPick, label }: { items: [T, string][]; value: T; onPick: (v: T) => void; label: string }) {
  return (
    <div className="st-seg" role="radiogroup" aria-label={label}>
      {items.map(([k, l]) => <button key={String(k)} type="button" role="radio" aria-checked={value === k} className={value === k ? "on" : ""} onClick={() => onPick(k)}>{l}</button>)}
    </div>
  );
}

/** A slider drawn as a bar: drag or click to set, arrow keys step by 1%. */
function Slide({ value, max, onChange, color, cap, label }: { value: number; max: number; onChange: (v: number) => void; color: string; cap?: number; label: string }) {
  const set = (clientX: number, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    onChange(Math.max(100, Math.min(max, Math.round(((clientX - r.left) / r.width) * 10_000 / 100) * 100)));
  };
  return (
    <span className="st-slide" role="slider" tabIndex={0} aria-label={label} aria-valuemin={1} aria-valuemax={max / 100} aria-valuenow={value / 100}
      onPointerDown={(e) => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); set(e.clientX, e.currentTarget); }}
      onPointerMove={(e) => { if (e.buttons) set(e.clientX, e.currentTarget); }}
      onKeyDown={(e) => { if (e.key === "ArrowRight" || e.key === "ArrowUp") { e.preventDefault(); onChange(Math.min(max, value + 100)); } if (e.key === "ArrowLeft" || e.key === "ArrowDown") { e.preventDefault(); onChange(Math.max(100, value - 100)); } }}>
      <i style={{ width: `${value / 100}%`, background: color }} />
      {cap != null && <em style={{ left: `${cap / 100}%` }} />}
      <b style={{ left: `${value / 100}%`, borderColor: color }} />
    </span>
  );
}

export function StrategyBuilder({ opps, kasUsd, from, start }: { opps: Opportunity[]; kasUsd: number | null; from?: { id: string; version: number; doc: StrategyDoc } | null; start?: StrategyDoc | null }) {
  const router = useRouter();
  const [doc, setDoc] = useState<StrategyDoc>(from ? from.doc : start ?? { ...DEFAULT_DOC, name: "", thesis: "" });
  const [kind, setKind] = useState<"all" | "supply" | "lp">("all");
  const [account, setAccount] = useState<Account | undefined>(undefined);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const ev = useMemo(() => evaluate(doc, opps, kasUsd), [doc, opps, kasUsd]);
  const parsed = useMemo(() => parseDoc(doc), [doc]);
  const id = "doc" in parsed ? strategyId(parsed.doc) : null;
  const legSum = doc.legs.reduce((s, l) => s + l.target, 0);
  useEffect(() => { loadAccount().then(setAccount).catch(() => setAccount(null)); }, []);

  const set = (p: Partial<StrategyDoc>) => setDoc((d) => ({ ...d, ...p }));
  const setVault = (p: Partial<StrategyDoc["vault"]>) => setDoc((d) => ({ ...d, vault: { ...d.vault, ...p } }));
  /** Targets move; the reserve takes up the rest (never below zero). */
  const withLegs = (legs: StrategyDoc["legs"]) => {
    const sum = legs.reduce((s, l) => s + l.target, 0);
    set({ legs, reserveBps: Math.max(0, 10_000 - sum) });
  };
  const add = (o: Opportunity) => {
    if (doc.legs.length >= MAX_LEGS || doc.legs.some((l) => l.opp === o.id)) return;
    const room = Math.max(100, Math.min(3_000, 10_000 - legSum - 1_000));
    withLegs([...doc.legs, { opp: o.id, target: room, cap: Math.min(10_000, room + 1_000) }]);
  };
  const setLeg = (i: number, p: Partial<StrategyDoc["legs"][number]>) => {
    const legs = doc.legs.map((l, j) => (j === i ? { ...l, ...p } : l));
    const others = legs.reduce((s, l, j) => s + (j === i ? 0 : l.target), 0);
    legs[i].target = Math.min(legs[i].target, 10_000 - others);
    legs[i].cap = Math.max(legs[i].cap, legs[i].target);
    withLegs(legs);
  };
  const drop = (i: number) => withLegs(doc.legs.filter((_, j) => j !== i));
  const togglePause = (p: PauseRule) => set({ pause: doc.pause.includes(p) ? doc.pause.filter((x) => x !== p) : [...doc.pause, p] });

  const ensureAccount = async () => {
    if (account !== undefined) return account;
    const a = await loadAccount().catch(() => null);
    setAccount(a); return a;
  };
  const publish = async (signIn?: boolean) => {
    setMsg(null);
    if ("error" in parsed) { setMsg(parsed.error); return; }
    setBusy("publish");
    try {
      let a = await ensureAccount();
      if (!a && signIn) { a = await openConnect().catch(() => null); setAccount(a); }
      if (!a) { setMsg("Sign in with a wallet to publish: it becomes the strategist."); return; }
      const r = await fetch("/api/strategies", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ doc: parsed.doc, parent: from?.id ?? null }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      router.push(`/strategies/${j.id}`);
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(null); }
  };

  const list = opps.filter((o) => kind === "all" || o.kind === kind);
  return (
    <div className="st-build">
      <div className="st-form">
        {from && (
          <div className="card st-vcard scheduled">
            <b>New version of v{from.version}</b>
            <small className="muted">It takes effect {from.doc.noticeDays} days after you publish (the notice period of v{from.version}). Until then v{from.version} stays in force and the strategy page shows depositors every change. Changing the notice period itself also waits for the current notice.</small>
          </div>
        )}
        <div className="card">
          <div className="c-head"><h3>1 · Name and thesis</h3></div>
          <div style={{ display: "grid", gap: 10 }}>
            <input className="search" placeholder="Name, e.g. Stablecoin lending, exits first" value={doc.name} maxLength={60} onChange={(e) => set({ name: e.target.value })} aria-label="Strategy name" />
            <textarea className="search st-ta" placeholder="Why this split: where the yield comes from, what can go wrong, who it is for." value={doc.thesis} maxLength={600} rows={3} onChange={(e) => set({ thesis: e.target.value })} aria-label="Thesis" />
          </div>
        </div>

        <div className="card">
          <div className="c-head"><h3>2 · Opportunities</h3><span className="tag">{doc.legs.length} of {MAX_LEGS} slots</span></div>
          <Seg label="Kind" items={[["all", "All"], ["supply", "Lending"], ["lp", "Liquidity"]]} value={kind} onPick={setKind} />
          <div className="st-opps">
            {list.map((o) => {
              const inIt = doc.legs.findIndex((l) => l.opp === o.id);
              return (
                <button key={o.id} type="button" className={`st-opp${inIt >= 0 ? " on" : ""}`} disabled={inIt < 0 && doc.legs.length >= MAX_LEGS} onClick={() => (inIt >= 0 ? drop(inIt) : add(o))}>
                  <i style={{ background: inIt >= 0 ? LEG_COLORS[inIt] : "transparent" }}>{inIt >= 0 ? "✓" : "+"}</i>
                  <span><b>{o.name}</b><small>{o.pname} · {o.apyShort}</small></span>
                  <span className="st-opp-r"><b>{o.apy != null ? pct(o.apy, 1) : "—"}</b><Pill t={o.status}>{o.statusText}</Pill></span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="card">
          <div className="c-head"><h3>3 · Targets and hard caps</h3><span className="tag">reserve {bp(doc.reserveBps)}</span></div>
          {doc.legs.length === 0 ? <p className="muted" style={{ margin: 0 }}>Pick an opportunity above.</p> : (
            <div className="st-legset">
              {doc.legs.map((l, i) => {
                const o = opps.find((x) => x.id === l.opp);
                return (
                  <div key={l.opp} className="st-legedit">
                    <span className="st-leg-n"><i style={{ background: LEG_COLORS[i] }} /><span><b>{o?.name ?? l.opp}</b><small>{o?.pname}</small></span></span>
                    <Slide label={`${o?.name} target`} value={l.target} max={10_000} color={LEG_COLORS[i]} cap={l.cap} onChange={(v) => setLeg(i, { target: v })} />
                    <label>Target <b>{bp(l.target)}</b></label>
                    <Slide label={`${o?.name} cap`} value={l.cap} max={10_000} color="rgba(255,255,255,.28)" onChange={(v) => setLeg(i, { cap: Math.max(v, l.target) })} />
                    <label>Hard cap <b>{bp(l.cap)}</b></label>
                    <button type="button" className="btn ghost sm" onClick={() => drop(i)}>Remove</button>
                  </div>
                );
              })}
              <div className="st-legedit reserve"><span className="st-leg-n"><i style={{ background: "#6E6788" }} /><span><b>Reserve</b><small>What is not in a leg stays in the vault as KAS and pays redemptions at once.</small></span></span><b style={{ font: "600 20px var(--display)" }}>{bp(doc.reserveBps)}</b></div>
            </div>
          )}
        </div>

        <div className="card">
          <div className="c-head"><h3>4 · Rules</h3></div>
          <div className="st-fields">
            <span>Stop new capital on</span>
            <div className="st-chips">{(Object.keys(PAUSE) as PauseRule[]).map((p) => <button key={p} type="button" className={doc.pause.includes(p) ? "on" : ""} aria-pressed={doc.pause.includes(p)} onClick={() => togglePause(p)} title={PAUSE[p].why}>{PAUSE[p].label}</button>)}</div>
            <span>Most in one protocol</span>
            <Seg label="Most in one protocol" items={[[4_000, "40%"], [6_000, "60%"], [8_000, "80%"], [10_000, "100%"]]} value={doc.maxProtocolBps} onPick={(v) => set({ maxProtocolBps: v })} />
            <span>Lending cash cover</span>
            <Seg label="Exit cover" items={[[1, "1×"], [2, "2×"], [3, "3×"], [5, "5×"]]} value={doc.exitCover} onPick={(v) => set({ exitCover: v })} />
            <span>Rebalance at drift</span>
            <Seg label="Drift" items={[[250, "2.5%"], [500, "5%"], [1_000, "10%"]]} value={doc.driftBps} onPick={(v) => set({ driftBps: v })} />
          </div>
        </div>

        <div className="card">
          <div className="c-head"><h3>5 · Vault terms and fee</h3></div>
          <div className="st-fields">
            <span>Vault</span>
            <Seg label="Vault type" items={[["nav", "NAV · open term"], ["fixed", "Fixed term"]]} value={doc.vault.type} onPick={(v) => setVault(v === "fixed" ? { type: v, termDays: doc.vault.termDays || 90, depositDays: doc.vault.depositDays || 14 } : { type: v, termDays: 0, depositDays: 0 })} />
            {doc.vault.type === "fixed" && <>
              <span>Term</span>
              <Seg label="Term" items={[[30, "30 d"], [90, "90 d"], [180, "180 d"], [365, "1 y"]]} value={doc.vault.termDays} onPick={(v) => setVault({ termDays: v, depositDays: Math.min(doc.vault.depositDays, v - 1) })} />
              <span>Deposit window</span>
              <Seg label="Deposit window" items={[[7, "7 d"], [14, "14 d"], [30, "30 d"]]} value={doc.vault.depositDays} onPick={(v) => setVault({ depositDays: v })} />
            </>}
            <span>Access</span>
            <Seg label="Access" items={[["permissionless", "Permissionless"], ["whitelist", "Whitelist"], ["private", "Private"]]} value={doc.vault.access} onPick={(v) => setVault({ access: v })} />
            <span>Capacity</span>
            <Seg label="Capacity" items={[[10_000, "10K KAS"], [50_000, "50K"], [100_000, "100K"], [500_000, "500K"]]} value={doc.vault.capacityKas} onPick={(v) => setVault({ capacityKas: v })} />
            {doc.vault.type === "nav" && <>
              <span>Redemption window</span>
              <Seg label="Redemption window" items={[[0, "From reserve"], [3, "≤ 3 d"], [7, "≤ 7 d"]]} value={doc.vault.redemptionDays} onPick={(v) => setVault({ redemptionDays: v })} />
            </>}
            <span>Exit fee (to holders)</span>
            <Seg label="Exit fee" items={[[0, "0"], [25, "0.25%"], [50, "0.5%"], [100, "1%"]]} value={doc.vault.exitFeeBps} onPick={(v) => setVault({ exitFeeBps: v })} />
            <span>Notice for new versions</span>
            <Seg label="Notice period" items={[[3, "3 d"], [7, "7 d"], [14, "14 d"], [30, "30 d"]]} value={doc.noticeDays} onPick={(v) => set({ noticeDays: v })} />
            <span>Performance fee (on yield)</span>
            <Seg label="Performance fee" items={[[0, "0"], [500, "5%"], [1_000, "10%"], [1_500, "15%"], [2_000, "20%"]]} value={doc.fees.performanceBps} onPick={(v) => set({ fees: { ...doc.fees, performanceBps: v } })} />
          </div>
        </div>
      </div>

      {doc.legs.length > 0 && (
        <a className="st-mbar" href="#st-preview" aria-label="Jump to the live preview">
          <span><small>Net APY</small><b>{ev.net != null ? pct(ev.net, 1) : "—"}</b></span>
          <span><small>Out now</small><b>{pct(ev.exitNow, 0)}</b></span>
          <span><small>Reserve</small><b>{bp(doc.reserveBps)}</b></span>
          <Pill t={ev.status}>{ev.statusText}</Pill>
        </a>
      )}
      <aside className="st-preview" id="st-preview">
        <div className="card">
          <div className="c-head"><h3>{doc.name || "Your strategy"}</h3><Pill t={doc.legs.length ? ev.status : "info"}>{doc.legs.length ? ev.statusText : "Empty"}</Pill></div>
          {doc.legs.length > 0 ? (
            <div style={{ display: "grid", gap: 20 }}>
              <SplitBar parts={splitParts(doc, ev)} label="Split" height={20} />
              <div className="st-mini">
                <span><small>Net APY</small><b>{ev.net != null ? pct(ev.net, 2) : "—"}</b></span>
                <span><small>Out now</small><b>{pct(ev.exitNow, 0)}</b></span>
                <span><small>Capacity</small><b>{ev.capacityUsd ? usd(ev.capacityUsd) : `${doc.vault.capacityKas / 1000}K KAS`}</b></span>
              </div>
              <ApyWaterfall ev={ev} />
              <ExitStack doc={doc} ev={ev} />
              <div className="st-checks sm">
                {ev.checks.filter((c) => !c.ok).map((c) => <div key={c.key} className={`st-check ${c.t}`}><i aria-hidden>{c.t === "crit" ? "✕" : "!"}</i><span><b>{c.label}</b><small>{c.detail}</small></span></div>)}
                {ev.legs.flatMap((l) => l.flags.filter((f) => f.t !== "info").map((f) => <div key={l.leg.opp + f.text} className={`st-check ${f.t}`}><i aria-hidden>!</i><span><b>{l.o?.name}</b><small>{f.text}</small></span></div>))}
              </div>
            </div>
          ) : <p className="muted" style={{ margin: 0 }}>Pick opportunities: the preview computes as you go, from live data.</p>}
        </div>
        <div className="card st-pub">
          <small className="muted">{"error" in parsed ? parsed.error : <>Hash id <span className="mono">{id}</span>. {from ? (from.id === id ? "Nothing has changed from the version in force yet." : `Publishing schedules v${from.version + 1} for ${from.doc.noticeDays} days from now.`) : "Publishing freezes this version: later changes are new versions, after notice."}</>}</small>
          {account ? (
            <button type="button" className="btn iris" disabled={!!busy || "error" in parsed} onClick={() => publish()}>{busy ? "Publishing…" : `Publish as ${shortAddr(account.wallets[0]?.address ?? "")}`}</button>
          ) : (
            <button type="button" className="btn iris" disabled={!!busy || "error" in parsed} onClick={() => publish(true)}>{busy ? "Check your wallet…" : "Connect a wallet and publish"}</button>
          )}
          {msg && <p className="navp-err" style={{ margin: 0 }}>{msg}</p>}
        </div>
      </aside>
    </div>
  );
}
