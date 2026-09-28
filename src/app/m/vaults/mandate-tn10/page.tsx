import type { Metadata } from "next";
import { mandate as m, ledger as l, readLive, figures, SOMPI } from "@/lib/vault";
import { MCard, MFlags, MHead, MHero, MList, MRow, MStats } from "@/components/m/kit";
import { MTabs } from "@/components/m/tabs";
import { CapBars } from "@/components/viz";

export const metadata: Metadata = { title: "Mandate vault", description: "One owner, one mandate, enforced by the Kaspa network. Testnet-10." };
export const revalidate = 60;
const COLORS = ["#3987e5", "#d95926", "#199e70", "#c98500"];
const kas = (x: number) => `${x.toLocaleString("en-US", { maximumFractionDigits: 2 })} KAS`;
const when = (ms: number) => new Date(ms * (ms < 1e12 ? 1000 : 1)).toISOString().slice(0, 16).replace("T", " ");

export default async function MMandate() {
  const live = await readLive();
  const f = figures(l, m, live.daa);
  const dest = (i: number | null | undefined) => (i != null ? m.destinations[i]?.label.replace(" (test wallet)", "") : "");
  return (
    <>
      <MHead back={{ href: "/vaults", label: "Vaults" }} eyebrow="Mandate · testnet-10" title={m.name} sub="One owner, one mandate. The allocator cannot move capital outside it: the network refuses the transaction." />
      <div className="m-screen">
        <MFlags flags={[[live.matches ? "good" : "info", live.matches ? "The chain agrees with the ledger." : "Figures are the operator's ledger; the chain check did not match or answer."]]} />
        <MHero label="Value" value={kas(f.value)} sub={`${kas(f.inVault)} in the vault · ${kas(f.value - f.inVault)} deployed`} />
        <MStats items={[
          { label: "Moves", value: String(l.moves.length) },
          { label: "Refused by the network", value: String(l.refusals.length), sub: "breaches that never happened", tone: "good" },
        ]} />
        <MTabs tabs={[{ key: "c", label: "Caps" }, { key: "h", label: "History", badge: l.moves.length + l.refusals.length }]}>
          <div className="m-panel">
            <MCard title="Deployed against caps">
              <CapBars rows={m.destinations.map((d, i) => ({ key: d.address, label: d.label.replace(" (test wallet)", ""), share: f.value ? (f.deployed[i] ?? 0) / f.value : 0, cap: d.capBps / 1e4, display: `${Math.round(d.capBps / 100)}% cap`, color: COLORS[i] }))} />
            </MCard>
          </div>
          <div className="m-panel">
            <MCard flush>
              <MList>
                {[...l.moves.map((x) => ({ k: x.txid, at: x.at, t: x.kind === "allocate" ? `Sent to ${dest(x.slot)}` : x.kind === "recall" ? `Returned from ${dest(x.slot)}` : x.kind, v: x.amount ? kas(x.amount / SOMPI) : "", bad: false })),
                  ...l.refusals.map((x) => ({ k: `r${x.txid}`, at: x.at, t: `Refused: ${x.kind}`, v: x.amount ? kas(x.amount / SOMPI) : "", bad: true }))]
                  .sort((a, b) => b.at - a.at).map((x) => <MRow key={x.k} title={x.t} sub={when(x.at)} value={x.v} pill={x.bad ? { t: "crit", text: "Network refused" } : undefined} />)}
              </MList>
            </MCard>
          </div>
        </MTabs>
      </div>
    </>
  );
}
