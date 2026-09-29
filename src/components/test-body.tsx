import Link from "next/link";
import { STEPS, type Progress } from "@/lib/testing";
import { PioneerConnect } from "./pioneer-connect";
import { ReportLink, Survey, TestOpen } from "./test-bits";

const FAUCET = "https://faucet-tn10.kaspanet.io/";

/** The tester path: set up, then eight steps that tick themselves, then three questions. Desktop and phone. */
export function TestBody({ progress }: { progress: Progress | null }) {
  const done = progress ? STEPS.filter((s) => progress[s.key]).length : 0;
  const next = progress ? STEPS.find((s) => !progress[s.key])?.key : "wallet";
  return (
    <div className="pio">
      <TestOpen />
      <section className="card test-why">
        <b>The one thing we most want to know</b>
        <p>Can you tell, from the page alone, why a vault is safe or unsafe: what the Kaspa network enforces, and what you would be trusting someone for? If you can&apos;t, that&apos;s the most useful thing you can tell us.</p>
      </section>

      <section className="card">
        <div className="c-head"><h3>Before you start</h3><span className="tag">5 minutes, once</span></div>
        <ol className="test-setup">
          <li><b>A Kaspa wallet on Testnet 10.</b> Install <a href="https://kasware.xyz" target="_blank" rel="noopener noreferrer">KasWare</a> (browser extension) and switch its network to Testnet 10. Kastle works too. Your address starts with <code>kaspatest:</code>.</li>
          <li><b>Test KAS from the faucet.</b> Paste your <code>kaspatest:</code> address at <a href={FAUCET} target="_blank" rel="noopener noreferrer">faucet-tn10.kaspanet.io</a>. It has no value: nothing you do here can cost you money.</li>
          <li><b>Come back and sign in.</b> Signing proves the address is yours. It sends nothing and costs nothing.</li>
        </ol>
      </section>

      <section className="card">
        <div className="c-head"><h3>The path</h3><span className="tag">{done} of {STEPS.length} done</span></div>
        <div className="test-bar" aria-hidden><i style={{ width: `${(done / STEPS.length) * 100}%` }} /></div>
        <ol className="test-steps">
          {STEPS.map((s, i) => {
            const ok = !!progress?.[s.key];
            const cur = s.key === next;
            return (
              <li key={s.key} className={ok ? "ok" : cur ? "cur" : ""}>
                <span className="test-n" aria-label={ok ? "done" : "to do"}>{ok ? "✓" : i + 1}</span>
                <div><b>{s.title}</b><small>{s.how}</small></div>
                <div className="test-cta">
                  {ok ? <em>Done</em>
                    : s.key === "wallet" ? <PioneerConnect />
                    : s.key === "report" ? <ReportLink />
                    : s.key === "survey" ? <a className="btn ghost sm" href="#survey">Answer</a>
                    : s.href ? <Link className={`btn ${cur ? "sun" : "ghost"} sm`} href={s.href}>{s.cta}</Link> : null}
                </div>
              </li>
            );
          })}
        </ol>
        <p className="muted" style={{ fontSize: 13, margin: "12px 0 0" }}>Steps tick themselves from what dawns records: your wallets, the vaults&apos; ledgers, your plans and alerts. A deposit shows once the vault has minted your shares, usually within a few minutes. Signed in, testing earns Pioneer points: 200 for your first testnet deposit, 200 for your first withdrawal, 500 for each real problem you report.</p>
      </section>

      <section className="card" id="survey">
        <div className="c-head"><h3>Three questions</h3><span className="tag">when you&apos;ve tried it</span></div>
        <Survey signedIn={!!progress} done={!!progress?.survey} />
      </section>

      <section className="pio-terms">
        <b>Testnet only.</b> These vaults run on Kaspa testnet-10 and are not audited. Test KAS has no value, and nothing on this page asks for real KAS. Stuck? <ReportLink label="Tell us" /> and say where.
      </section>
    </div>
  );
}
