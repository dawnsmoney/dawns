import type { Metadata } from "next";
import { getNav, navFigures, readNavLive, SOMPI, FIRST_PRICE } from "@/lib/vaults/nav";
import { VaultProof } from "@/components/vault-proof";
import { MCard, MFlags, MHead, MHero, MKv, MList, MNote, MRow, MStats } from "@/components/m/kit";
import { MMore, MTabs } from "@/components/m/tabs";
import { NavPanel } from "@/components/nav-panel";
import { SharePriceChart } from "@/components/share-chart";
import { sharePoints } from "@/lib/vaults/share-history";
import { CapBars, CopyId, SplitBar } from "@/components/viz";
import { Pill } from "@/components/bits";

export const metadata: Metadata = { title: "NAV vault", description: "Deposit KAS from any wallet, get shares at NAV, redeem at NAV. Testnet-10." };
export const revalidate = 30;

const COLORS = ["#3987e5", "#d95926", "#199e70", "#c98500"];
const LIQUID = "#9085e9";
const kas = (x: number, d = 2) => `${x.toLocaleString("en-US", { maximumFractionDigits: d })} KAS`;
const pct = (x: number, d = 0) => `${(x * 100).toFixed(d)}%`;
const short = (s: string) => (s.length > 22 ? `${s.slice(0, 12)}…${s.slice(-6)}` : s);
const when = (sec: number) => new Date(sec * 1000).toISOString().slice(0, 16).replace("T", " ");

export default async function MNav() {
  const { l, m } = await getNav();
  if (!l || !m) return (<><MHead back={{ href: "/vaults", label: "Vaults" }} title="NAV vault" sub="Launching on testnet-10." /></>);
  const live = await readNavLive(l);
  const f = navFigures(l, m);
  const maturityOpen = m.maturityDaa === 0 || (live.daa != null && live.daa - 100 >= m.maturityDaa);
  const since = f.price / (FIRST_PRICE / SOMPI) - 1;
  const payable = f.nav > 0 ? Math.min(1, Math.max(0, f.liquid / f.nav)) : 1;
  const valueTotal = f.liquid + f.marks.reduce((s, x) => s + x, 0);
  const name = (i: number | undefined) => (i != null ? m.destinations[i]?.label.replace(" (test wallet)", "") ?? "" : "");
  const log = [...l.moves].reverse().map((x) => ({
    key: x.txid, at: x.at,
    title: x.kind === "deposit" ? "Deposit" : x.kind === "redeem" ? "Withdrawal" : x.kind === "allocate" ? `Sent to ${name(x.slot)}` : x.kind === "recall" ? `Returned from ${name(x.slot)}` : x.kind === "mark" ? "Positions marked" : x.kind === "halt" ? "Guardian halted the vault" : x.kind === "token" ? "Share token created" : x.kind,
    amt: x.kind === "deposit" ? `+${kas((x.paid ?? 0) / SOMPI)}` : x.kind === "redeem" ? `−${kas((x.payout ?? 0) / SOMPI)}` : x.kind === "allocate" ? `−${kas((x.amount ?? 0) / SOMPI)}` : x.kind === "recall" ? `+${kas((x.amount ?? 0) / SOMPI)}` : "",
  }));
  const history = sharePoints(l.createdAt, l.moves, FIRST_PRICE / SOMPI, f.price, (x) => { const e = log.find((y) => y.key === x.txid); return { title: e?.title ?? x.kind, amt: e?.amt || undefined }; });
  return (
    <>
      <MHead back={{ href: "/vaults", label: "Vaults" }} eyebrow="NAV · testnet-10 · not audited" title={m.name}
        right={l.state.halted ? <Pill t="crit">Halted</Pill> : <Pill t="good">Open</Pill>} />
      <div className="m-screen">
        <VaultProof kind="nav" l={l} m={m} compact />
        <MHero label="NAV" value={kas(f.nav)} sub={`${kas(f.liquid)} liquid · ${kas(f.marks.reduce((s, x) => s + x, 0))} in positions`} />
        <MStats items={[
          { label: "Per share", value: f.price.toFixed(6), sub: f.shares ? `${since >= 0 ? "+" : "−"}${pct(Math.abs(since), 2)} since launch` : "launch price" },
          { label: "Holders", value: String(f.holders), sub: `${f.shares.toLocaleString("en-US")} shares` },
          { label: "Payable now", value: pct(payable), sub: "of NAV held liquid" },
          { label: "Exit fee", value: `${m.exitFeeBps / 100}%`, sub: "kept for holders" },
        ]} />
        <MCard title="Share price since launch"><SharePriceChart points={history} launch={FIRST_PRICE / SOMPI} label="Share price since launch" /></MCard>
        <MTabs tabs={[{ key: "y", label: "Deposit & withdraw" }, { key: "h", label: "Holdings" }, { key: "l", label: "History", badge: l.moves.length }, { key: "r", label: "Rules" }]}>
          <div className="m-panel">
            <MCard><NavPanel vault={l.covenantId} template={l.accountTemplate} price={f.price} minDeposit={m.minDepositSompi / SOMPI} noteValue={m.noteValueSompi / SOMPI} maxFee={m.maxFeeSompi / SOMPI} exitFeeBps={m.exitFeeBps} halted={l.state.halted} maturityOpen={maturityOpen} /></MCard>
            <MNote>Testnet KAS only. You send plain KAS from your wallet; the network enforces what happens next.</MNote>
          </div>
          <div className="m-panel">
            <MCard title="Where the NAV is">
              <SplitBar label="NAV by place" height={18} parts={[...m.destinations.map((d, i) => ({ key: `d${i}`, label: d.label.replace(" (test wallet)", ""), color: COLORS[i], share: f.marks[i] ?? 0 })), { key: "liquid", label: "Liquid in the vault", color: LIQUID, share: Math.max(0, f.liquid) }]} />
            </MCard>
            <MCard title="Caps per destination" tag="at cost">
              <CapBars rows={m.destinations.map((d, i) => ({ key: d.address, label: d.label.replace(" (test wallet)", ""), share: valueTotal ? (f.cost[i] ?? 0) / valueTotal : 0, cap: d.capBps / 1e4, display: `${pct(valueTotal ? (f.cost[i] ?? 0) / valueTotal : 0, 1)} / ${pct(d.capBps / 1e4)}`, color: COLORS[i] }))} />
            </MCard>
          </div>
          <div className="m-panel">
            <MCard flush>
              <MList>
                <MMore first={10} label="All moves">
                  {log.map((x) => <MRow key={x.key} href={`https://tn10.kaspa.stream/transactions/${x.key}`} ext title={x.title} sub={when(x.at)} value={x.amt} />)}
                </MMore>
              </MList>
            </MCard>
          </div>
          <div className="m-panel">
            <MCard title="Who can do what">
              <MFlags flags={[
                ["info", "Allocator: moves capital to approved destinations and brings it back. Cannot pay anyone else."],
                ["info", "Valuer: marks each position once per period, within a fixed step. Cannot move a sompi."],
                ["info", "Guardian: created the share token and can halt the vault. Cannot take capital or stop withdrawals."],
                ["good", "Anyone: runs deposits and withdrawals; the outcome is fixed by the rules."],
              ]} />
            </MCard>
            <MCard title="The mandate">
              <MKv rows={[["Minimum deposit", kas(m.minDepositSompi / SOMPI)], ["Mark step", `≤ ${m.maxMarkStepBps / 100}% per period`], ["Reserve floor", pct(m.reserveFloorBps / 1e4)], ["Vault address", short(l.address)]]} />
              <CopyId text={l.mandateHash} />
            </MCard>
          </div>
        </MTabs>
      </div>
    </>
  );
}
