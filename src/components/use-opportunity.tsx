"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { createPublicClient, custom, formatUnits, parseUnits, type Address, type PublicClient } from "viem";
import { Wizard } from "./wizard";
import { Pill } from "./bits";
import { useWalletOptions, evmProvider, type Eip1193 } from "./wallet";
import { ERC20, NETS, PAIR, lpCalls, lpShare, quote, supplyCalls, txUrl, type ActPlan, type Call, type Trail } from "@/lib/act";
import type { Opportunity } from "@/lib/types";
import { pct, usd } from "@/lib/format";

type W = { provider: Eip1193; address: Address; chainId: number; client: PublicClient };
type Bal = { dec: number[]; tokens: bigint[]; allow: bigint[]; native: bigint; reserves: [bigint, bigint] | null; supply: bigint | null };
type Run = { key: string; state: "wait" | "sim" | "sign" | "mine" | "done" | "fail"; hash?: string; err?: string };

const ZERO = BigInt(0);
const fmt = (x: bigint, d: number) => { const s = formatUnits(x, d); const [i, f = ""] = s.split("."); return f ? `${Number(i).toLocaleString("en-US")}.${f.slice(0, 6).replace(/0+$/, "")}`.replace(/\.$/, "") : Number(i).toLocaleString("en-US"); };
const parse = (v: string, d: number): bigint | null => { try { const t = v.trim().replace(/,/g, ""); if (!t || !/^\d*\.?\d*$/.test(t)) return null; return parseUnits(t, d); } catch { return null; } };
const errText = (e: unknown) => { const m = (e as { shortMessage?: string; message?: string })?.shortMessage ?? (e as Error)?.message ?? "The wallet did not respond."; return /reject|denied|cancel/i.test(m) ? "You declined in the wallet." : m.split("\n")[0].slice(0, 200); };

function TrailList({ t }: { t: Trail }) {
  if (!t.length) return null;
  return (
    <details className="more">
      <summary>How dawns knows these are the right contracts</summary>
      <ul className="findings" style={{ marginTop: 12 }}>
        {t.map(([k, v, href]) => <li key={k}><b>{k}.</b> {v}{href && <> · <a href={href} target="_blank" rel="noopener noreferrer">explorer ↗</a></>}</li>)}
      </ul>
    </details>
  );
}

/**
 * Take an opportunity, one step at a time: what you are getting into, your wallet on the
 * right network, how much, then each transaction simulated and signed in your wallet.
 * dawns never holds funds; where it cannot confirm a contract, the last step is the protocol's app.
 */
export function UseOpportunity({ o, plan }: { o: Opportunity; plan: ActPlan }) {
  const [step, setStep] = useState(0);
  const [ack, setAck] = useState(false);
  const wallets = useWalletOptions().filter((x) => x.kind === "evm" && x.installed);
  const [w, setW] = useState<W | null>(null);
  const [wErr, setWErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [bal, setBal] = useState<Bal | null>(null);
  const [amt, setAmt] = useState("");
  const [side, setSide] = useState(0);
  const [native, setNative] = useState(true);
  const [slip, setSlip] = useState(50);
  const [runs, setRuns] = useState<Run[]>([]);
  const [deadlineAt, setDeadlineAt] = useState<bigint>(ZERO);
  const net = NETS[plan.chain];
  const exec = plan.mode === "supply" || plan.mode === "lp";
  const listed = useMemo(() => (plan.mode === "supply" || plan.mode === "lp" ? plan.tokens : []), [plan]);

  const connect = async (key: string) => {
    setBusy(true); setWErr(null);
    try {
      const { provider, address } = await evmProvider(key);
      const chainId = Number(await provider.request({ method: "eth_chainId" }));
      const nw: W = { provider, address: address as Address, chainId, client: createPublicClient({ transport: custom(provider) }) as PublicClient };
      setW(nw); await load(nw);
    } catch (e) { setWErr(errText(e)); }
    setBusy(false);
  };
  const switchNet = async () => {
    if (!w) return;
    setBusy(true); setWErr(null);
    const hex = `0x${net.chainId.toString(16)}`;
    try {
      try { await w.provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] }); }
      catch (e) {
        const code = (e as { code?: number; data?: { originalError?: { code?: number } } }).code ?? (e as { data?: { originalError?: { code?: number } } }).data?.originalError?.code;
        if (code !== 4902 && !/unrecognized|not added|unknown chain/i.test((e as Error).message ?? "")) throw e;
        await w.provider.request({ method: "wallet_addEthereumChain", params: [{ ...net, chainId: hex }] });
      }
      const chainId = Number(await w.provider.request({ method: "eth_chainId" }));
      const nw = { ...w, chainId }; setW(nw); await load(nw);
    } catch (e) { setWErr(errText(e)); }
    setBusy(false);
  };
  const onNet = !!w && w.chainId === net.chainId;
  /** decimals as the token contract answers them, not as dawns last read them */
  const tokens = useMemo(() => listed.map((t, i) => ({ ...t, decimals: bal?.dec[i] ?? t.decimals })), [listed, bal]);

  const spender = plan.mode === "supply" ? plan.pool : plan.mode === "lp" ? plan.router : null;
  const read = async (w: W | null) => {
    if (!w || !exec || !spender || w.chainId !== net.chainId) return;
    const c = w.client;
    const [dec, bs, as, native] = await Promise.all([
      Promise.all(listed.map((t) => c.readContract({ address: t.address, abi: ERC20, functionName: "decimals" }))),
      Promise.all(listed.map((t) => c.readContract({ address: t.address, abi: ERC20, functionName: "balanceOf", args: [w.address] }))),
      Promise.all(listed.map((t) => c.readContract({ address: t.address, abi: ERC20, functionName: "allowance", args: [w.address, spender] }))),
      c.getBalance({ address: w.address }),
    ]);
    let reserves: [bigint, bigint] | null = null, supply: bigint | null = null;
    if (plan.mode === "lp") {
      const [r, s] = await Promise.all([c.readContract({ address: plan.pair, abi: PAIR, functionName: "getReserves" }), c.readContract({ address: plan.pair, abi: PAIR, functionName: "totalSupply" })]);
      reserves = [r[0], r[1]]; supply = s;
    }
    setBal({ dec: dec.map(Number), tokens: bs, allow: as, native, reserves, supply });
  };
  const load = (w: W) => read(w).catch((e) => setWErr(`Could not read your balances: ${errText(e)}`));

  /* ---- amounts ---- */
  const wethIdx = plan.mode === "lp" && plan.weth ? plan.tokens.findIndex((t) => t.address === plan.weth) : plan.mode === "supply" && plan.wrap ? 0 : -1;
  const useNative = native && wethIdx >= 0;
  const a = useMemo((): bigint[] | null => {
    if (!exec) return null;
    const t = tokens[side];
    const x = parse(amt, t.decimals);
    if (x == null || x <= ZERO) return null;
    if (plan.mode === "supply") return [x];
    if (!bal?.reserves) return null;
    const [r0, r1] = bal.reserves;
    return side === 0 ? [x, quote(x, r0, r1)] : [quote(x, r1, r0), x];
  }, [exec, tokens, side, amt, plan.mode, bal]);
  const avail = (i: number) => (bal ? (i === wethIdx && useNative ? (plan.mode === "supply" ? bal.tokens[i] + bal.native : bal.native) : bal.tokens[i]) : ZERO);
  const gasRoom = parseUnits("0.5", 18);    // leave native KAS for fees
  const over = a ? a.findIndex((x, i) => x > (i === wethIdx && useNative ? avail(i) - gasRoom : avail(i))) : -1;
  const setMax = () => {
    if (!bal) return;
    let m = avail(side);
    if (side === wethIdx && useNative) m = m > gasRoom ? m - gasRoom : ZERO;
    if (plan.mode === "lp" && bal.reserves) {
      const other = 1 - side;
      let o = avail(other); if (other === wethIdx && useNative) o = o > gasRoom ? o - gasRoom : ZERO;
      const [r0, r1] = bal.reserves;
      const cap = side === 0 ? quote(o, r1, r0) : quote(o, r0, r1);
      if (cap < m) m = cap;
    }
    setAmt(formatUnits(m, tokens[side].decimals));
  };

  /* ---- the calls ---- */
  const calls: Call[] = useMemo(() => {
    if (!w || !a || !bal) return [];
    if (plan.mode === "supply") return supplyCalls(plan, w.address, a[0], { token: useNative ? bal.tokens[0] : a[0], allowance: bal.allow[0], native: bal.native });
    if (plan.mode === "lp") return lpCalls(plan, w.address, [a[0], a[1]], [bal.allow[0], bal.allow[1]], slip, deadlineAt, useNative);
    return [];
  }, [w, a, bal, plan, slip, deadlineAt, useNative]);

  const sendAll = async () => {
    if (!w || !calls.length) return;
    const dl = BigInt(Math.floor(new Date().getTime() / 1000) + 20 * 60);
    setDeadlineAt(dl);
    const list = plan.mode === "lp" && bal && a ? lpCalls(plan, w.address, [a[0], a[1]], [bal.allow[0], bal.allow[1]], slip, dl, useNative) : calls;
    let rs: Run[] = list.map((c) => ({ key: c.key, state: "wait" }));
    setRuns(rs);
    const upd = (i: number, r: Partial<Run>) => { rs = rs.map((x, j) => (j === i ? { ...x, ...r } : x)); setRuns(rs); };
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      try {
        upd(i, { state: "sim" });
        await w.client.call({ account: w.address, to: c.to, data: c.data, value: c.value });
        upd(i, { state: "sign" });
        const hash = (await w.provider.request({ method: "eth_sendTransaction", params: [{ from: w.address, to: c.to, data: c.data, value: `0x${c.value.toString(16)}` }] })) as `0x${string}`;
        upd(i, { state: "mine", hash });
        const rc = await w.client.waitForTransactionReceipt({ hash, pollingInterval: 1500, timeout: 180_000 });
        if (rc.status !== "success") throw new Error("The transaction reverted on-chain.");
        upd(i, { state: "done" });
      } catch (e) {
        upd(i, { state: "fail", err: rs[i].state === "sim" ? `Simulation failed, nothing was sent: ${errText(e)}` : errText(e) });
        return;
      }
    }
    load(w);
  };
  const doneAll = runs.length > 0 && runs.every((r) => r.state === "done");
  const running = runs.some((r) => r.state === "sim" || r.state === "sign" || r.state === "mine");

  /* ---- steps ---- */
  const crit = o.status === "crit";
  const checkStep = {
    key: "check", title: "Check", hint: "What this position is, what it pays and what it costs to leave. dawns does not advise: this is the data.",
    ok: plan.mode !== "blocked" && (!crit || ack), need: plan.mode === "blocked" ? "Not open now" : "Tick the box first",
    summary: `${o.apy != null ? pct(o.apy, 2) : "—"} native`,
    body: (
      <div style={{ display: "grid", gap: 16 }}>
        <div className="uo-figs">
          <div><span className="eyebrow muted">Native yield</span><b>{o.apy != null ? pct(o.apy, 2) : "—"}</b><small>{o.apyShort}</small></div>
          <div><span className="eyebrow muted">Can leave now</span><b>{o.exitNow != null ? usd(o.exitNow) : "—"}</b><small>{o.kind === "supply" ? `of ${usd(o.size)} supplied` : "remove at the pool's mix"}</small></div>
          <div><span className="eyebrow muted">Standing</span><b><Pill t={o.status}>{o.statusText}</Pill></b><small>{o.pname} · {net.chainName}</small></div>
        </div>
        {o.farm && <p className="muted" style={{ margin: 0 }}>{o.farm.on ? `Plus ${o.farm.reward} farm rewards${o.farm.apr != null ? ` (${pct(o.farm.apr, 1)} a year at market price)` : ""}, paid in ${o.farm.reward}: shown, never added to the yield above.` : `${o.farm.reward} rewards are off.`}</p>}
        <div className="st-checks sm">
          {o.notes.slice(0, 5).map((n) => <div key={n} className={`st-check ${/blocked|cannot|stale|revert|frozen|single key|trails|not verified/i.test(n) ? "warn" : "info"}`}><i aria-hidden>{/blocked|cannot|stale|revert|frozen|single key|trails|not verified/i.test(n) ? "!" : "i"}</i><span><b>{n}</b></span></div>)}
        </div>
        {plan.mode === "blocked" && <p className="cl-err" style={{ margin: 0 }}>{plan.why}</p>}
        {crit && plan.mode !== "blocked" && (
          <label className="uo-ack"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> I see that suppliers cannot all leave now, and what I put in may not come out when I want it.</label>
        )}
        <TrailList t={plan.trail} />
      </div>
    ),
  };

  if (!exec) {
    return (
      <Wizard step={step} onStep={setStep} nextLabel="Continue in the app" steps={[checkStep, {
        key: "app", title: `${plan.pname} app`, hint: plan.mode === "app" || plan.mode === "blocked" ? plan.why : undefined,
        body: (
          <div className="wz-review">
            <ol className="uo-howto">
              <li>Open {plan.pname} and connect the same wallet, on {net.chainName}.</li>
              <li>Find <b>{o.name}</b>{o.pair ? <> (pool <code>{o.pair.slice(0, 8)}…{o.pair.slice(-4)}</code>)</> : null}.</li>
              <li>Check the contract your wallet shows against the explorer before you sign.</li>
              <li>Come back to <Link href="/portfolio">Portfolio</Link>: dawns reads the position from your address.</li>
            </ol>
            {plan.app ? <a className="btn sun" href={plan.app} target="_blank" rel="noopener noreferrer">Open {plan.pname} ↗</a> : <p className="muted">dawns has no link to {plan.pname}&apos;s app.</p>}
          </div>
        ),
      }]} />
    );
  }

  const walletStep = {
    key: "wallet", title: "Wallet", hint: `An EVM wallet on ${net.chainName}. dawns only reads your balances and asks your wallet to sign; it never holds funds.`,
    ok: onNet && !!bal, need: !w ? "Connect a wallet" : !onNet ? `Switch to ${net.chainName}` : "Reading balances…",
    summary: w ? `${w.address.slice(0, 6)}…${w.address.slice(-4)}` : undefined,
    body: (
      <div style={{ display: "grid", gap: 14 }}>
        {!w ? (
          wallets.length ? (
            <div className="uo-wallets">{wallets.map((x) => <button key={x.key} type="button" className="btn ghost" disabled={busy} onClick={() => connect(x.key)}>
              {/* eslint-disable-next-line @next/next/no-img-element -- EIP-6963 icons are data: URIs */}
              {x.icon && <img src={x.icon} alt="" width={18} height={18} />}{x.label}</button>)}</div>
          ) : <p className="muted" style={{ margin: 0 }}>No EVM wallet in this browser. Install MetaMask or another EVM wallet, or open dawns inside your wallet app&apos;s browser.</p>
        ) : (
          <div className="uo-row"><span className="eyebrow muted">Connected</span><code>{w.address}</code></div>
        )}
        {w && !onNet && <div className="uo-row"><span>Your wallet is on another network.</span><button type="button" className="btn sun sm" disabled={busy} onClick={switchNet}>Switch to {net.chainName}</button></div>}
        {onNet && bal && (
          <div className="uo-bals">
            {tokens.map((t, i) => <div key={t.address}><span className="muted">{t.symbol}</span><b>{fmt(bal.tokens[i], t.decimals)}</b></div>)}
            <div><span className="muted">{net.nativeCurrency.symbol} (for fees)</span><b>{fmt(bal.native, 18)}</b></div>
          </div>
        )}
        {wErr && <small className="cl-err">{wErr}</small>}
      </div>
    ),
  };

  const t = tokens[side];
  const share = plan.mode === "lp" && a && bal?.reserves && bal.supply != null ? lpShare(a[0], a[1], bal.reserves[0], bal.reserves[1], bal.supply) : null;
  const amountStep = {
    key: "amount", title: "Amount", hint: plan.mode === "lp" ? "Liquidity goes in at the pool's current mix: choose one side and the other follows." : `How much ${t.symbol} to supply.`,
    ok: !!a && over < 0, need: !a ? "Enter an amount" : `More ${tokens[over]?.symbol ?? ""} than you have${over === wethIdx && useNative ? " (keeping 0.5 for fees)" : ""}`,
    summary: a ? tokens.map((x, i) => `${fmt(a[i], x.decimals)} ${x.symbol}`).join(" + ") : undefined,
    body: (
      <div style={{ display: "grid", gap: 14 }}>
        {plan.mode === "lp" && (
          <div className="seg" role="group" aria-label="Enter amount of">{tokens.map((x, i) => <button key={x.address} type="button" className={i === side ? "on" : ""} onClick={() => { setSide(i); setAmt(""); }}>{x.symbol}</button>)}</div>
        )}
        <label className="cl-field">
          <span><b>{t.symbol}</b><small>You have {bal ? fmt(avail(side), t.decimals) : "…"}{side === wethIdx && useNative ? " incl. native" : ""}</small></span>
          <div className="uo-amt"><input className="search mono" inputMode="decimal" placeholder="0.0" value={amt} onChange={(e) => setAmt(e.target.value)} /><button type="button" className="btn ghost sm" onClick={setMax}>Max</button></div>
        </label>
        {plan.mode === "lp" && a && <p style={{ margin: 0 }}>With <b>{fmt(a[1 - side], tokens[1 - side].decimals)} {tokens[1 - side].symbol}</b>{share != null && <span className="muted"> · {pct(share, share < 0.001 ? 3 : 2)} of the pool</span>}</p>}
        {wethIdx >= 0 && (
          <label className="uo-ack"><input type="checkbox" checked={native} onChange={(e) => setNative(e.target.checked)} /> Use native {net.nativeCurrency.symbol} for the {tokens[wethIdx].symbol} side{plan.mode === "supply" ? " (wrapped first, if you hold too little)" : ""}</label>
        )}
        {plan.mode === "lp" && (
          <div className="uo-row"><span className="muted">If the price moves before your transaction lands, accept at most</span>
            <div className="seg" role="group" aria-label="Slippage">{[50, 100, 200].map((b) => <button key={b} type="button" className={b === slip ? "on" : ""} onClick={() => setSlip(b)}>{b / 100}%</button>)}</div></div>
        )}
        {plan.mode === "supply" && plan.utilization >= 0.8 && <p className="muted" style={{ margin: 0 }}>{pct(plan.utilization, 0)} of this market is lent out: withdrawals wait for cash when it is all lent.</p>}
      </div>
    ),
  };

  const LBL: Record<Run["state"], string> = { wait: "Waiting", sim: "Simulating", sign: "Sign in your wallet", mine: "Confirming", done: "Done", fail: "Stopped" };
  const signStep = {
    key: "sign", title: "Sign",
    hint: "Each transaction is simulated first; your wallet is asked only if it would succeed. You can stop at any step.",
    body: (
      <div className="wz-review">
        <ol className="uo-calls">
          {calls.map((c, i) => {
            const r = runs[i];
            return (
              <li key={c.key} className={r?.state ?? "wait"}>
                <i aria-hidden>{r?.state === "done" ? "✓" : r?.state === "fail" ? "✕" : i + 1}</i>
                <span><b>{c.label}</b><small>to <code>{c.to.slice(0, 8)}…{c.to.slice(-4)}</code>{c.value > ZERO ? ` · sends ${fmt(c.value, 18)} ${net.nativeCurrency.symbol}` : ""}{r?.hash && <> · <a href={txUrl(plan.chain, r.hash)} target="_blank" rel="noopener noreferrer">transaction ↗</a></>}</small>{r?.err && <small className="cl-err">{r.err}</small>}</span>
                <em>{r ? LBL[r.state] : ""}</em>
              </li>
            );
          })}
        </ol>
        {!doneAll ? (
          <button type="button" className="btn sun" disabled={running || !calls.length} onClick={sendAll}>{runs.some((r) => r.state === "fail") ? "Try again" : running ? "Working…" : `Start: ${calls.length} transaction${calls.length > 1 ? "s" : ""}`}</button>
        ) : (
          <div className="uo-done"><b>Done.</b> Your position is at your address on {net.chainName}. <Link href="/portfolio">See it in Portfolio</Link>{plan.app && <> · manage or withdraw in <a href={plan.app} target="_blank" rel="noopener noreferrer">{plan.pname} ↗</a></>}</div>
        )}
        <TrailList t={plan.trail} />
        <p className="foot" style={{ margin: 0 }}>Your wallet signs and sends; dawns never holds funds and takes no fee. Not advice.</p>
      </div>
    ),
  };

  return <Wizard step={step} onStep={setStep} nextLabel="Review the transactions" steps={[checkStep, walletStep, amountStep, signStep]} />;
}
