"use client";

import { useRouter } from "next/navigation";
import { openConnect } from "./connect";
import { shortAddr } from "./wallet";
import { AddressForm } from "./portfolio";

/**
 * Whose portfolio this is. Signed in, it is your wallets (all of them, EVM and Kaspa);
 * otherwise one Connect button, as on every wallet app. Any address can still be looked
 * up by hand, and a looked-up view can be shared as a link.
 */
export function PortfolioConnect({ value, mine, viewing }: { value?: string; mine?: string | null; viewing: string[] }) {
  const router = useRouter();
  const connect = () => openConnect().then(() => router.push("/portfolio")).then(() => router.refresh()).catch(() => null);
  const own = !value && !!mine;
  const drop = (a: string) => { const rest = viewing.filter((x) => x !== a); router.push(rest.length ? `/portfolio?a=${encodeURIComponent(rest.join(","))}` : "/portfolio"); };

  if (!viewing.length) {
    return (
      <div className="pf-start">
        <div><b>Connect a wallet to see your portfolio</b><small className="muted">KasWare, Kastle, Kaspium, MetaMask or any WalletConnect wallet. Signing proves the address is yours; no transaction, no fee.</small></div>
        <button type="button" className="btn sun" onClick={connect}>Connect wallet</button>
        <details className="more pf-paste"><summary>Or look up any address</summary><AddressForm value={value} /></details>
      </div>
    );
  }
  return (
    <div className="pf-connect">
      <div className="pf-who">
        <span className="pf-who-t"><b>{own ? "Your wallets" : "Looking up"}</b><small className="muted">{own ? "every wallet signed in to this account" : "read-only, from public data"}</small></span>
        <div className="pf-chips">
          {viewing.map((a) => <span key={a} className="pf-chip"><i className={a.startsWith("0x") ? "e" : "k"} />{shortAddr(a)}{!own && <button type="button" aria-label={`Remove ${a}`} onClick={() => drop(a)}>×</button>}</span>)}
        </div>
        <span className="pf-who-a">
          <button type="button" className="btn glass sm" onClick={() => (mine && !own ? router.push("/portfolio") : connect())}>{own ? "+ Add a wallet" : mine ? "My wallets" : "Connect wallet"}</button>
        </span>
      </div>
      <details className="more pf-paste"><summary>Look up another address</summary><AddressForm value={value} /></details>
    </div>
  );
}
