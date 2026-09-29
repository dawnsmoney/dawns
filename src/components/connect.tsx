"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { loadAccount, shortAddr, signInWith, signOut, useWalletOptions, type Account, type SignStep, type WalletOption } from "./wallet";

/**
 * One way in, as on every wallet-native app: a Connect button opens a wallet picker,
 * the picker shows each step (approve the connection, sign a free message, done) and
 * the header then shows the connected account. Signing proves the address is yours;
 * nothing is sent on-chain.
 */
type Req = { resolve: (a: Account) => void; reject: (e: Error) => void };
export function openConnect(): Promise<Account> {
  return new Promise((resolve, reject) => window.dispatchEvent(new CustomEvent<Req>("dawns:connect", { detail: { resolve, reject } })));
}

/** The signed-in account, kept in step with every sign-in and sign-out on the page. */
export function useAccount() {
  const [account, setAccount] = useState<Account>(null);
  const [ready, setReady] = useState(false);
  const refresh = useCallback(() => loadAccount().then((a) => { setAccount(a); setReady(true); }).catch(() => setReady(true)), []);
  useEffect(() => {
    const t = setTimeout(refresh, 0);
    window.addEventListener("dawns:auth", refresh);
    return () => { clearTimeout(t); window.removeEventListener("dawns:auth", refresh); };
  }, [refresh]);
  return { account, ready, refresh };
}

const GROUPS: { title: string; kind: "kaspa" | "evm"; note: string }[] = [
  { title: "Kaspa wallets", kind: "kaspa", note: "Kaspa L1" },
  { title: "EVM wallets", kind: "evm", note: "Igra and Kasplex" },
];
const MONO: Record<string, [string, string, string]> = {
  kasware: ["K", "#49EACB", "#0E7A6A"], kastle: ["K", "#FFB86B", "#C2410C"], kaspium: ["K", "#9E8CFF", "#4B34D6"],
  walletconnect: ["W", "#6FA8FF", "#2F6BE0"], "metamask-sdk": ["M", "#FFB36B", "#E2761B"], "metamask-app": ["M", "#FFB36B", "#E2761B"], injected: ["E", "#B6ADE8", "#5B4BF0"],
};
const nice = (w: WalletOption) => (w.key.startsWith("6963:") && /kasware/i.test(w.label) ? "KasWare (EVM)" : w.label.replace(" (phone)", ""));

function WalletIcon({ w, size = 36 }: { w: WalletOption; size?: number }) {
  if (w.icon && /^data:image\//.test(w.icon))
    // eslint-disable-next-line @next/next/no-img-element -- EIP-6963 icons are data: URIs
    return <img src={w.icon} alt="" width={size} height={size} className="cw-icon" />;
  const [g, a, b] = MONO[w.key] ?? [w.label[0] ?? "?", "#B6ADE8", "#5B4BF0"];
  return <span className="cw-icon mono" style={{ width: size, height: size, background: `linear-gradient(135deg,${a},${b})`, fontSize: size * 0.45 }}>{g}</span>;
}

const STEPS: [SignStep, string, (n: string) => string][] = [
  ["connect", "Approve the connection", (n) => `A ${n} window asks to share your address.`],
  ["sign", "Sign a message", () => "Free, no transaction: it proves the address is yours."],
  ["verify", "Signed in", () => "dawns checks the signature."],
];

export function ConnectModal() {
  const wallets = useWalletOptions();
  const [req, setReq] = useState<Req | null>(null);
  const [pick, setPick] = useState<WalletOption | null>(null);
  const [step, setStep] = useState<SignStep | "done">("connect");
  const [addr, setAddr] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);
  const run = useRef(0);

  useEffect(() => {
    const on = (e: Event) => { setReq((e as CustomEvent<Req>).detail); setPick(null); setErr(null); setAddr(null); };
    window.addEventListener("dawns:connect", on);
    return () => window.removeEventListener("dawns:connect", on);
  }, []);
  useEffect(() => {
    if (!pick || step !== "connect" || err) return;
    const t = setTimeout(() => setSlow(true), 7000);
    return () => clearTimeout(t);
  }, [pick, step, err]);
  useEffect(() => {
    if (!req) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") { run.current++; req.reject(new Error("Cancelled.")); setReq(null); } };
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [req]);

  if (!req) return null;
  const close = () => { run.current++; req.reject(new Error("Cancelled.")); setReq(null); };
  const go = async (w: WalletOption) => {
    if (w.key === "kaspium") {       // Kaspium signs in by a self-send: its own dialog
      const r = req; setReq(null);
      signInWith("kaspium").then((a) => { window.dispatchEvent(new Event("dawns:auth")); r.resolve(a); }, r.reject);
      return;
    }
    const id = ++run.current;
    setPick(w); setStep("connect"); setErr(null); setAddr(null); setSlow(false);
    try {
      const a = await signInWith(w.key, (s, ad) => { if (id === run.current) { setStep(s); if (ad) setAddr(ad); } });
      if (id !== run.current) return;
      setStep("done");
      window.dispatchEvent(new Event("dawns:auth"));
      setTimeout(() => { req.resolve(a); setReq(null); }, 900);
    } catch (e) {
      if (id !== run.current) return;
      const m = (e as Error).message || "The wallet did not respond.";
      setErr(/reject|denied|cancel/i.test(m) ? "You declined in the wallet. Try again when you're ready." : m);
    }
  };
  const idx = step === "done" ? 3 : STEPS.findIndex(([s]) => s === step);
  const name = pick ? nice(pick) : "";

  return (
    <>
      <div className="scrim cw-scrim" onClick={close} />
      <div className="modal cw" role="dialog" aria-modal="true" aria-label="Connect a wallet">
        <button type="button" className="x btn ghost sm" onClick={close} aria-label="Close">✕</button>
        {!pick ? (
          <>
            <h2>Connect a wallet</h2>
            {GROUPS.map((g) => {
              const list = wallets.filter((w) => w.kind === g.kind);
              if (!list.length) return null;
              return (
                <div key={g.kind} className="cw-group">
                  <div className="cw-gh"><b>{g.title}</b><small>{g.note}</small></div>
                  {list.map((w) => w.installed ? (
                    <button key={w.key} type="button" className="cw-row" onClick={() => go(w)}>
                      <WalletIcon w={w} /><span className="cw-n"><b>{nice(w)}</b><small>{w.key === "kaspium" ? "Phone wallet · sign in by a small self-send" : w.key === "walletconnect" ? "Scan with any mobile wallet" : w.key === "metamask-sdk" ? "Opens the MetaMask app" : "Detected in this browser"}</small></span>
                      <span className="cw-tag">{w.key === "kaspium" || w.key === "walletconnect" || w.key === "metamask-sdk" ? "›" : "Installed"}</span>
                    </button>
                  ) : (
                    <a key={w.key} className="cw-row off" href={w.open ?? w.install} target={w.open ? undefined : "_blank"} rel="noopener noreferrer">
                      <WalletIcon w={w} /><span className="cw-n"><b>{nice(w)}</b><small>{w.open ? "Open this page in the app" : "Not installed"}</small></span>
                      <span className="cw-tag get">{w.open ? "Open ↗" : "Get ↗"}</span>
                    </a>
                  ))}
                </div>
              );
            })}
            <p className="cw-foot">Signing in proves the address is yours with a free message. dawns never asks for a transaction or access to funds.</p>
          </>
        ) : (
          <div className="cw-steps">
            <button type="button" className="cw-back" onClick={() => { run.current++; setPick(null); }}>‹ All wallets</button>
            <div className="cw-hero"><WalletIcon w={pick} size={64} />{!err && step !== "done" && <span className="cw-ring" />}{step === "done" && <span className="cw-ok">✓</span>}</div>
            <h2 style={{ justifyContent: "center", padding: 0 }}>{step === "done" ? "Connected" : err ? "Not connected" : `Continue in ${name}`}</h2>
            {addr && <p className="cw-addr mono">{shortAddr(addr)}</p>}
            <ol className="cw-list">
              {STEPS.map(([s, t, sub], i) => (
                <li key={s} className={err && i === idx ? "err" : i < idx ? "done" : i === idx ? "on" : ""}>
                  <i aria-hidden>{err && i === idx ? "!" : i < idx ? "✓" : i + 1}</i>
                  <span><b>{t}</b><small>{sub(name)}</small></span>
                </li>
              ))}
            </ol>
            {slow && step === "connect" && !err && <p className="cw-hint">No window? Click the {name} icon in your browser&apos;s toolbar; wallet pop-ups sometimes open behind this one.</p>}
            {err && <p className="cw-err">{err}</p>}
            {err && <button type="button" className="btn iris" onClick={() => go(pick)}>Try again</button>}
          </div>
        )}
      </div>
    </>
  );
}

/** The header's account control: Connect, or the connected address with its menu. */
export function AccountButton({ compact }: { compact?: boolean }) {
  const { account } = useAccount();
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState<{ top: number; right: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const d = (e: PointerEvent) => { const t = e.target as Node; if (!ref.current?.contains(t) && !menu.current?.contains(t)) setOpen(false); };
    const c = () => setOpen(false);
    document.addEventListener("pointerdown", d);
    window.addEventListener("resize", c);
    window.addEventListener("scroll", c, { passive: true });
    return () => { document.removeEventListener("pointerdown", d); window.removeEventListener("resize", c); window.removeEventListener("scroll", c); };
  }, [open]);
  if (!account) return <button type="button" className={`acct-btn connect ${compact ? "sm" : ""}`} onClick={() => openConnect().catch(() => null)}>Connect</button>;
  const first = account.wallets[0]?.address ?? "";
  return (
    <div className="acct" ref={ref}>
      <button type="button" className={`acct-btn ${compact ? "sm" : ""}`} aria-expanded={open} aria-haspopup="menu" onClick={(e) => {
        // the header nav scrolls sideways on small screens, which would clip an absolute menu: place it on the viewport
        const r = e.currentTarget.getBoundingClientRect();
        setAt({ top: r.bottom + 8, right: Math.max(8, window.innerWidth - r.right) }); setOpen((v) => !v);
      }}>
        <span className="acct-av" style={{ background: `conic-gradient(from ${parseInt(first.slice(-4), 16) % 360}deg,#FFD27A,#F0679A,#8C7CF0,#FFD27A)` }} />
        {!compact && <span className="mono">{shortAddr(first)}</span>}
        {account.wallets.length > 1 && <em>+{account.wallets.length - 1}</em>}
      </button>
      {open && at && createPortal(
        <div className="acct-menu" role="menu" ref={menu} style={at ? { position: "fixed", top: at.top, right: at.right } : undefined}>
          <div className="acct-ws">{account.wallets.map((w) => <span key={w.address}><i className={w.kind} />{w.kind === "kaspa" ? "Kaspa" : "EVM"} <span className="mono">{shortAddr(w.address)}</span></span>)}</div>
          <Link href="/portfolio" onClick={() => setOpen(false)}>Portfolio</Link>
          <Link href="/allocate" onClick={() => setOpen(false)}>Profile &amp; alerts</Link>
          <button type="button" onClick={() => { setOpen(false); openConnect().catch(() => null); }}>Add another wallet</button>
          <button type="button" className="out" onClick={async () => { setOpen(false); await signOut(); window.dispatchEvent(new Event("dawns:auth")); }}>Sign out</button>
        </div>,
        document.body,
      )}
    </div>
  );
}
