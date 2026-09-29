"use client";
import { track } from "@/lib/track";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AssetCoin, Pill } from "./bits";
import { SplitBar } from "./viz";
import { PlanShare } from "./plan-share";
import { Wizard, type WizardStep } from "./wizard";
import { allocate, checkPlan, project, usdPolicy, defaultPerProtocol, parsePolicy, DEFAULT_POLICY, type Avoid, type ExitNeed, type Policy, type Risk, type Unit } from "@/lib/allocator";
import { usd, pct } from "@/lib/format";
import type { Opportunity } from "@/lib/types";
import { loadAccount, shortAddr, signOut, type Account } from "./wallet";
import { openConnect } from "./connect";

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
  const [step, setStep] = useState(0);
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
    if (p) { setPolicy(p); setAmountText(String(p.amount)); setStep(4); }
  };
  useEffect(() => {
    loadAccount().then(adopt).catch(() => null);
    // coming back from Telegram after linking: refresh the account
    const onFocus = () => loadAccount().then((a) => { setAccount(a); window.dispatchEvent(new Event("dawns:auth")); }).catch(() => null);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  const set = (patch: Partial<Policy>) => setPolicy((p) => ({ ...p, ...patch }));
  const connect = async () => {
    setMsg(null);
    track("signin_start", { wallet: "picker" });
    try { adopt(await openConnect()); track("signin_ok", { wallet: "picker" }); setMsg("Signed in. Your profile is saved to this wallet."); }
    catch (e) { if ((e as Error).message !== "Cancelled.") setMsg((e as Error).message); }
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
  const unit = policy.unit ?? "USD";
  const perProto = policy.maxProtocol ?? defaultPerProtocol(policy.risk);
  const COLORS = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"];
  const split = [
    ...plan.lines.map((l, i) => ({ key: l.id, label: l.name.replace(/ liquidity$/, ""), color: COLORS[i % 8], share: l.share, note: `${l.pname} · ${pct(l.apy, 1)} a year` })),
    ...(plan.cash ? [{ key: "cash", label: "Kept in your wallet", color: "#4A4270", share: plan.cash.share, note: "the reserve" }] : []),
  ];
  const amountOk = policy.amount >= 100 && Number(amountText.replace(/[^0-9.]/g, "")) >= 100;

  const steps: WizardStep[] = [
    {
      key: "amount", title: "Amount", hint: "How much you want to put to work, and over what time the projection should run.",
      summary: `${inKas ? `${policy.amount.toLocaleString("en-US")} KAS` : usd(policy.amount)} · ${policy.horizon ?? 6} mo`,
      ok: amountOk, need: "At least 100",
      body: (
        <div className="fields">
          <div className="field">
            <div className="field-h"><span className="eyebrow muted">Amount</span>{kasUsd && <small className="muted">{inKas ? `≈ ${usd(up.amount)}` : `≈ ${Math.round(policy.amount / kasUsd).toLocaleString("en-US")} KAS`}</small>}</div>
            <div className="inp">
              <input inputMode="decimal" value={amountText} aria-label={`Amount in ${unit}`}
                onChange={(e) => { setAmountText(e.target.value); const n = Number(e.target.value.replace(/[^0-9.]/g, "")); if (n >= 100 && n <= 1e10) set({ amount: Math.round(n) }); }} />
              <div className="seg" role="group" aria-label="Unit">
                {(["USD", "KAS"] as Unit[]).map((u) => (
                  <button key={u} type="button" className={unit === u ? "on" : ""} disabled={u === "KAS" && !kasUsd} aria-pressed={unit === u}
                    onClick={() => {
                      if (u === unit || !kasUsd) return;
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
        </div>
      ),
    },
    {
      key: "risk", title: "Risk", hint: "What the plan may hold. Lower risk means fewer places and smaller positions.",
      summary: RISKS.find((r) => r[0] === policy.risk)?.[1],
      body: <Choice items={RISKS} value={policy.risk} onPick={(v) => set({ risk: v })} />,
    },
    {
      key: "exit", title: "Way out", hint: "When you may need the money back. Markets that could not pay you out in time are left out.",
      summary: EXITS.find((r) => r[0] === policy.exit)?.[1],
      body: <Choice items={EXITS} value={policy.exit} onPick={(v) => set({ exit: v })} />,
    },
    {
      key: "limits", title: "Limits", hint: "Optional. The defaults follow your risk level.",
      summary: `≤ ${pct(perProto, 0)} per protocol${policy.avoid.length ? ` · ${policy.avoid.length} left out` : ""}`,
      body: (
        <div className="fields">
          <div className="field">
            <div className="field-h"><span className="eyebrow muted">Most in one protocol</span><b className="field-v">{pct(perProto, 0)}</b></div>
            <div className="rng">
              <input type="range" min={10} max={100} step={5} value={Math.round(perProto * 100)} aria-label="Most in one protocol, percent"
                style={{ ["--fill" as string]: `${((Math.round(perProto * 100) - 10) / 90) * 100}%` }}
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
      ),
    },
    {
      key: "plan", title: "Your plan", hint: `Where ${money(up.amount)} would go today, checked against your rules.`,
      summary: `${pct(plan.blended, 1)} a year`,
      body: (
        <>
          <div className="grid gA">
            <div className="vlist">
              <div className="vrow"><span /><div>Placed<small>of {money(up.amount)}</small></div><b>{money(placed)}</b></div>
              <div className="vrow"><span /><div>Kept in your wallet<small>the reserve</small></div><b>{money(plan.cash?.usd ?? 0)}</b></div>
              <div className="vrow"><span /><div>Expected native yield<small>on the whole amount, per year</small></div><b className="up">{pct(plan.blended, 2)}</b></div>
              <div className="vrow"><span /><div>Over {proj.months} month{proj.months > 1 ? "s" : ""}<small>if today&apos;s rates hold · if they halve</small></div><b>+{money(proj.earn)}<small className="muted" style={{ display: "block", fontWeight: 400, textAlign: "right" }}>+{money(proj.earnHalf)}</small></b></div>
              {proj.target && <div className="vrow"><span /><div>Your target<small>{proj.target.met ? "reached within your rules" : "not reachable within your rules today"}</small></div><b className={proj.target.met ? "up" : "down"}>{pct(proj.target.want, 1)}</b></div>}
              <div className="vrow"><span /><div>Mandate breaches<small>{checks.length} rules checked against this plan</small></div><b style={{ color: breaches ? "var(--crit)" : "var(--good)" }}>{breaches}</b></div>
            </div>
            <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
              {plan.lines.length > 0 ? <SplitBar label="Suggested split" parts={split} /> : <p className="muted" style={{ margin: 0 }}>Nothing open fits these rules today. Go back and loosen the risk or the way out.</p>}
            </div>
          </div>

          {plan.lines.length > 0 && (
            <div className="card flush" style={{ background: "transparent" }}><div className="tbl-wrap"><table>
              <thead><tr><th>Position</th><th>Amount</th><th>Native yield</th><th>Why</th><th>Getting out</th></tr></thead>
              <tbody>
                {plan.lines.map((l) => (
                  <tr key={l.id}>
                    <td><span className="proto"><AssetCoin a={l.assets[0]} size={32} /><span><b>{l.name}</b><small><Link href={`/protocols/${l.protocol}`}>{l.pname}</Link></small></span></span></td>
                    <td><b style={{ fontFamily: "var(--display)" }}>{money(l.usd)}</b><small className="muted" style={{ display: "block" }}>{pct(l.share, 0)}</small></td>
                    <td>{pct(l.apy, 1)}</td>
                    <td className="muted wrap" style={{ fontSize: 14, minWidth: 240, maxWidth: 380 }}>{l.why}</td>
                    <td className="muted wrap" style={{ fontSize: 14, minWidth: 180, maxWidth: 260 }}>{l.exit}</td>
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
          )}

          <div className="wz-review" style={{ borderTop: "1px solid var(--line)", paddingTop: 16 }}>
            <b style={{ fontFamily: "var(--display)" }}>Keep this plan</b>
            {account ? (
              <>
                <span className="muted" style={{ fontSize: 14 }}>
                  Signed in as {account.wallets.map((w) => shortAddr(w.address)).join(" · ")}.{" "}
                  {following ? `Following ${following.lines.length} positions since ${new Date(following.at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}; dawns checks them every 10 minutes.` : "Follow it and dawns tells you when a position stops fitting your rules."}
                </span>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button type="button" className="btn sun sm" disabled={!dirty || !!busy} onClick={save}>{busy === "save" ? "Saving…" : dirty ? "Save profile" : "Profile saved"}</button>
                  {plan.lines.length > 0 && <button type="button" className="btn iris sm" disabled={!!busy} onClick={follow}>{busy === "follow" ? "Saving…" : following ? "Follow this version" : "Follow this plan"}</button>}
                  {following && <button type="button" className="btn ghost sm" disabled={!!busy} onClick={unfollow}>Stop following</button>}
                  {account.telegram
                    ? <span className="tag" style={{ alignSelf: "center" }}>Telegram connected</span>
                    : <button type="button" className="btn glass sm" disabled={!!busy} onClick={connectTelegram}>{busy === "tg" ? "Opening…" : "Connect Telegram"}</button>}
                  <button type="button" className="btn ghost sm" onClick={out}>Sign out</button>
                </div>
              </>
            ) : (
              <>
                <span className="muted" style={{ fontSize: 14 }}>Sign in to save the profile and get told when a position stops fitting it. You sign a one-time message: no transaction, no fee, no access to funds.</span>
                <div><button type="button" className="btn sun sm" onClick={connect}>Connect wallet</button></div>
              </>
            )}
            {msg && <p className="foot" style={{ margin: 0 }}>{msg}</p>}
            <PlanShare policy={policy} disabled={!plan.lines.length} />
          </div>

          <details className="wz-more">
            <summary>Checks and what could go wrong<span className="muted" style={{ fontWeight: 400, fontSize: 14, marginLeft: "auto" }}>{breaches ? `${breaches} breach${breaches > 1 ? "es" : ""}` : "0 breaches"}</span></summary>
            <div className="grid gA">
              <div>
                <div className="c-head"><h3>Mandate check</h3><Pill t={breaches ? "crit" : "good"}>{breaches ? `${breaches} breach${breaches > 1 ? "es" : ""}` : "0 breaches"}</Pill></div>
                <div className="vlist">
                  {checks.map((c) => (
                    <div className="vrow" key={c.rule}><span style={{ color: c.ok ? "var(--good)" : "var(--crit)" }}>{c.ok ? "✓" : "✕"}</span><div>{c.rule}<small>limit {c.limit}</small></div><b style={{ fontWeight: 500 }}>{c.actual}</b></div>
                  ))}
                </div>
                <p className="foot" style={{ marginBottom: 0 }}>Each rule is tested against the positions above, independently of how the split was built.</p>
              </div>
              <div>
                <div className="c-head"><h3>What could go wrong</h3></div>
                <div className="vlist">
                  {proj.worst && <div className="vrow"><span /><div>If {proj.worst.name} failed<small>the largest exposure to one protocol</small></div><b className="down">−{money(proj.worst.usd)}<small className="muted" style={{ display: "block", fontWeight: 400, textAlign: "right" }}>{pct(proj.worst.share, 0)} of the amount</small></b></div>}
                  {proj.lpDrag > 0 && <div className="vrow"><span /><div>If prices swing like the last 7 days<small>liquidity positions trail simply holding the tokens</small></div><b className="down">−{money(proj.lpDrag)}</b></div>}
                  <div className="vrow"><span /><div>If rates halve<small>native yield over {proj.months} months</small></div><b>+{money(proj.earnHalf)}</b></div>
                  {plan.lines.some((l) => l.kind === "supply") && <div className="vrow"><span /><div>If a market fills up<small>borrowers can take the cash; your exit waits for repayments</small></div><b className="muted" style={{ fontWeight: 400 }}>exit delayed</b></div>}
                </div>
                <p className="foot" style={{ marginBottom: 0 }}>Arithmetic on today&apos;s readings, not a forecast. Token prices are not modelled.</p>
              </div>
            </div>
          </details>
          <details className="wz-more">
            <summary>How the plan was built<span className="muted" style={{ fontWeight: 400, fontSize: 14, marginLeft: "auto" }}>{plan.excluded.length} left out</span></summary>
            <div className="grid gA">
              <div>
                <div className="c-head"><h3>Rules applied</h3></div>
                <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 8, color: "var(--ink-2)", fontSize: 14.5 }}>
                  {plan.notes.map((n) => <li key={n}>{n}</li>)}
                </ul>
              </div>
              <div>
                <div className="c-head"><h3>Left out</h3></div>
                <div className="vlist">
                  {plan.excluded.map((e) => (<div className="vrow" key={e.name + e.pname}><span /><div>{e.name}<small>{e.pname} · {e.why}</small></div><b /></div>))}
                </div>
              </div>
            </div>
          </details>
          <p className="foot" style={{ margin: 0 }}>dawns never moves funds. This is not financial advice: rates and liquidity change every block.</p>
        </>
      ),
    },
  ];

  const live = (
    <div className="card wz-live">
      <span className="eyebrow muted">Live, from today&apos;s readings</span>
      <b className="big up">{pct(plan.blended, 1)}<small className="muted" style={{ fontSize: 14, fontWeight: 400, marginLeft: 6 }}>a year</small></b>
      {plan.lines.length > 0 && <SplitBar label="Split so far" parts={split} height={12} legend={false} tip={false} />}
      <dl>
        <div><dt>Places</dt><dd>{plan.lines.length}</dd></div>
        <div><dt>Reserve</dt><dd>{money(plan.cash?.usd ?? 0)}</dd></div>
        <div><dt>Breaches</dt><dd style={{ color: breaches ? "var(--crit)" : "var(--good)" }}>{breaches}</dd></div>
      </dl>
    </div>
  );

  return <Wizard steps={steps} step={step} onStep={setStep} aside={live} nextLabel="See the plan" />;
}
