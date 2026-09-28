"use client";
import { track } from "@/lib/track";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AssetCoin, Pill } from "./bits";
import { SplitBar } from "./viz";
import { allocate, checkPlan, project, usdPolicy, defaultPerProtocol, parsePolicy, DEFAULT_POLICY, type Avoid, type ExitNeed, type Policy, type Risk, type Unit } from "@/lib/allocator";
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

export function Allocator({ opps, kasUsd }: { opps: Opportunity[]; kasUsd: number | null }) {
  const [policy, setPolicy] = useState<Policy>(DEFAULT_POLICY);
  const [amountText, setAmountText] = useState(String(DEFAULT_POLICY.amount));
  const [account, setAccount] = useState<Account>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [showOut, setShowOut] = useState(false);
  const wallets = useWalletOptions();
  const up = useMemo(() => usdPolicy(policy, kasUsd), [policy, kasUsd]);
  const plan = useMemo(() => allocate(opps, up), [opps, up]);
  const checks = useMemo(() => checkPlan(plan, up, opps), [plan, up, opps]);
  const proj = useMemo(() => project(plan, up, opps), [plan, up, opps]);
  const breaches = checks.filter((c) => !c.ok).length;
  const inKas = policy.unit === "KAS" && !!kasUsd;
  /** Amounts in the investor's unit */
  const money = (v: number) => (inKas ? `${Math.round(v / kasUsd!).toLocaleString("en-US")} KAS` : usd(v));
  const saved = account?.policy ? parsePolicy(account.policy) : null;
  const dirty = !saved || JSON.stringify(saved) !== JSON.stringify(policy);

  const adopt = (a: Account) => {
    setAccount(a);
    const p = a?.policy ? parsePolicy(a.policy) : null;
    if (p) { setPolicy(p); setAmountText(String(p.amount)); }
  };
  useEffect(() => {
    loadAccount().then(adopt).catch(() => null);
    // coming back from Telegram after linking: refresh the account
    const onFocus = () => loadAccount().then((a) => { setAccount(a); window.dispatchEvent(new Event("dawns:auth")); }).catch(() => null);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  const set = (patch: Partial<Policy>) => setPolicy((p) => ({ ...p, ...patch }));
  const connect = async (key: string) => {
    setBusy(key); setMsg(null);
    track("signin_start", { wallet: key.startsWith("6963:") ? "evm" : key });
    try { adopt(await signInWith(key)); window.dispatchEvent(new Event("dawns:auth")); track("signin_ok", { wallet: key.startsWith("6963:") ? "evm" : key }); setMsg("Signed in. Your profile is saved to this wallet."); }
    catch (e) { track("signin_fail", { wallet: key.startsWith("6963:") ? "evm" : key, error: (e as Error).message }); setMsg((e as Error).message); }
    finally { setBusy(null); }
  };
  const put = async (body: object, done: string, key: string) => {
    setBusy(key); setMsg(null);
    try {
      const r = await fetch("/api/profile", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ policy, ...body }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setAccount(j); setMsg(done);
      track(key === "save" ? "profile_saved" : "plan" in body && (body as { plan: unknown }).plan === null ? "plan_unfollowed" : "plan_followed", { risk: policy.risk, exit: policy.exit });
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(null); }
  };
  const save = () => put({}, "Profile saved.", "save");
  const follow = () => put({ plan: { lines: plan.lines.map((l) => ({ id: l.id, protocol: l.protocol, name: l.name, kind: l.kind, usd: l.usd, apy: l.apy })) } },
    account?.telegram ? "Following this plan. Alerts go to your Telegram." : "Following this plan. Connect Telegram to get alerts.", "follow");
  const unfollow = () => put({ plan: null }, "Stopped following the plan.", "follow");
  const connectTelegram = async () => {
    setBusy("tg"); setMsg(null);
    try {
      const r = await fetch("/api/telegram/link", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      track("telegram_link");
      window.open(j.url, "_blank", "noopener");
      setMsg("Telegram opened. Press Start there, then come back to this page.");
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(null); }
  };
  const following = account?.plan?.lines?.length ? account.plan : null;
  const out = async () => { await signOut(); setAccount(null); window.dispatchEvent(new Event("dawns:auth")); setMsg("Signed out."); };

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
          <div className="fields">
            <div className="field">
              <div className="field-h"><span className="eyebrow muted">Amount</span>{kasUsd && <small className="muted">{inKas ? `≈ ${usd(up.amount)}` : `≈ ${Math.round(policy.amount / kasUsd).toLocaleString("en-US")} KAS`}</small>}</div>
              <div className="inp">
                <input inputMode="decimal" value={amountText} aria-label={`Amount in ${policy.unit ?? "USD"}`}
                  onChange={(e) => { setAmountText(e.target.value); const n = Number(e.target.value.replace(/[^0-9.]/g, "")); if (n >= 100 && n <= 1e10) set({ amount: Math.round(n) }); }} />
                <div className="seg" role="group" aria-label="Unit">
                  {(["USD", "KAS"] as Unit[]).map((u) => (
                    <button key={u} type="button" className={(policy.unit ?? "USD") === u ? "on" : ""} disabled={u === "KAS" && !kasUsd} aria-pressed={(policy.unit ?? "USD") === u}
                      onClick={() => {
                        const cur = policy.unit ?? "USD";
                        if (u === cur || !kasUsd) return;
                        const n = u === "KAS" ? Math.round(policy.amount / kasUsd) : Math.round(policy.amount * kasUsd);
                        const amount = Math.max(100, n);
                        set({ unit: u, amount }); setAmountText(String(amount));
                      }}>{u}</button>
                  ))}
                </div>
              </div>
            </div>
            <div className="field">
              <div className="field-h"><span className="eyebrow muted">Horizon</span><small className="muted">for the projection</small></div>
              <div className="seg fill" role="group" aria-label="Horizon">
                {([[1, "1 mo"], [3, "3 mo"], [6, "6 mo"], [12, "1 yr"], [24, "2 yr"]] as [number, string][]).map(([m, l]) => (
                  <button key={m} type="button" className={(policy.horizon ?? 6) === m ? "on" : ""} aria-pressed={(policy.horizon ?? 6) === m} onClick={() => set({ horizon: m })}>{l}</button>
                ))}
              </div>
            </div>
            <div className="field">
              <div className="field-h"><span className="eyebrow muted">Most in one protocol</span><b className="field-v">{pct((policy.maxProtocol ?? defaultPerProtocol(policy.risk)), 0)}</b></div>
              <div className="rng">
                <input type="range" min={10} max={100} step={5} value={Math.round((policy.maxProtocol ?? defaultPerProtocol(policy.risk)) * 100)} aria-label="Most in one protocol, percent"
                  style={{ ["--fill" as string]: `${((Math.round((policy.maxProtocol ?? defaultPerProtocol(policy.risk)) * 100) - 10) / 90) * 100}%` }}
                  onChange={(e) => set({ maxProtocol: Number(e.target.value) / 100 })} />
                <div className="rng-ticks" aria-hidden="true"><span>10%</span><span>100%</span></div>
              </div>
            </div>
            <div className="field">
              <div className="field-h"><span className="eyebrow muted">Target yield</span><small className="muted">optional</small></div>
              <div className="inp">
                <input inputMode="decimal" placeholder="e.g. 8" defaultValue={policy.target != null ? String(Math.round(policy.target * 1000) / 10) : ""} aria-label="Target yield in percent a year"
                  onChange={(e) => { const t = e.target.value.trim(); if (!t) { const { target: _t, ...rest } = policy; void _t; setPolicy(rest); return; } const n = Number(t.replace(",", ".")); if (Number.isFinite(n) && n >= 0 && n <= 500) set({ target: n / 100 }); }} />
                <span className="inp-suffix">% a year</span>
              </div>
            </div>
            <div className="field wide">
              <div className="field-h"><span className="eyebrow muted">Leave out</span></div>
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
            <div className="vrow"><span /><div>Placed<small>of {money(up.amount)}</small></div><b>{money(placed)}</b></div>
            <div className="vrow"><span /><div>Kept in your wallet<small>the reserve</small></div><b>{money(plan.cash?.usd ?? 0)}</b></div>
            <div className="vrow"><span /><div>Expected native yield<small>on the whole amount, per year</small></div><b className="up">{pct(plan.blended, 2)}</b></div>
            <div className="vrow"><span /><div>Over {proj.months} month{proj.months > 1 ? "s" : ""}<small>if today&apos;s rates hold · if they halve</small></div><b>+{money(proj.earn)}<small className="muted" style={{ display: "block", fontWeight: 400, textAlign: "right" }}>+{money(proj.earnHalf)}</small></b></div>
            {proj.target && <div className="vrow"><span /><div>Your target<small>{proj.target.met ? "reached within your rules" : "not reachable within your rules today"}</small></div><b className={proj.target.met ? "up" : "down"}>{pct(proj.target.want, 1)}</b></div>}
            <div className="vrow"><span /><div>Mandate breaches<small>{checks.length} rules checked against this plan</small></div><b style={{ color: breaches ? "var(--crit)" : "var(--good)" }}>{breaches}</b></div>
          </div>
          {account && (
            <div style={{ display: "grid", gap: 10, borderTop: "1px solid var(--line)", paddingTop: 14 }}>
              {following ? (
                <span className="muted" style={{ fontSize: 14 }}>Following {following.lines.length} positions since {new Date(following.at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}. dawns checks them every 10 minutes against your rules.</span>
              ) : (
                <span className="muted" style={{ fontSize: 14 }}>Follow this plan and dawns tells you when a position stops fitting your rules.</span>
              )}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {plan.lines.length > 0 && <button type="button" className="btn iris sm" disabled={!!busy} onClick={follow}>{busy === "follow" ? "Saving…" : following ? "Follow this version" : "Follow this plan"}</button>}
                {following && <button type="button" className="btn ghost sm" disabled={!!busy} onClick={unfollow}>Stop following</button>}
                {account.telegram
                  ? <span className="tag" style={{ alignSelf: "center" }}>Telegram connected</span>
                  : <button type="button" className="btn glass sm" disabled={!!busy} onClick={connectTelegram}>{busy === "tg" ? "Opening…" : "Connect Telegram"}</button>}
              </div>
            </div>
          )}
          <p className="foot" style={{ margin: 0 }}>dawns never moves funds. This is not financial advice: rates and liquidity change every block.</p>
        </div>
      </div>

      {/* ---- plan at a glance ---- */}
      {plan.lines.length > 0 && (
        <div className="card">
          <div className="c-head"><h3>Where the {money(up.amount)} goes</h3><span className="tag">{pct(plan.blended, 1)} a year</span></div>
          <SplitBar label="Suggested split" parts={[
            ...plan.lines.map((l, i) => ({ key: l.id, label: l.name.replace(/ liquidity$/, ""), color: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"][i % 8], share: l.share, note: `${l.pname} · ${pct(l.apy, 1)} a year` })),
            ...(plan.cash ? [{ key: "cash", label: "Kept in your wallet", color: "#4A4270", share: plan.cash.share, note: "the reserve" }] : []),
          ]} />
        </div>
      )}

      {/* ---- plan ---- */}
      <div className="card flush"><div className="tbl-wrap"><table>
        <thead><tr><th>Position</th><th>Amount</th><th>Native yield</th><th>Why</th><th>Getting out</th></tr></thead>
        <tbody>
          {plan.lines.map((l) => (
            <tr key={l.id}>
              <td><span className="proto"><AssetCoin a={l.assets[0]} size={32} /><span><b>{l.name}</b><small><Link href={`/protocols/${l.protocol}`}>{l.pname}</Link></small></span></span></td>
              <td><b style={{ fontFamily: "var(--display)" }}>{money(l.usd)}</b><small className="muted" style={{ display: "block" }}>{pct(l.share, 0)}</small></td>
              <td>{pct(l.apy, 1)}</td>
              <td className="muted wrap" style={{ fontSize: 14, minWidth: 280, maxWidth: 380 }}>{l.why}</td>
              <td className="muted wrap" style={{ fontSize: 14, minWidth: 200, maxWidth: 260 }}>{l.exit}</td>
            </tr>
          ))}
          {plan.cash && (
            <tr>
              <td><b>Keep in your wallet</b></td>
              <td><b style={{ fontFamily: "var(--display)" }}>{money(plan.cash.usd)}</b><small className="muted" style={{ display: "block" }}>{pct(plan.cash.share, 0)}</small></td>
              <td>—</td><td className="muted wrap" style={{ fontSize: 14 }} colSpan={2}>{plan.cash.why}</td>
            </tr>
          )}
        </tbody>
      </table></div></div>

      <div className="grid gA">
        <div className="card">
          <div className="c-head"><h3>Mandate check</h3><Pill t={breaches ? "crit" : "good"}>{breaches ? `${breaches} breach${breaches > 1 ? "es" : ""}` : "0 breaches"}</Pill></div>
          <div className="vlist">
            {checks.map((c) => (
              <div className="vrow" key={c.rule}><span style={{ color: c.ok ? "var(--good)" : "var(--crit)" }}>{c.ok ? "✓" : "✕"}</span><div>{c.rule}<small>limit {c.limit}</small></div><b style={{ fontWeight: 500 }}>{c.actual}</b></div>
            ))}
          </div>
          <p className="foot" style={{ marginBottom: 0 }}>Checked independently of how the split was built: each rule is tested against the positions above. A vault would enforce the same rules on-chain.</p>
        </div>
        <div className="card">
          <div className="c-head"><h3>What could go wrong</h3></div>
          <div className="vlist">
            {proj.worst && <div className="vrow"><span /><div>If {proj.worst.name} failed<small>the largest exposure to one protocol</small></div><b className="down">−{money(proj.worst.usd)}<small className="muted" style={{ display: "block", fontWeight: 400, textAlign: "right" }}>{pct(proj.worst.share, 0)} of the amount</small></b></div>}
            {proj.lpDrag > 0 && <div className="vrow"><span /><div>If prices swing like the last 7 days<small>liquidity positions trail simply holding the tokens</small></div><b className="down">−{money(proj.lpDrag)}</b></div>}
            <div className="vrow"><span /><div>If rates halve<small>native yield over {proj.months} months</small></div><b>+{money(proj.earnHalf)}</b></div>
            {plan.lines.some((l) => l.kind === "supply") && <div className="vrow"><span /><div>If a market fills up<small>borrowers can take the cash; your exit waits for repayments</small></div><b className="muted" style={{ fontWeight: 400 }}>exit delayed</b></div>}
          </div>
          <p className="foot" style={{ marginBottom: 0 }}>Arithmetic on today&apos;s readings, not a forecast. Token prices are not modelled: a stablecoin plan and a KAS plan carry very different price risk.</p>
        </div>
      </div>

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
