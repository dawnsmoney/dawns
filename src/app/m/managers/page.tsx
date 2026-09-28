import type { Metadata } from "next";
import { MANAGERS, vaults } from "@/lib/vaults/registry";
import { MCard, MHead, MList, MNote, MRow } from "@/components/m/kit";

export const metadata: Metadata = { title: "Managers", description: "Who runs the vaults, what dawns has checked about them, and their record." };
export const revalidate = 60;

export default async function MManagers() {
  const vs = await vaults();
  return (
    <>
      <MHead back={{ href: "/vaults", label: "Vaults" }} title="Managers" sub="Who runs each vault, what dawns has verified about them, and what they have done." />
      <div className="m-screen">
        <MCard flush>
          <MList>{MANAGERS.map((m) => <MRow key={m.id} href={`/managers/${m.id}`} title={m.name} sub={`${m.kind} · since ${m.since}`} value={String(vs.filter((v) => v.manager === m.id).length)} valueSub="vaults" pill={{ t: "info", text: `${m.checks.filter((c) => c[1]).length} of ${m.checks.length} checks` }} />)}</MList>
        </MCard>
        <MNote>A manager holds a vault&apos;s allocator key. The covenant bounds what that key can do; the record shows what it did.</MNote>
      </div>
    </>
  );
}
