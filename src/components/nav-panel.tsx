"use client";

import { useEffect, useMemo, useState } from "react";
import { accountAddress, ownerOf, fromHex, type AccountTemplate } from "@/lib/vaults/account";
import { CopyId } from "./viz";

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

/** Your position in the NAV vault: two personal addresses, what is on its way, your shares. */
export function NavPanel(p: NavPanelProps) {
  const saved = () => { try { return typeof window === "undefined" ? "" : localStorage.getItem(LS) ?? ""; } catch { return ""; } };
  const [addr, setAddr] = useState(saved);
  const [input, setInput] = useState(saved);
  const [err, setErr] = useState<string | null>(null);
  const [pos, setPos] = useState<Pos | null>(null);
  const [amount, setAmount] = useState(String(Math.max(10, Math.ceil(p.minDeposit + p.noteValue + p.maxFee))));
  const [busy, setBusy] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

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
      const r = await fetch(`/api/vaults/position?address=${encodeURIComponent(addr)}`).then((x) => x.json()).catch(() => null);
      if (!stop && r && !r.error) setPos(r as Pos);
    };
    fetch("/api/vaults/accounts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ vault: p.vault, address: addr }) }).catch(() => {});
    load();
    const t = setInterval(load, 20_000);
    return () => { stop = true; clearInterval(t); };
  }, [addr, accounts, p.vault]);

  const choose = (a: string) => {
    const v = a.trim().toLowerCase();
    try { ownerOf(v); setErr(null); setAddr(v); try { localStorage.setItem(LS, v); } catch { /* ignore */ } }
    catch (e) { setErr((e as Error).message); }
  };
  const connect = async () => {
    const w = kw();
    if (!w) { setErr("KasWare is not installed in this browser. Paste your address instead."); return; }
    try {
      const net = await w.getNetwork?.();
      if (net && !/testnet[-_]?10/i.test(net)) {
        if (w.switchNetwork) await w.switchNetwork("kaspa_testnet_10"); else { setErr("Switch KasWare to Testnet 10 first."); return; }
      }
      const [a] = await w.requestAccounts();
      setInput(a); choose(a);
    } catch (e) { setErr((e as Error).message ?? "KasWare refused"); }
  };
  const send = async (to: string, kasAmount: number, what: string) => {
    const w = kw();
    if (!w?.sendKaspa) { setErr("Your wallet can't send from this page. Send the amount to the address shown with any wallet."); return; }
    setBusy(what); setErr(null);
    try { const id = await w.sendKaspa(to, Math.round(kasAmount * 1e8)); setSent(`${what}: sent · ${String(id).slice(0, 16)}…`); }
    catch (e) { setErr((e as Error).message ?? "The wallet did not send"); }
    finally { setBusy(null); }
  };

  const credit = Math.max(0, Number(amount) - p.noteValue - p.maxFee);
  const estShares = p.price > 0 ? Math.floor(credit / p.price) : 0;
  const ok = accounts && !("error" in accounts) ? accounts : null;

  return (
    <div className="navp">
      <div className="navp-who">
        <input className="search" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && choose(input)} suppressHydrationWarning placeholder="Your kaspatest: address" aria-label="Your testnet address" />
        <button type="button" className="btn ghost" onClick={() => choose(input)}>Show my position</button>
        <button type="button" className="btn iris" onClick={connect}>Connect KasWare</button>
      </div>
      {err && <p className="navp-err">{err}</p>}
      {accounts && "error" in accounts && <p className="navp-err">{accounts.error}</p>}

      {ok && (
        <>
          <div className="depth-top" style={{ marginTop: 18 }}>
            <div><span className="eyebrow muted">Your shares</span><b>{pos ? pos.shares.toLocaleString("en-US") : "…"}</b><small>{pos ? `worth ${kas(pos.value)} at today's NAV` : "reading…"}</small></div>
            <div><span className="eyebrow muted">On its way in</span><b>{pos?.pendingDeposit ? kas(pos.pendingDeposit) : "—"}</b><small>{pos?.pendingDeposit ? "waiting for the next sweep (about a minute)" : "nothing pending"}</small></div>
            <div><span className="eyebrow muted">Withdrawal requested</span><b>{pos?.pendingRedeem ? "Queued" : "—"}</b><small>{pos?.pendingRedeem ? "paid when the vault holds the KAS" : "nothing pending"}</small></div>
          </div>

          <div className="navp-cols">
            <div className="navp-box">
              <h4>Deposit</h4>
              <p className="muted">Send KAS to your personal deposit address. The vault mints your shares at NAV; the network allows nothing else. Until then only you can take it back.</p>
              <div className="navp-amt"><input className="search" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} aria-label="Amount in KAS" /><span>KAS</span></div>
              <small className="muted">≈ {estShares.toLocaleString("en-US")} shares · {kas(p.noteValue, 2)} rides with your share note and comes back when you redeem · minimum {kas(p.minDeposit + p.noteValue + p.maxFee, 2)}</small>
              <button type="button" className="btn sun" disabled={!!busy || p.halted || Number(amount) < p.minDeposit + p.noteValue + p.maxFee} onClick={() => send(ok.deposit, Number(amount), "Deposit")}>{p.halted ? "Deposits closed (halted)" : busy === "Deposit" ? "Confirm in KasWare…" : "Deposit with KasWare"}</button>
              <div className="navp-addr"><small className="muted">or send from any wallet to</small><CopyId text={ok.deposit} /></div>
            </div>
            <div className="navp-box">
              <h4>Withdraw</h4>
              <p className="muted">Send 1 KAS to your withdrawal address. The vault burns one share note and pays its value at NAV{p.exitFeeBps ? `, less ${p.exitFeeBps / 100}%` : ""}, to your own address only, with the 1 KAS back.</p>
              <button type="button" className="btn ghost" disabled={!!busy || !pos?.shares || !p.maturityOpen} onClick={() => send(ok.redeem, 1, "Withdrawal")}>{!p.maturityOpen ? "Opens at maturity" : busy === "Withdrawal" ? "Confirm in KasWare…" : pos?.shares ? "Request withdrawal (1 KAS)" : "No shares yet"}</button>
              <div className="navp-addr"><small className="muted">withdrawal address</small><CopyId text={ok.redeem} /></div>
            </div>
          </div>
          {sent && <p className="navp-ok">{sent}. It shows here once the sweep picks it up.</p>}

          {pos && pos.notes.length > 0 && (
            <div className="vlog" style={{ marginTop: 18 }}>
              {pos.notes.slice().reverse().map((n) => (
                <div key={n.txid} className="vlog-row" style={{ ["--c" as string]: n.redeemed ? "#4A4270" : "#3987e5" }}>
                  <i />
                  <div><b>{n.shares.toLocaleString("en-US")} shares {n.redeemed ? "· redeemed" : ""}</b><small>{new Date(n.at * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC · minted at {n.price.toFixed(6)} KAS{n.redeemed ? ` · paid ${kas(n.redeemed.payout)}` : ""}</small></div>
                  <span className="amt">{n.redeemed ? "" : "live"}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
