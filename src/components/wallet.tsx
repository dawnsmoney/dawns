"use client";

import { useEffect, useState } from "react";

/* ---------- wallet shapes (only what dawns uses) ---------- */
type Kasware = { requestAccounts(): Promise<string[]>; signMessage(msg: string, opts?: { type?: "auto" | "schnorr" | "ecdsa" }): Promise<string> };
type Kastle = { connect(): Promise<boolean>; getAccount(): Promise<{ address: string; publicKey?: string }>; signMessage(msg: string): Promise<string> };
type Eip1193 = { request(args: { method: string; params?: unknown[] }): Promise<unknown> };
type Eip6963Detail = { info: { uuid: string; name: string; icon: string; rdns: string }; provider: Eip1193 };
declare global { interface Window { kasware?: Kasware; kastle?: Kastle; ethereum?: Eip1193 } }

export type Account = { id: string; wallets: { address: string; kind: "kaspa" | "evm" }[]; policy: unknown; plan: { at: string; lines: { id: string; name: string; usd: number }[] } | null; telegram: boolean; updatedAt: string | null } | null;
/** `open`: on a phone without an injected wallet, a link that opens this page inside the wallet app's own browser, where sign-in works as on desktop. */
export type WalletOption = { key: string; label: string; icon?: string; kind: "kaspa" | "evm"; installed: boolean; install?: string; open?: string };

/** MetaMask's universal link: opens the given page in the MetaMask app's browser (installs the app first if needed). */
export const metamaskLink = () => `https://metamask.app.link/dapp/${window.location.host}${window.location.pathname}${window.location.search}`;

/** EIP-6963: every injected EVM wallet announces itself (MetaMask, KasWare EVM, Kastle EVM, Rabby…). */
export function useWalletOptions(): WalletOption[] {
  const [evm, setEvm] = useState<Eip6963Detail[]>([]);
  const [kaspa, setKaspa] = useState({ kasware: false, kastle: false, eth: false, mobile: false, link: "" });
  useEffect(() => {
    const seen = new Map<string, Eip6963Detail>();
    const on = (e: Event) => { const d = (e as CustomEvent<Eip6963Detail>).detail; if (d?.info?.uuid && !seen.has(d.info.uuid)) { seen.set(d.info.uuid, d); setEvm([...seen.values()]); } };
    window.addEventListener("eip6963:announceProvider", on);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    // extensions inject a moment after load
    const t = setTimeout(() => setKaspa({ kasware: !!window.kasware, kastle: !!window.kastle, eth: !!window.ethereum,
      mobile: /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent)), link: metamaskLink() }), 400);
    return () => { window.removeEventListener("eip6963:announceProvider", on); clearTimeout(t); };
  }, []);
  // WalletConnect: any mobile wallet (MetaMask, Trust, Rabby…) by QR code on desktop or by app link on a phone
  const wc: WalletOption[] = WC_PROJECT ? [{ key: "walletconnect", label: "WalletConnect", kind: "evm", installed: true }] : [];
  // a phone's own browser has no wallet: offer to open this page inside the wallet app instead
  if (kaspa.mobile && !evm.length && !kaspa.eth && !kaspa.kasware && !kaspa.kastle)
    return [...wc,
      // MetaMask SDK: from Safari or Chrome, hands the request to the MetaMask app and comes back
      { key: "metamask-sdk", label: "MetaMask", kind: "evm", installed: true },
      { key: "metamask-app", label: "MetaMask", kind: "evm", installed: false, open: kaspa.link, install: "https://metamask.io/download/" },
    ];
  const opts: WalletOption[] = [
    { key: "kasware", label: "KasWare", kind: "kaspa", installed: kaspa.kasware, install: "https://www.kasware.xyz" },
    { key: "kastle", label: "Kastle", kind: "kaspa", installed: kaspa.kastle, install: "https://kastle.cc" },
    ...evm.map((d) => ({ key: `6963:${d.info.uuid}`, label: d.info.name, icon: d.info.icon, kind: "evm" as const, installed: true })),
  ];
  opts.push(...wc);
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

/** WalletConnect, loaded only when used. Needs NEXT_PUBLIC_WC_PROJECT_ID (a free project id from cloud.reown.com). */
const WC_PROJECT = process.env.NEXT_PUBLIC_WC_PROJECT_ID ?? "";
let wcProvider: Eip1193 | null = null;
async function walletConnect(): Promise<Eip1193> {
  if (wcProvider) return wcProvider;
  const { EthereumProvider } = await import("@walletconnect/ethereum-provider");
  const p = await EthereumProvider.init({
    projectId: WC_PROJECT, showQrModal: true, optionalChains: [1],
    optionalMethods: ["personal_sign", "eth_requestAccounts", "eth_accounts"],
    metadata: { name: "dawns.money", description: "The capital intelligence layer for Kaspa DeFi", url: window.location.origin, icons: [`${window.location.origin}/icon.svg`] },
  });
  if (!p.connected) await p.connect();
  wcProvider = p as unknown as Eip1193;
  return wcProvider;
}

/** The MetaMask SDK, loaded only when someone signs in with it (it is large). */
let sdkProvider: Eip1193 | null = null;
async function metamaskSdk(): Promise<Eip1193> {
  if (sdkProvider) return sdkProvider;
  const { MetaMaskSDK } = await import("@metamask/sdk");
  const sdk = new MetaMaskSDK({ dappMetadata: { name: "dawns.money", url: window.location.origin }, checkInstallationImmediately: false, useDeeplink: true, enableAnalytics: false });
  await sdk.connect();
  const p = sdk.getProvider();
  if (!p) throw new Error("MetaMask did not connect.");
  sdkProvider = p as unknown as Eip1193;
  return sdkProvider;
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
  } else if (key === "walletconnect") {
    const prov = await walletConnect();
    kind = "evm"; address = ((await prov.request({ method: "eth_requestAccounts" })) as string[])[0];
    sign = (m) => prov.request({ method: "personal_sign", params: [toHex(m), address] }) as Promise<string>;
  } else if (key === "metamask-sdk") {
    const prov = await metamaskSdk();
    kind = "evm"; address = ((await prov.request({ method: "eth_requestAccounts" })) as string[])[0];
    sign = (m) => prov.request({ method: "personal_sign", params: [toHex(m), address] }) as Promise<string>;
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
