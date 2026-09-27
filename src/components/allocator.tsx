"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AssetCoin, Pill } from "./bits";
import { allocate, parsePolicy, DEFAULT_POLICY, type Avoid, type ExitNeed, type Policy, type Risk } from "@/lib/allocator";
import { usd, pct } from "@/lib/format";
import type { Opportunity } from "@/lib/types";
import { loadAccount, shortAddr, signInWith, signOut, useWalletOptions, type Account } from "./wallet";

const RISKS: [Risk, string, string][] = [
  ["low", "Low", "Stablecoins only. Smallest positions."],
  ["medium", "Medium", "Lending and calm pools. Caps per protocol."],
  ["high", "High", "Anything that is open, including volatile pools."],
];
const EXITS: [ExitNeed, string, string][] = [
  ["instant", "Any moment", "Markets must hold 3× your position in cash"],
  ["days", "Within days", "1.5× your position"],
  ["weeks", "Within weeks", "At least your position"],
];
const AVOIDS: [Avoid, string][] = [["lp", "Liquidity pools"], ["lending", "Lending"], ["v3", "Concentrated liquidity"]];

function Choice<T extends string>({ items, value, onPick }: { items: [T, string, string][]; value: T; onPick: (v: T) => void }) {
  return (
    <div className="grid g3" style={{ gap: 10 }}>
      {items.map(([k, label, hint]) => (
        <button key={k} type="button" onClick={() => onPick(k)} className="card" aria-pressed={value === k}
          style={{ textAlign: "left", padding: "14px 16px", cursor: "pointer", border: `1px solid ${value === k ? "rgba(123,108,255,.8)" : "var(--line-2)"}`, background: value === k ? "rgba(123,108,255,.18)" : undefined }}>
          <b style={{ fontFamily: "var(--display)", fontSize: 16 }}>{label}</b>
          <small className="muted" style={{ display: "block", marginTop: 4 }}>{hint}</small>
        </button>
      ))}
    </div>
  );
}

export function Allocator({ opps }: { opps: Opportunity[] }) {
  const [policy, setPolicy] = useState<Policy>(DEFAULT_POLICY);
  const [amountText, setAmountText] = useState(String(DEFAULT_POLICY.amount));
  const [account, setAccount] = useState<Account>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [showOut, setShowOut] = useState(false);
  const wallets = useWalletOptions();
  const plan = useMemo(() => allocate(opps, policy), [opps, policy]);
  const saved = account?.policy ? parsePolicy(account.policy) : null;
  const dirty = !saved || JSON.stringify(saved) !== JSON.stringify(policy);

  const adopt = (a: Account) => {
    setAccount(a);
    const p = a?.policy ? parsePolicy(a.policy) : null;
    if (p) { setPolicy(p); setAmountText(String(p.amount)); }
  };
  useEffect(() => { loadAccount().then(adopt).catch(() => null); }, []);

  const set = (patch: Partial<Policy>) => setPolicy((p) => ({ ...p, ...patch }));
  const connect = async (key: string) => {
    setBusy(key); setMsg(null);
    try { adopt(await signInWith(key)); setMsg("Signed in. Your profile is saved to this wallet."); }
    catch (e) { setMsg((e as Error).message); }
    finally { setBusy(null); }
  };
  const save = async () => {
    setBusy("save"); setMsg(null);
    try {
      const r = await fetch("/api/profile", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ policy }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setAccount(j); setMsg("Profile saved.");
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(null); }
  };
  const out = async () => { await signOut(); setAccount(null); setMsg("Signed out."); };

  const placed = plan.lines.reduce((s, l) => s + l.usd, 0);
  return (
    <div style={{ display: "grid", gap: 26 }}>
      {/* ---- account ---- */}
      <div className="card" style={{ display: "flex", gap: 16, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
        {account ? (
          <>
            <div>
              <b style={{ fontFamily: "var(--display)" }}>Signed in</b>
              <small className="muted" style={{ display: "block" }}>{account.wallets.map((w) => `${w.kind === "kaspa" ? "Kaspa" : "EVM"} ${shortAddr(w.address)}`).join(" · ")}</small>
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {wallets.filter((w) => w.installed && !account.wallets.some((x) => x.kind === w.kind)).slice(0, 1).map((w) => (
                <button key={w.key} type="button" className="btn ghost sm" disabled={!!busy} onClick={() => connect(w.key)}>Link {w.label}</button>
              ))}
              <button type="button" className="btn ghost sm" onClick={out}>Sign out</button>
            </div>
          </>
        ) : (
          <>
            <div style={{ maxWidth: 420 }}>
              <b style={{ fontFamily: "var(--display)" }}>Sign in with a wallet to save your profile</b>
              <small className="muted" style={{ display: "block" }}>You sign a one-time message. No transaction, no fee, no access to funds. The plan below works without signing in.</small>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {wallets.map((w) => w.installed ? (
                <button key={w.key} type="button" className="btn glass sm" disabled={!!busy} onClick={() => connect(w.key)}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- wallet icons are data: URIs from EIP-6963 */}
                  {w.icon && /^data:image\//.test(w.icon) && <img src={w.icon} alt="" width={16} height={16} style={{ borderRadius: 4 }} />}
                  {busy === w.key ? "Check your wallet…" : w.label}
                </button>
              ) : (
                <a key={w.key} className="btn ghost sm" href={w.install} target="_blank" rel="noopener noreferrer">Get {w.label}</a>
              ))}
            </div>
          </>
        )}
        {msg && <p className="foot" style={{ width: "100%", margin: 0 }}>{msg}</p>}
      </div>

      {/* ---- profile ---- */}
      <div className="grid gA">
        <div className="card" style={{ display: "grid", gap: 22 }}>
          <div className="c-head" style={{ margin: 0 }}><h3>Your profile</h3>{saved && !dirty && <span className="tag">saved</span>}</div>
          <div>
            <div className="eyebrow muted" style={{ marginBottom: 10 }}>How much risk</div>
            <Choice items={RISKS} value={policy.risk} onPick={(v) => set({ risk: v })} />
          </div>
          <div>
            <div className="eyebrow muted" style={{ marginBottom: 10 }}>When you may need the money back</div>
            <Choice items={EXITS} value={policy.exit} onPick={(v) => set({ exit: v })} />
          </div>
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "flex-end" }}>
            <label style={{ display: "grid", gap: 8 }}>
              <span className="eyebrow muted">Amount in USD</span>
              <input inputMode="decimal" value={amountText} aria-label="Amount in USD"
                onChange={(e) => { setAmountText(e.target.value); const n = Number(e.target.value.replace(/[^0-9.]/g, "")); if (n >= 100 && n <= 1e9) set({ amount: Math.round(n) }); }}
                style={{ font: "600 22px var(--display)", background: "rgba(0,0,0,.2)", border: "1px solid var(--line-2)", borderRadius: 12, padding: "10px 14px", color: "#fff", width: 180 }} />
            </label>
            <div style={{ display: "grid", gap: 8 }}>
              <span className="eyebrow muted">Leave out</span>
              <div className="filters">
                {AVOIDS.map(([k, label]) => (
                  <button key={k} type="button" className={policy.avoid.includes(k) ? "on" : ""} aria-pressed={policy.avoid.includes(k)}
                    onClick={() => set({ avoid: policy.avoid.includes(k) ? policy.avoid.filter((x) => x !== k) : [...policy.avoid, k] })}>{label}</button>
                ))}
              </div>
            </div>
          </div>
          {account && <div><button type="button" className="btn sun" disabled={!dirty || !!busy} onClick={save}>{busy === "save" ? "Saving…" : dirty ? "Save profile" : "Profile saved"}</button></div>}
        </div>

        <div className="card" style={{ display: "grid", gap: 14, alignContent: "start" }}>
          <div className="c-head" style={{ margin: 0 }}><h3>Suggested split</h3><span className="tag">advisory</span></div>
          <div className="vlist">
            <div className="vrow"><span /><div>Placed<small>of {usd(policy.amount)}</small></div><b>{usd(placed)}</b></div>
            <div className="vrow"><span /><div>Kept in your wallet</div><b>{usd(plan.cash?.usd ?? 0)}</b></div>
            <div className="vrow"><span /><div>Expected native yield<small>on the whole amount, per year</small></div><b className="up">{pct(plan.blended, 2)}</b></div>
            <div className="vrow"><span /><div>Positions</div><b>{plan.lines.length}</b></div>
          </div>
          <p className="foot" style={{ margin: 0 }}>dawns never moves funds. This is not financial advice: rates and liquidity change every block.</p>
        </div>
      </div>

      {/* ---- plan ---- */}
      <div className="card flush"><div className="tbl-wrap"><table>
        <thead><tr><th>Position</th><th>Amount</th><th>Native yield</th><th>Why</th><th>Getting out</th></tr></thead>
        <tbody>
          {plan.lines.map((l) => (
            <tr key={l.id}>
              <td><span className="proto"><AssetCoin a={l.assets[0]} size={32} /><span><b>{l.name}</b><small><Link href={`/protocols/${l.protocol}`}>{l.pname}</Link></small></span></span></td>
              <td><b style={{ fontFamily: "var(--display)" }}>{usd(l.usd)}</b><small className="muted" style={{ display: "block" }}>{pct(l.share, 0)}</small></td>
              <td>{pct(l.apy, 1)}</td>
              <td className="muted" style={{ fontSize: 14, maxWidth: 340 }}>{l.why}</td>
              <td className="muted" style={{ fontSize: 14, maxWidth: 240 }}>{l.exit}</td>
            </tr>
          ))}
          {plan.cash && (
            <tr>
              <td><b>Keep in your wallet</b></td>
              <td><b style={{ fontFamily: "var(--display)" }}>{usd(plan.cash.usd)}</b><small className="muted" style={{ display: "block" }}>{pct(plan.cash.share, 0)}</small></td>
              <td>—</td><td className="muted" style={{ fontSize: 14 }} colSpan={2}>{plan.cash.why}</td>
            </tr>
          )}
        </tbody>
      </table></div></div>

      <div className="grid gA">
        <div className="card">
          <div className="c-head"><h3>Rules applied</h3></div>
          <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 8, color: "var(--ink-2)", fontSize: 14.5 }}>
            {plan.notes.map((n) => <li key={n}>{n}</li>)}
          </ul>
        </div>
        <div className="card">
          <div className="c-head"><h3>Left out</h3><button type="button" className="btn ghost sm" onClick={() => setShowOut((v) => !v)}>{showOut ? "Hide" : `Show ${plan.excluded.length}`}</button></div>
          {showOut ? (
            <div className="vlist">
              {plan.excluded.map((e) => (<div className="vrow" key={e.name + e.pname}><span /><div>{e.name}<small>{e.pname} · {e.why}</small></div><b /></div>))}
            </div>
          ) : (
            <p className="muted" style={{ margin: 0 }}>{plan.excluded.filter((e) => /blocked|Frozen/.test(e.why)).length ? <><Pill t="crit">Blocked</Pill> {plan.excluded.filter((e) => /blocked|Frozen/.test(e.why)).map((e) => e.name).join(", ")} can&apos;t take deposits or can&apos;t be exited.</> : "Every opportunity left out has a reason listed."}</p>
          )}
        </div>
      </div>
    </div>
  );
}
