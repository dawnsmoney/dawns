import Link from "next/link";
import type { Metadata } from "next";
import { Banner } from "@/components/Banner";
import { Pill, SERIES } from "@/components/bits";
import { AreaChart } from "@/components/charts";
import { SplitBar, Columns } from "@/components/viz";
import { Kpi, ProvRow } from "@/components/actions";
import { DataBridge } from "@/components/providers";
import { Fresh } from "@/components/Fresh";
import { Alert, Bell, Check, External, Info } from "@/components/icons";
import { getSnapshot } from "@/lib/snapshot";
import { toLite } from "@/lib/view";
import { usd, pct } from "@/lib/format";
import { tgLink } from "@/lib/tglink";

export const metadata: Metadata = {
  title: "Igra bridge",
  description: "Is iKAS fully backed? KAS locked on Kaspa L1 against iKAS in circulation on Igra, read live, with every exit through the canonical bridge.",
};
export const revalidate = 120;

const ENTRY = "kaspa:ppvnxxzm0rr37zpnwux2f2ntvfpr4uqdpm7zsvsztg3en92r7gs0wkmr72q9n";
const EXIT = "0x4bb88C213d3eD9dc4bae694f1bc1bF745903b2d0";
const kas = (n: number, d = 0) => `${n.toLocaleString("en-US", { maximumFractionDigits: d })} KAS`;
const shortKas = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : n.toFixed(0));
const age = (s: number) => (s < 3600 ? `${Math.max(1, Math.round(s / 60))} min ago` : s < 172_800 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86_400)} days ago`);
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export default async function BridgePage() {
  const s = await getSnapshot();
  const b = s.bridge;
  const px = s.kasUsd;
  const tg = tgLink("watch_igra-bridge");
  const bridge = <DataBridge prov={s.prov} protocols={s.protocols.map(toLite)} signals={s.signals} />;

  if (!b)
    return (
      <>
        {bridge}
        <Banner short crumb={[{ href: "/", label: "Kaspa DeFi" }, { label: "Igra bridge" }]} title="Igra bridge" lede="The bridge could not be read on this run. dawns retries every two minutes." />
        <div className="wrap" style={{ paddingTop: 40 }}><div className="card"><p className="muted">{s.errors.find((e) => e.startsWith("Igra bridge")) ?? "No data."}</p></div></div>
      </>
    );

  const ok = b.coverage >= 1;
  const po = b.payouts;
  const pending = po ? po.unpaidKas : b.inWindowKas;
  const hrs = (ms: number) => { const h = ms / 3600_000; return h < 48 ? `${Math.max(1, Math.round(h))} h` : `${Math.round(h / 24)} days`; };
  const t = b.coverage >= 1 ? "good" : b.coverage >= 0.99 ? "warn" : "crit";
  // payout times of recent exits, in buckets
  const now = b.timestamp * 1000;
  const took = b.recentExits.map((e) => (e.paidAt ? (e.paidAt - (now - e.ageSec * 1000)) / 3600_000 : null));
  const waiting = b.recentExits.filter((e) => !e.paidTx);
  const payoutCols = [
    { key: "a", label: "< 12 h", value: took.filter((h) => h != null && h < 12).length, color: "#199e70" },
    { key: "b", label: "12–24 h", value: took.filter((h) => h != null && h >= 12 && h < 24).length, color: "#199e70" },
    { key: "c", label: "24–48 h", value: took.filter((h) => h != null && h >= 24 && h < 48).length, color: "#3987e5" },
    { key: "d", label: "48–72 h", value: took.filter((h) => h != null && h >= 48 && h < 72).length, color: "#c98500" },
    { key: "e", label: "> 72 h", value: took.filter((h) => h != null && h >= 72).length, color: "#d95926" },
    { key: "w", label: "Waiting", value: waiting.length, color: "#4A4270" },
  ];
  return (
    <>
      {bridge}
      <Banner short crumb={[{ href: "/", label: "Kaspa DeFi" }, { label: "Igra bridge" }]} title="Is iKAS fully backed?"
        lede={<>Every iKAS on Igra should have one KAS locked on Kaspa L1. dawns reads both sides live. <span style={{ whiteSpace: "nowrap" }}>Igra #{b.block.toLocaleString("en-US")} · <Fresh since={b.timestamp * 1000} /></span></>}>
        <div className="tags" style={{ marginTop: 18 }}>
          <Pill t={t}>{ok ? "Fully backed" : "Under-backed"}</Pill>
          <Link className="btn glass sm" href="/proof/igra-bridge">Proof of reserves</Link>
          {tg && <a className="btn sun sm" href={tg} target="_blank" rel="noopener noreferrer"><Bell />Alert me on Telegram</a>}
        </div>
      </Banner>
      <div className="wrap">
        <div className="grid g5 lift">
          <Kpi label="Backing" value={pct(b.coverage)} ctx={<span className={ok ? "up" : "down"}>{ok ? "KAS ≥ iKAS" : "KAS < iKAS"}</span>} prov="bridge-cov" />
          <Kpi label="KAS locked on L1" value={shortKas(b.lockedKas)} ctx={<span className="flat">{px ? usd(b.lockedKas * px) : "Entry address"}</span>} prov="bridge-cov" />
          <Kpi label="iKAS on Igra" value={shortKas(b.ikasSupply)} ctx={<span className="flat">in circulation</span>} prov="bridge-cov" />
          {po ? (
            <>
              <Kpi label="Awaiting L1 payout" value={shortKas(po.unpaidKas)} ctx={<span className={po.late ? "down" : "flat"}>{po.unchecked ? `checking ${po.unchecked} more exits` : po.late ? `${po.late} over 72h` : "none late"}</span>} />
              <Kpi label="Typical payout time" value={po.medianHours != null ? `${Math.round(po.medianHours)} h` : "—"} ctx={<span className="flat">median, last 30 days</span>} />
            </>
          ) : (
            <>
              <Kpi label="Exits in release window" value={shortKas(b.inWindowKas)} ctx={<span className="flat">{b.inWindowCount} in the last 72h</span>} />
              <Kpi label="Exited all-time" value={shortKas(b.totalBurnedKas)} ctx={<span className="flat">{b.exitsTotal.toLocaleString("en-US")} exits</span>} />
            </>
          )}
        </div>

        <section className="ps">
          <h2>Backing</h2>
          <div className="grid gA">
            <div className="card">
              <div className="c-head"><h3>Both sides of the bridge</h3><span className="tag">live</span></div>
              <div className="vlist">
                <ProvRow id="bridge-cov" className="vrow"><span style={{ color: "var(--ink-3)" }}><Info /></span><div>KAS locked on Kaspa L1<small>Balance of the bridge Entry address</small></div><b>{kas(b.lockedKas)}</b></ProvRow>
                <ProvRow id="bridge-cov" className="vrow"><span style={{ color: "var(--ink-3)" }}><Info /></span><div>iKAS in circulation<small>Native supply on Igra</small></div><b>{kas(b.ikasSupply)}</b></ProvRow>
                <div className="vrow"><span /><div>{b.surplusKas >= 0 ? "Surplus" : "Shortfall"}<small>Locked minus minted</small></div><b className={b.surplusKas >= 0 ? "up" : "down"}>{b.surplusKas >= 0 ? "+" : "−"}{kas(Math.abs(b.surplusKas))}</b></div>
                <ProvRow id="bridge-cov" className="vrow"><span style={{ color: ok ? "var(--good)" : "var(--crit)" }}>{ok ? <Check /> : <Alert />}</span><div><b style={{ fontSize: 15 }}>Backing</b><small>KAS locked ÷ iKAS minted</small></div><b className={ok ? "up" : "down"}>{pct(b.coverage)}</b></ProvRow>
              </div>
            </div>
            <div className="card">
              <div className="c-head"><h3>Where the locked KAS goes</h3><span className="tag">{shortKas(b.lockedKas)} KAS</span></div>
              <SplitBar label="Locked KAS" parts={[
                { key: "ikas", label: "Backs iKAS in circulation", color: "#3987e5", share: Math.min(b.ikasSupply, b.lockedKas) },
                ...(b.surplusKas > 0 ? [
                  { key: "exits", label: "Exits awaiting L1 payout", color: "#c98500", share: Math.min(pending, b.surplusKas) },
                  { key: "extra", label: "Surplus beyond pending exits", color: "#199e70", share: Math.max(0, b.surplusKas - pending) },
                ] : []),
              ].filter((x) => x.share > 0)} />
              {payoutCols.some((c) => c.value > 0) && (
                <div style={{ marginTop: 22 }}>
                  <div className="eyebrow muted" style={{ marginBottom: 10 }}>How long the last {b.recentExits.length} exits took to be paid on L1</div>
                  <Columns label="Payout times" cols={payoutCols} />
                </div>
              )}
            </div>
            <div className="card">
              <div className="c-head"><h3>Why it reads above 100%</h3></div>
              <p style={{ margin: 0, color: "var(--ink-2)", fontSize: 15, lineHeight: 1.6 }}>
                Leaving Igra takes two steps. KasExitBridge burns the iKAS on Igra straight away. The guardian committee then sends the KAS from the L1 Entry address, usually within 48–72 hours.
                Until that happens, the KAS still counts as locked but the iKAS is already gone.
              </p>
              <p style={{ margin: "14px 0 0", color: "var(--ink-2)", fontSize: 15, lineHeight: 1.6 }}>
                {po ? <>Exits burned on Igra but not yet paid on L1 total <b>{kas(pending)}</b>.</> : <>Exits requested in the last 72 hours total <b>{kas(pending)}</b>.</>} The surplus is <b>{kas(Math.max(0, b.surplusKas))}</b>.
                {b.surplusKas >= 0 && pending > 0 ? (Math.abs(b.surplusKas - pending) <= pending * 0.1 ? " The surplus is about what unpaid exits explain." : b.surplusKas > pending ? " The surplus is larger than unpaid exits explain. That is safe for holders." : " Unpaid exits are larger than the surplus: once they are paid, backing would fall below 100% unless new deposits arrive.") : ""}
              </p>
              <p className="foot" style={{ marginTop: 14 }}>{po ? `dawns matches each exit to a Kaspa L1 payment from the Entry address to its payout address. ${po.paid.toLocaleString("en-US")} of ${po.indexed.toLocaleString("en-US")} exits are matched so far.` : "dawns is still matching exits to their L1 payouts."}</p>
            </div>
          </div>
        </section>

        {b.history && b.history.length >= 3 && (
          <div className="card" style={{ marginTop: 22 }}>
            <div className="c-head"><h3>Backing · hourly</h3><span className="tag">dawns history</span></div>
            <AreaChart label="iKAS backing" hourly fmt="pct" stats refLine={1} refLabel="100%" area="none" dates={b.history.map((x) => x.t)} series={[{ name: "Backing", color: SERIES[2], values: b.history.map((x) => x.v) }]} height={220} />
          </div>
        )}

        <section className="ps">
          <h2>Recent exits</h2>
          <div className="card flush"><div className="tbl-wrap"><table>
            <thead><tr><th>Exit</th><th>Amount</th><th>Value</th><th>Requested</th><th>Igra tx</th><th>Kaspa L1 payout</th></tr></thead>
            <tbody>
              {b.recentExits.slice(0, 25).map((e) => (
                <tr key={e.id}>
                  <td><b>#{e.id}</b></td>
                  <td>{kas(e.kas)}</td>
                  <td className="muted">{px ? usd(e.kas * px) : "—"}</td>
                  <td>{age(e.ageSec)}</td>
                  <td className="mono" style={{ fontSize: 13 }}>{e.tx ? <a href={`https://explorer.igralabs.com/tx/${e.tx}`} target="_blank" rel="noopener noreferrer">{e.tx.slice(0, 10)}…</a> : <a href={`https://explorer.igralabs.com/block/${e.block}`} target="_blank" rel="noopener noreferrer">#{e.block.toLocaleString("en-US")}</a>}</td>
                  <td>
                    {e.paidTx ? (
                      <a href={`https://explorer.kaspa.org/txs/${e.paidTx}`} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none" }}>
                        <Pill t={e.paidKas != null && Math.abs(e.paidKas - e.kas) > 1e-8 ? "warn" : "good"}>{`Paid in ${hrs((e.paidAt ?? 0) - (b.timestamp * 1000 - e.ageSec * 1000))}${e.paidKas != null && Math.abs(e.paidKas - e.kas) > 1e-8 ? ` · ${kas(e.paidKas)}` : ""}`}</Pill>
                      </a>
                    ) : po ? (e.ageSec > 72 * 3600 ? <Pill t="warn">{`Not found after ${hrs(e.ageSec * 1000)}`}</Pill> : <Pill t="info">{`Waiting ${hrs(e.ageSec * 1000)}`}</Pill>)
                      : e.ageSec <= 72 * 3600 ? <Pill t="info">Pending payout</Pill> : <Pill t="good">Past 72h</Pill>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div></div>
          <p className="foot">Read with KasExitBridge.getExitRequest(id), newest first. A payout counts when a Kaspa L1 transaction spends from the Entry address and sends the exit amount to the payout address the user gave. An amount in orange means the payment differed from the exit amount.</p>
        </section>

        <section className="ps">
          <h2>Exit rules</h2>
          <div className="grid gA">
            <div className="card">
              <div className="c-head"><h3>Limits set in the contract</h3></div>
              <div className="vlist">
                <div className="vrow"><span /><div>Smallest exit</div><b>{kas(b.config.minExitKas)}</b></div>
                <div className="vrow"><span /><div>Largest exit</div><b>{kas(b.config.maxExitKas)}</b></div>
                <div className="vrow"><span /><div>Throttle window<small>{b.config.windowBlocks.toLocaleString("en-US")} blocks, about {Math.round((b.config.windowBlocks * b.blockTimeSec) / 3600)} h</small></div><b>{b.config.maxExitsPerWindow} exits · {shortKas(b.config.maxUnlockPerWindowKas)} KAS</b></div>
                <div className="vrow"><span /><div>Fees charged all-time</div><b>{kas(b.totalFeesKas, 2)}</b></div>
              </div>
            </div>
            <div className="card">
              <div className="c-head"><h3>Current window</h3><span className="tag">ends at #{b.throttle.windowEndsAtBlock.toLocaleString("en-US")}</span></div>
              <div className="vlist">
                <div className="vrow"><span /><div>Exits left in this window</div><b>{b.throttle.remainingExits} of {b.config.maxExitsPerWindow}</b></div>
                <div className="vrow"><span /><div>KAS that can still exit</div><b>{kas(b.throttle.remainingUnlockKas)}</b></div>
              </div>
              <p className="foot" style={{ marginTop: 14 }}>If the window fills up, new exits wait for the next one. A large run on iKAS would show up here first.</p>
            </div>
          </div>
        </section>

        <section className="ps">
          <h2>Contracts</h2>
          <div className="card flush"><div className="tbl-wrap"><table>
            <thead><tr><th>Contract</th><th>Address</th><th>Upgradeable</th><th>Controlled by</th></tr></thead>
            <tbody>
              <tr><td><b>Entry address</b><br /><small className="muted">Kaspa L1 · P2SH multisig</small></td><td><a href={`https://explorer.kaspa.org/addresses/${ENTRY}`} target="_blank" rel="noopener noreferrer">{ENTRY.slice(0, 16)}…{ENTRY.slice(-6)}</a></td><td>—</td><td>Guardian committee</td></tr>
              <tr><td><b>KasExitBridge</b><br /><small className="muted">Igra</small></td><td><a href={`https://explorer.igralabs.com/address/${EXIT}`} target="_blank" rel="noopener noreferrer">{short(EXIT)}</a></td><td>{b.implementation ? <Pill t="warn">{`Proxy → ${short(b.implementation)}`}</Pill> : <Pill t="good">No</Pill>}</td><td>{b.ownerIsContract ? "Contract owner (multisig or timelock)" : <Pill t="warn">Single key</Pill>} <a href={`https://explorer.igralabs.com/address/${b.owner}`} target="_blank" rel="noopener noreferrer">{short(b.owner)}</a></td></tr>
            </tbody>
          </table></div></div>
        </section>

        <section className="ps">
          <h2>Verification</h2>
          <div className="grid gA">
            <div className="card">
              <div className="c-head"><h3>What dawns checks</h3></div>
              <div className="vlist">
                {[["KAS held by the Entry address", "api.kaspa.org address balance"], ["iKAS in circulation", "Igra explorer coin supply"], ["Every exit request", "KasExitBridge.getExitRequest, nextExitRequestId"], ["L1 payout per exit", "Kaspa L1 payments from the Entry address to each payout address"], ["Limits, throttle and owner", "getConfig, throttleStatus, owner, EIP-1967 slot"]].map(([a, c]) => (
                  <div className="vrow" key={a}><span style={{ color: "var(--good)" }}><Check /></span><div>{a}<small>{c}</small></div><b /></div>
                ))}
              </div>
            </div>
            <div className="card">
              <div className="c-head"><h3>Not yet checked</h3></div>
              <div className="vlist">
                {[["Guardian set and threshold", "The multisig script behind the Entry address is not decoded yet"], ["Why a payout differs", "Some payouts are smaller than the exit amount; the reason is not published on-chain"]].map(([a, c]) => (
                  <div className="vrow" key={a}><span style={{ color: "var(--ink-3)" }}><Info /></span><div>{a}<small>{c}</small></div><b /></div>
                ))}
              </div>
              <div style={{ marginTop: 18 }}><a className="btn ghost sm" href="https://github.com/argonmining/igra-kas-bridge" target="_blank" rel="noopener noreferrer"><External />Bridge source</a></div>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
