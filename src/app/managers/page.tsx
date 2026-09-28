import type { Metadata } from "next";
import Link from "next/link";
import { Banner } from "@/components/Banner";
import { MANAGERS, trackRecord } from "@/lib/vaults/registry";

export const metadata: Metadata = { title: "Vault managers", description: "Who runs each vault, what they have done, and what dawns has checked about them." };
export const revalidate = 60;

export default async function ManagersPage() {
  const records = await Promise.all(MANAGERS.map((m) => trackRecord(m.id)));
  return (
    <>
      <Banner short crumb={[{ href: "/vaults", label: "Vaults" }, { label: "Managers" }]} title="Managers"
        lede="A manager runs vaults inside mandates the network enforces. Here is who they are, what they have done, and what dawns has checked." />
      <div className="wrap" style={{ paddingTop: 40, display: "grid", gap: 28 }}>
        <div className="vcards">
          {MANAGERS.map((m, i) => {
            const t = records[i];
            const done = m.checks.filter((c) => c[1]).length;
            return (
              <Link key={m.id} href={`/managers/${m.id}`} className="card vcard">
                <span className="vc-top"><span className="mgr-chip plain"><span className="mgr-av">{m.letter}</span><span><b>{m.name}</b><small>{m.kind}</small></span></span></span>
                <small className="muted">{m.about}</small>
                <span className="vc-figs"><span><small>Vaults</small><b>{t.vaults.length}</b></span><span><small>Live</small><b>{t.live}</b></span><span><small>Moves</small><b>{t.moves}</b></span><span><small>Checks</small><b>{done}/{m.checks.length}</b></span></span>
              </Link>
            );
          })}
          <div className="card vcard dim">
            <b className="vc-name">Run a mandate on dawns</b>
            <small className="muted">Testnet first: your mandate, your keys, every path proven against the engine. Outside managers open after an independent audit and a legal review.</small>
          </div>
        </div>
      </div>
    </>
  );
}
