"use client";

import { useEffect, useMemo, useState } from "react";
import { accountAddress, ownerOf, fromHex, type AccountTemplate } from "@/lib/vaults/account";
import { CopyId } from "./viz";
import { MiniSteps } from "./wizard";
import { openConnect, useAccount } from "./connect";
import { decodeKaspaAddress, encodeKaspaAddress } from "@/lib/auth/kaspa";

/** The vault lives on testnet-10: a mainnet address of the same key is shown in its testnet form. */
const toTestnet = (a: string | null) => { if (!a || !a.startsWith("kaspa:")) return a; try { const d = decodeKaspaAddress(a); return encodeKaspaAddress("kaspatest", d.version, d.payload); } catch { return a; } };

type KW = {
  requestAccounts(): Promise<string[]>;
  getNetwork?(): Promise<string>;
  switchNetwork?(n: string): Promise<unknown>;
  sendKaspa?(to: string, sompi: number, opts?: { priorityFee?: number }): Promise<string>;
};
const kw = () => (typeof window === "undefined" ? undefined : (window as unknown as { kasware?: KW }).kasware);

interface Pos {
  address: string; deposit: string; redeem: string; pendingDeposit: number | null; pendingRedeem: number | null; shares: number; value: number;
  notes: { shares: number; at: number; txid: string; price: number; redeemed: { at: number; payout: number; txid: string } | null }[];
}
export interface NavPanelProps { vault: string; template: AccountTemplate; price: number; minDeposit: number; noteValue: number; maxFee: number; exitFeeBps: number; halted: boolean; maturityOpen: boolean }

const kas = (x: number, d = 4) => `${x.toLocaleString("en-US", { maximumFractionDigits: d })} KAS`;
const LS = "dawns.nav.address";

/**
 * Your position in the NAV vault. The address comes from the connected account (a Kaspa
 * wallet, testnet or mainnet: same key, same owner), or one pasted by hand. Deposit and
 * withdraw are one box with two tabs; sending from another wallet is one tap away.
 */
export function NavPanel(p: NavPanelProps) {
  const { account } = useAccount();
  const [manual, setManual] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pos, setPos] = useState<Pos | null>(null);
  const [tab, setTab] = useState<"in" | "out">("in");
  const [dstep, setDstep] = useState(0);
  const [amount, setAmount] = useState(String(Math.max(10, Math.ceil(p.minDeposit + p.noteValue + p.maxFee))));
  const [busy, setBusy] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [hasKw, setHasKw] = useState(false);

  useEffect(() => { const t = setTimeout(() => { setHasKw(!!kw()); if (new URLSearchParams(window.location.search).get("do") === "withdraw") setTab("out"); try { const v = localStorage.getItem(LS); if (v) setManual(v); } catch { /* private mode */ } }, 300); return () => clearTimeout(t); }, []);
  const fromAccount = account?.wallets.find((w) => w.address.startsWith("kaspatest:"))?.address ?? account?.wallets.find((w) => w.kind === "kaspa")?.address ?? null;
  const addr = toTestnet(manual ?? fromAccount);

  const accounts = useMemo(() => {
    if (!addr) return null;
    try {
      const { owner } = ownerOf(addr);
      const cov = fromHex(p.vault);
      return { deposit: accountAddress(p.template, owner, cov, 0), redeem: accountAddress(p.template, owner, cov, 1) };
    } catch (e) { return { error: (e as Error).message }; }
  }, [addr, p.vault, p.template]);

  useEffect(() => {
    if (!addr || !accounts || "error" in accounts) return;
    let stop = false;
    const load = async () => {
      const r = await fetch(`/api/vaults/position?address=${encodeURIComponent(addr)}&vault=${p.vault}`).then((x) => x.json()).catch(() => null);
      if (!stop && r && !r.error) setPos(r as Pos);
    };
    fetch("/api/vaults/accounts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ vault: p.vault, address: addr }) }).catch(() => {});
    load();
    const t = setInterval(load, 20_000);
    return () => { stop = true; clearInterval(t); };
  }, [addr, accounts, p.vault]);

  const choose = (a: string) => {
    const v = a.trim().toLowerCase();
    try { ownerOf(v); setErr(null); setManual(v); setEditing(false); setPos(null); try { localStorage.setItem(LS, v); } catch { /* ignore */ } }
    catch (e) { setErr((e as Error).message); }
  };
  const useAccountAddress = () => { setManual(null); setEditing(false); setPos(null); try { localStorage.removeItem(LS); } catch { /* ignore */ } };
  const send = async (to: string, kasAmount: number, what: string) => {
    const w = kw();
    if (!w?.sendKaspa) { setErr("This wallet can't send from the page. Send the amount to the address below from any wallet."); return; }
    setBusy(what); setErr(null);
    try {
      const net = await w.getNetwork?.();
      if (net && !/testnet[-_]?10/i.test(net)) { if (w.switchNetwork) await w.switchNetwork("kaspa_testnet_10"); else throw new Error("Switch KasWare to Testnet 10 first."); }
      const id = await w.sendKaspa(to, Math.round(kasAmount * 1e8)); setSent(`${what} sent · ${String(id).slice(0, 16)}…`);
    }
    catch (e) { setErr((e as Error).message ?? "The wallet did not send"); }
    finally { setBusy(null); }
  };

  const min = p.minDeposit + p.noteValue + p.maxFee;
  const credit = Math.max(0, Number(amount) - p.noteValue - p.maxFee);
  const estShares = p.price > 0 ? Math.floor(credit / p.price) : 0;
  const ok = accounts && !("error" in accounts) ? accounts : null;

  if (!addr || editing) {
    return (
      <div className="navp navp-empty" id="position">
        {!editing && <><b>See your position and deposit</b><small className="muted">Connect a Kaspa wallet (KasWare, Kastle). Testnet and mainnet addresses of the same key are the same owner.</small>
          <button type="button" className="btn iris" onClick={() => openConnect().catch(() => null)}>Connect wallet</button></>}
        <form className="navp-paste" onSubmit={(e) => { e.preventDefault(); choose(input); }}>
          <input className="search" value={input} onChange={(e) => setInput(e.target.value)} placeholder="or paste a kaspatest: address" aria-label="Your testnet address" spellCheck={false} />
          <button type="submit" className="btn ghost sm">Show</button>
          {editing && <button type="button" className="btn ghost sm" onClick={() => setEditing(false)}>Cancel</button>}
        </form>
        {err && <p className="navp-err">{err}</p>}
      </div>
    );
  }

  return (
    <div className="navp" id="position">
      <div className="navp-id">
        <span className="acct-av" style={{ background: `conic-gradient(from ${parseInt(addr.slice(-4), 36) % 360}deg,#FFD27A,#F0679A,#8C7CF0,#FFD27A)` }} />
        <span className="mono">{addr.slice(0, 16)}…{addr.slice(-6)}</span>
        <small className="muted">{manual ? "pasted" : "your connected wallet"}</small>
        <button type="button" className="linkish" onClick={() => { setInput(""); setEditing(true); }}>Change</button>
        {manual && fromAccount && <button type="button" className="linkish" onClick={useAccountAddress}>Use my wallet</button>}
      </div>
      {accounts && "error" in accounts && <p className="navp-err">{accounts.error}</p>}

      {ok && (
        <>
          <div className="navp-hero">
            <div className="navp-main"><span className="eyebrow muted">Your position</span><b>{pos ? kas(pos.value, 2) : "…"}</b><small>{pos ? `${pos.shares.toLocaleString("en-US")} shares at ${p.price.toFixed(6)} KAS each` : "reading the vault…"}</small></div>
            <div className="navp-pend">
              <span className={pos?.pendingDeposit ? "on" : ""}><i />{pos?.pendingDeposit ? `${kas(pos.pendingDeposit, 2)} on its way in` : "No deposit pending"}</span>
              <span className={pos?.pendingRedeem ? "on" : ""}><i />{pos?.pendingRedeem ? "Withdrawal queued" : "No withdrawal pending"}</span>
            </div>
          </div>

          <div className="navp-grid">
          <div className="navp-box">
            <div className="navp-tabs" role="tablist">
              <button type="button" role="tab" aria-selected={tab === "in"} className={tab === "in" ? "on" : ""} onClick={() => setTab("in")}>Deposit</button>
              <button type="button" role="tab" aria-selected={tab === "out"} className={tab === "out" ? "on" : ""} onClick={() => setTab("out")}>Withdraw</button>
            </div>
            {tab === "in" ? (
              <>
                <MiniSteps items={["Amount", "Confirm", "Sent"]} at={sent?.startsWith("Deposit") ? 2 : dstep} />
                {dstep === 0 && !sent?.startsWith("Deposit") && <>
                  <div className="navp-amt big"><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} aria-label="Amount in KAS" /><span>KAS</span></div>
                  <div className="navp-quick">{[10, 50, 100, 500].map((v) => <button key={v} type="button" className={Number(amount) === v ? "on" : ""} onClick={() => setAmount(String(v))}>{v}</button>)}</div>
                  <button type="button" className="btn sun" disabled={p.halted || Number(amount) < min} onClick={() => { setErr(null); setDstep(1); }}>{p.halted ? "Deposits closed (halted)" : Number(amount) < min ? `At least ${kas(min, 2)}` : "Continue"}</button>
                </>}
                {dstep === 1 && !sent?.startsWith("Deposit") && <>
                  <dl className="navp-kv">
                    <div><dt>You send</dt><dd>{kas(Number(amount), 2)}</dd></div>
                    <div><dt>You receive</dt><dd>≈ {estShares.toLocaleString("en-US")} shares at {p.price.toFixed(6)} KAS</dd></div>
                    <div><dt>Held with your note</dt><dd>{kas(p.noteValue, 2)}, returned when you redeem</dd></div>
                    <div><dt>Network fee, at most</dt><dd>{kas(p.maxFee, 2)}</dd></div>
                  </dl>
                  {hasKw ? <button type="button" className="btn sun" disabled={!!busy} onClick={() => send(ok.deposit, Number(amount), "Deposit")}>{busy === "Deposit" ? "Confirm in KasWare…" : `Deposit ${kas(Number(amount), 2)}`}</button>
                    : <p className="muted" style={{ margin: 0 }}>Send {kas(Number(amount), 2)} to your deposit address below from any Kaspa wallet.</p>}
                  <details className="navp-alt" open={!hasKw}><summary>Send from another wallet</summary><div><CopyId text={ok.deposit} /><small className="muted">Your personal deposit address. The vault mints shares at NAV; until then only you can take the KAS back.</small></div></details>
                  <button type="button" className="linkish" style={{ justifySelf: "start" }} onClick={() => setDstep(0)}>← Change the amount</button>
                </>}
                {sent?.startsWith("Deposit") && <button type="button" className="btn ghost sm" style={{ justifySelf: "start" }} onClick={() => { setSent(null); setDstep(0); }}>Deposit more</button>}
              </>
            ) : (
              <>
                <p className="muted" style={{ margin: 0 }}>The vault burns one share note and pays its value at NAV{p.exitFeeBps ? `, less ${p.exitFeeBps / 100}%` : ""}, to your own address only. You send 1 KAS to ask; it comes back with the payout.</p>
                <dl className="navp-kv">
                  <div><dt>You hold</dt><dd>{pos ? `${pos.shares.toLocaleString("en-US")} shares · ${kas(pos.value, 2)}` : "…"}</dd></div>
                  <div><dt>Paid to</dt><dd className="mono">{addr.slice(0, 14)}…{addr.slice(-6)}</dd></div>
                </dl>
                {hasKw ? <button type="button" className="btn sun" disabled={!!busy || !pos?.shares || !p.maturityOpen} onClick={() => send(ok.redeem, 1, "Withdrawal")}>{!p.maturityOpen ? "Opens at maturity" : busy === "Withdrawal" ? "Confirm in KasWare…" : pos?.shares ? "Request withdrawal" : "No shares yet"}</button> : null}
                <details className="navp-alt" open={!hasKw}><summary>Send from another wallet</summary><div><CopyId text={ok.redeem} /><small className="muted">Send exactly 1 KAS to your withdrawal address.</small></div></details>
              </>
            )}
            {err && <p className="navp-err">{err}</p>}
            {sent && <p className="navp-ok">{sent}. It shows here once the sweep picks it up.</p>}
          </div>

          <div className="navp-notes">
            <h4>Your share notes</h4>
            {pos && pos.notes.length > 0 ? (
              <div className="vlog">
                {pos.notes.slice().reverse().map((n) => (
                  <div key={n.txid} className="vlog-row" style={{ ["--c" as string]: n.redeemed ? "#4A4270" : "#3987e5" }}>
                    <i />
                    <div><b>{n.shares.toLocaleString("en-US")} shares {n.redeemed ? "· redeemed" : ""}</b><small>{new Date(n.at * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC · minted at {n.price.toFixed(6)} KAS{n.redeemed ? ` · paid ${kas(n.redeemed.payout)}` : ""}</small></div>
                    <span className="amt">{n.redeemed ? "" : "live"}</span>
                  </div>
                ))}
              </div>
            ) : <p className="muted" style={{ margin: 0 }}>{pos ? "No notes yet. Each deposit mints one note of shares; each withdrawal burns one." : "Reading…"}</p>}
          </div>
          </div>
        </>
      )}
    </div>
  );
}
