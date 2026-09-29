import { checkVault, type VaultKind } from "@/lib/vaults/vault-verify";
import { mandateHashOf } from "@/lib/vaults/verify-vault";
import { CREDIT_LATEST } from "@/lib/vaults/verify-credit";
import { NAV_LATEST } from "@/lib/vaults/verify-nav";

const SOMPI = 1e8;
const short = (h: string) => `${h.slice(0, 10)}…${h.slice(-6)}`;
const kas = (x: number) => `${x.toLocaleString("en-US", { maximumFractionDigits: 4 })} KAS`;
type Ledger = { covenant?: string; covenantId: string; address: string; state: unknown; moves: unknown[]; mandateHash: string; value: number };

/**
 * Three checks anyone could run, each with its answer: the mandate hashes to what the
 * ledger says; the vault's address is its covenant compiled with that mandate and
 * state (rebuilt and hashed here); a testnet node shows the coin there, carrying the
 * vault's covenant id.
 */
export async function VaultProof({ kind, l, m, compact }: { kind: VaultKind; l: Ledger; m: unknown; compact?: boolean }) {
  const c = await checkVault(kind, l, m);
  const mh = mandateHashOf(m);
  const latest = kind === "credit" ? CREDIT_LATEST : NAV_LATEST;
  const terms = kind === "credit" ? "keys, borrowers, caps, schedule, limits" : "keys, destinations, caps, limits";
  const rows: { ok: boolean | null; title: string; text: string }[] = [
    { ok: mh === l.mandateHash, title: "Mandate", text: mh === l.mandateHash ? `hashes to ${short(mh)}, the hash the ledger records` : `hashes to ${short(mh)}, not the ledger's ${short(l.mandateHash)}` },
    {
      ok: c.code.ok, title: "Code",
      text: c.code.ok
        ? `the address is blake2b of ${c.version} compiled with this mandate and state, rebuilt here byte for byte${c.version === latest ? "" : `. This version's address commits to the terms the covenant checks (${terms}), not the name or labels, which ${latest.split("/")[1] ? `v${latest.split("/")[1]}` : "the latest version"} adds`}`
        : c.code.why,
    },
    {
      ok: c.chain.state === "live" ? true : c.chain.state === "moved" ? false : null, title: "Chain",
      text: c.chain.state === "live" ? `${c.chain.node} shows ${kas(c.chain.amount / SOMPI)} at the address, carrying covenant id ${short(l.covenantId)}${c.chain.amount !== l.value ? ` (the ledger says ${kas(l.value / SOMPI)})` : ""}`
        : c.chain.state === "moved" ? `${c.chain.node} shows no coin with covenant id ${short(l.covenantId)} at the address: the vault has moved since this ledger`
        : "no testnet-10 node answered just now; the code check above needs none",
    },
  ];
  const all = rows.every((r) => r.ok);
  return (
    <div className={`cproof${all ? "" : " off"}${compact ? " compact" : ""}`}>
      <div className="cproof-h"><b>{all ? `Verified: this address runs the ${kind === "credit" ? "credit" : "NAV"} covenant with this mandate` : rows[1].ok ? "The code checks out" : "Not verified"}</b><small>checked {new Date(c.chain.at).toISOString().slice(0, 16).replace("T", " ")} UTC · no key, no trust in who published the ledger</small></div>
      <ol>
        {rows.map((r) => (
          <li key={r.title} className={r.ok === true ? "ok" : r.ok === false ? "no" : "na"}>
            <i aria-hidden>{r.ok === true ? "✓" : r.ok === false ? "✕" : "–"}</i>
            <span><b>{r.title}</b> {r.text}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
