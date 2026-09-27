"use client";

import { useEffect, useState } from "react";

/* ---------- wallet shapes (only what dawns uses) ---------- */
type Kasware = { requestAccounts(): Promise<string[]>; signMessage(msg: string, opts?: { type?: "auto" | "schnorr" | "ecdsa" }): Promise<string> };
type Kastle = { connect(): Promise<boolean>; getAccount(): Promise<{ address: string; publicKey?: string }>; signMessage(msg: string): Promise<string> };
type Eip1193 = { request(args: { method: string; params?: unknown[] }): Promise<unknown> };
type Eip6963Detail = { info: { uuid: string; name: string; icon: string; rdns: string }; provider: Eip1193 };
declare global { interface Window { kasware?: Kasware; kastle?: Kastle; ethereum?: Eip1193 } }

export type Account = { id: string; wallets: { address: string; kind: "kaspa" | "evm" }[]; policy: unknown; plan: { at: string; lines: { id: string; name: string; usd: number }[] } | null; telegram: boolean; updatedAt: string | null } | null;
export type WalletOption = { key: string; label: string; icon?: string; kind: "kaspa" | "evm"; installed: boolean; install?: string };

/** EIP-6963: every injected EVM wallet announces itself (MetaMask, KasWare EVM, Kastle EVM, Rabby…). */
export function useWalletOptions(): WalletOption[] {
  const [evm, setEvm] = useState<Eip6963Detail[]>([]);
  const [kaspa, setKaspa] = useState({ kasware: false, kastle: false, eth: false });
  useEffect(() => {
    const seen = new Map<string, Eip6963Detail>();
    const on = (e: Event) => { const d = (e as CustomEvent<Eip6963Detail>).detail; if (d?.info?.uuid && !seen.has(d.info.uuid)) { seen.set(d.info.uuid, d); setEvm([...seen.values()]); } };
    window.addEventListener("eip6963:announceProvider", on);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    // extensions inject a moment after load
    const t = setTimeout(() => setKaspa({ kasware: !!window.kasware, kastle: !!window.kastle, eth: !!window.ethereum }), 400);
    return () => { window.removeEventListener("eip6963:announceProvider", on); clearTimeout(t); };
  }, []);
  const opts: WalletOption[] = [
    { key: "kasware", label: "KasWare", kind: "kaspa", installed: kaspa.kasware, install: "https://www.kasware.xyz" },
    { key: "kastle", label: "Kastle", kind: "kaspa", installed: kaspa.kastle, install: "https://kastle.cc" },
    ...evm.map((d) => ({ key: `6963:${d.info.uuid}`, label: d.info.name, icon: d.info.icon, kind: "evm" as const, installed: true })),
  ];
  if (!evm.length) opts.push({ key: "injected", label: "MetaMask or other EVM wallet", kind: "evm", installed: kaspa.eth, install: "https://metamask.io" });
  return opts;
}

let providers: Eip6963Detail[] = [];
if (typeof window !== "undefined") window.addEventListener("eip6963:announceProvider", (e) => { const d = (e as CustomEvent<Eip6963Detail>).detail; if (d?.info && !providers.some((p) => p.info.uuid === d.info.uuid)) providers = [...providers, d]; });

const toHex = (s: string) => `0x${[...new TextEncoder().encode(s)].map((b) => b.toString(16).padStart(2, "0")).join("")}`;

async function post<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error ?? "Something went wrong.");
  return j as T;
}

/** Connect a wallet, sign dawns' one-time message, and start a session. */
export async function signInWith(key: string): Promise<Account> {
  let kind: "kaspa" | "evm", address: string, sign: (m: string) => Promise<string>;
  if (key === "kasware") {
    const w = window.kasware; if (!w) throw new Error("KasWare is not installed in this browser.");
    kind = "kaspa"; address = (await w.requestAccounts())[0];
    sign = (m) => w.signMessage(m, { type: "auto" });
  } else if (key === "kastle") {
    const w = window.kastle; if (!w) throw new Error("Kastle is not installed in this browser.");
    kind = "kaspa"; if (!(await w.connect())) throw new Error("Kastle did not connect.");
    address = (await w.getAccount()).address;
    sign = (m) => w.signMessage(m);
  } else {
    const prov = key.startsWith("6963:") ? providers.find((p) => `6963:${p.info.uuid}` === key)?.provider : window.ethereum;
    if (!prov) throw new Error("No EVM wallet found in this browser.");
    kind = "evm"; address = ((await prov.request({ method: "eth_requestAccounts" })) as string[])[0];
    sign = (m) => prov.request({ method: "personal_sign", params: [toHex(m), address] }) as Promise<string>;
  }
  if (!address) throw new Error("The wallet did not share an address.");
  const { message, address: canonical } = await post<{ message: string; address: string }>("/api/auth/nonce", { kind, address });
  const signature = await sign(message);
  return post<Account>("/api/auth/verify", { kind, address: canonical, message, signature });
}

export async function signOut() { await post("/api/auth/logout", {}); }
export async function loadAccount(): Promise<Account> {
  const r = await fetch("/api/auth/me", { cache: "no-store" });
  return r.ok ? ((await r.json()) as Account) : null;
}
export const shortAddr = (a: string) => (a.startsWith("0x") ? `${a.slice(0, 6)}…${a.slice(-4)}` : `${a.slice(0, 12)}…${a.slice(-5)}`);
