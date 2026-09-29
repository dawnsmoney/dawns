"use client";

import { useMemo, useState } from "react";
import { Pill } from "./bits";
import { Wizard } from "./wizard";
import { creditDraft, checkAddress, type Roles } from "@/lib/strategies/to-credit";
import type { StrategyDoc } from "@/lib/strategies/model";

const HOW: Record<string, ["good" | "info" | "warn" | "crit", string]> = {
  network: ["good", "Network"], operator: ["info", "Operator"], "off-chain": ["warn", "Off-chain"], dropped: ["crit", "Not carried"],
};

/**
 * Launch a credit vault from a private-credit strategy, one step at a time:
 * check what maps, the borrowers' addresses, the three keys, then the mandate
 * file and the commands that open the vault on testnet-10.
 */
export function CreditLaunch({ doc, strategy, test }: {
  doc: StrategyDoc;
  strategy: { id: string; version: number; hash: string; strategist: string };
  /** dawns' testnet keys and borrower addresses, to try it end to end */
  test: { roles: Roles; borrowers: string[] } | null;
}) {
  const [step, setStep] = useState(0);
  const [borrowers, setBorrowers] = useState<string[]>([]);
  const [roles, setRoles] = useState<Roles>({ allocator: "", valuer: "", guardian: "" });
  const [copied, setCopied] = useState(false);
  const d = useMemo(() => creditDraft(doc, strategy, borrowers, roles), [doc, strategy, borrowers, roles]);
  const n = d.loans.length;
  const bErr = d.loans.map((_, i) => checkAddress(borrowers[i] ?? "", "kaspatest"));
  const rErr = (["allocator", "valuer", "guardian"] as const).map((k) => checkAddress(roles[k], "kaspatest"));
  const slug = (doc.name || "credit").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").slice(0, 4).join("-") || "credit";
  const json = d.mandate ? JSON.stringify(d.mandate, null, 2) + "\n" : "";
  const download = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    a.download = "credit-mandate.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1_000);
  };
  const cmds = [
    "cd ~/Desktop/dawns/vault/deploy && cargo build --release",
    `mkdir -p vaults/${slug} && cd vaults/${slug}`,
    "# move the downloaded credit-mandate.json into this folder, then:",
    "export DAWNS_KEYS=../../keys",
    "../../target/release/dawns-vault credit genesis",
    "../../target/release/dawns-vault credit token",
    "../../target/release/dawns-vault credit keeper",
  ].join("\n");

  return (
    <Wizard step={step} onStep={setStep} nextLabel="Make the mandate" steps={[
      {
        key: "check", title: "Check", hint: "How each term of the strategy lands in the credit vault covenant, and who enforces it.",
        ok: d.eligible, need: "Only a strategy of loans can launch as a credit vault",
        summary: d.eligible ? `${n} loan${n > 1 ? "s" : ""} · ready` : "not eligible",
        body: (
          <>
            {d.issues.length > 0 && (
              <div className="st-checks">
                {d.issues.map((x) => <div key={x.text} className={`st-check ${x.t === "info" ? "info" : x.t}`}><i aria-hidden>{x.t === "crit" ? "✕" : x.t === "warn" ? "!" : "i"}</i><span><b>{x.text}</b></span></div>)}
              </div>
            )}
            <div className="cl-map">
              {d.map.map((r) => (
                <div key={r.term} className="cl-row">
                  <span><b>{r.term}</b><small>{r.from}</small></span>
                  <span className="cl-to">{r.to}</span>
                  <Pill t={HOW[r.how][0]}>{HOW[r.how][1]}</Pill>
                </div>
              ))}
            </div>
          </>
        ),
      },
      {
        key: "borrowers", title: "Borrowers", hint: "Where each loan is sent: the borrower's own Kaspa wallet. Loans can go nowhere else; repayments come back through accounts bound to these addresses.",
        ok: bErr.every((e) => !e), need: "An address for every borrower",
        summary: `${bErr.filter((e) => !e).length} of ${n}`,
        body: (
          <div className="cl-fields">
            {d.loans.map((x, i) => (
              <label key={x.label} className="cl-field">
                <span><b>{x.label}</b><small>up to {x.capBps / 100}% of NAV · {x.rateBps / 100}% a year · {x.termDays} days</small></span>
                <input className="search mono" spellCheck={false} placeholder="kaspatest:…" value={borrowers[i] ?? ""} aria-invalid={!!borrowers[i] && !!bErr[i]}
                  onChange={(e) => setBorrowers((b) => { const c = [...b]; c[i] = e.target.value; return c; })} />
                {borrowers[i] && bErr[i] && <small className="cl-err">{bErr[i]}</small>}
              </label>
            ))}
            {test && <button type="button" className="btn ghost sm" style={{ justifySelf: "start" }} onClick={() => setBorrowers(test.borrowers.slice(0, n))}>Use dawns&apos; testnet borrower keys</button>}
          </div>
        ),
      },
      {
        key: "keys", title: "Keys", hint: "Three keys, each with one power. The deploy tool signs with them, so they must be the keys in its keys folder.",
        ok: rErr.every((e) => !e) && !!d.mandate, need: d.mandate || rErr.some((e) => e) ? "A valid address for each key" : "Each key and borrower needs its own address",
        summary: rErr.every((e) => !e) ? "3 keys" : undefined,
        body: (
          <div className="cl-fields">
            {([
              ["allocator", "Allocator", "Lends to a slot's borrower, within the caps and the reserve. Cannot pay anyone else."],
              ["valuer", "Valuer", "Marks loans a step at a time; writes off a loan at zero. Cannot move a sompi."],
              ["guardian", "Guardian", "Creates the share token; can halt new loans and deposits. Cannot take capital."],
            ] as const).map(([k, label, what], i) => (
              <label key={k} className="cl-field">
                <span><b>{label}</b><small>{what}</small></span>
                <input className="search mono" spellCheck={false} placeholder="kaspatest:…" value={roles[k]} aria-invalid={!!roles[k] && !!rErr[i]} onChange={(e) => setRoles((r) => ({ ...r, [k]: e.target.value }))} />
                {roles[k] && rErr[i] && <small className="cl-err">{rErr[i]}</small>}
              </label>
            ))}
            {test && <button type="button" className="btn ghost sm" style={{ justifySelf: "start" }} onClick={() => setRoles(test.roles)}>Use dawns&apos; testnet keys</button>}
            {d.issues.filter((x) => x.text.startsWith("Every borrower")).map((x) => <small key={x.text} className="cl-err">{x.text}</small>)}
          </div>
        ),
      },
      {
        key: "launch", title: "Launch", hint: "The mandate commits this strategy's hash: the vault is this version, for good. Save the file, then run the commands from your Terminal.",
        body: d.mandate ? (
          <div className="wz-review">
            <div className="cl-actions">
              <button type="button" className="btn sun sm" onClick={download}>Download credit-mandate.json</button>
              <button type="button" className="btn ghost sm" onClick={() => { navigator.clipboard?.writeText(json).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1400); }).catch(() => {}); }}>{copied ? "Copied" : "Copy"}</button>
            </div>
            <pre className="st-pre">{json}</pre>
            <span className="eyebrow muted">Then, in Terminal</span>
            <pre className="st-pre">{cmds}</pre>
            <p className="foot" style={{ margin: 0 }}>Testnet-10 only, not audited. <code>genesis</code> seeds only what the vault must keep, so the first shares are minted at NAV; <code>keeper</code> sweeps deposits, withdrawals and repayments, writes late loans down on schedule, and publishes the vault&apos;s ledger to dawns. A vault whose allocator is an approved curator key (dawns&apos; for now) then appears under Vaults, on this page and in depositors&apos; Portfolio.</p>
          </div>
        ) : <p className="muted">Fill in every address first.</p>,
      },
    ]} />
  );
}
