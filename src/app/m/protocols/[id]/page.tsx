import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSnapshot, findProtocol } from "@/lib/snapshot";
import { MCard, MFlags, MHead, MKv, MList, MNote, MRow, MStats } from "@/components/m/kit";
import { MMore, MTabs } from "@/components/m/tabs";
import { AssetCoin, Change, Pill, ProtocolCoin } from "@/components/bits";
import { SplitBar } from "@/components/viz";
import { AreaChart } from "@/components/charts";
import { WatchButton } from "@/components/actions";
import { DataBridge } from "@/components/providers";
import { Fresh } from "@/components/Fresh";
import { protocolTiles, toLite } from "@/lib/view";
import { usd, pct } from "@/lib/format";
import type { ProtocolView, Status } from "@/lib/types";

export const revalidate = 120;
export const dynamicParams = true;
export async function generateStaticParams() {
  try { return (await getSnapshot()).protocols.map((p) => ({ id: p.id })); } catch { return []; }
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const p = findProtocol(await getSnapshot(), (await params).id);
  return p ? { title: `${p.name} health` } : {};
}

const explorer = (chain: string, a: string) => `${chain === "kasplex" ? "https://explorer.kasplex.org" : "https://explorer.igralabs.com"}/address/${a}`;
const short = (a: string) => (a.startsWith("0x") && a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);
const COLORS = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#9085e9"];

function Overview({ p, sig }: { p: ProtocolView; sig: { t: Status; strong: string }[] }) {
  return (
    <div className="m-panel">
      <MCard title="dawns' reading" tag={<Pill t={p.status}>{p.statusText}</Pill>}>
        <MStats items={protocolTiles(p).map((t) => ({ label: t.title, value: t.big, sub: t.small, tone: t.t === "info" ? undefined : t.t }))} />
      </MCard>
      {(p.flags.length > 0 || sig.length > 0) && (
        <MCard title="Signals">
          <MFlags flags={[...p.flags, ...sig.filter((g) => !p.flags.some(([, x]) => x === g.strong)).map((g) => [g.t, g.strong] as [Status, string])].slice(0, 8)} />
        </MCard>
      )}
      <MCard title={p.lending ? "Withdrawable liquidity" : "Value locked"} tag="dawns history">
        {p.intraday.length > 2
          ? <AreaChart series={[{ name: p.name, color: "#8578E6", values: p.intraday.map((x) => x.v) }]} dates={p.intraday.map((x) => x.t)} label={`${p.name} value, hourly`} height={180} hourly />
          : p.history.length > 2 ? <AreaChart series={[{ name: p.name, color: "#8578E6", values: p.history.map((x) => x.v) }]} dates={p.history.map((x) => x.t)} label={`${p.name} value, daily`} height={180} range="3M" />
          : <MNote>Not enough history yet.</MNote>}
      </MCard>
      {p.tokens.length > 0 && (
        <MCard title="What it holds" tag={usd(p.tvl)}>
          <SplitBar label="Held by asset" height={18} parts={p.tokens.slice(0, 6).map((t, i) => ({ key: t.sym, label: t.sym, color: COLORS[i], share: t.usd }))} />
        </MCard>
      )}
    </div>
  );
}

function Lending({ p }: { p: ProtocolView }) {
  const L = p.lending!;
  return (
    <div className="m-panel">
      <MStats items={[
        { label: "Supplied", value: usd(L.suppliedUsd), sub: `${L.markets.length} markets` },
        { label: "Borrowed", value: usd(L.borrowedUsd), sub: `${pct(L.utilization)} of supply` },
        { label: "Withdrawable now", value: usd(L.cashUsd), sub: <Change v={p.d24} /> },
        { label: "Asset coverage", value: pct(L.coverage), sub: L.coverage >= 1 ? "claims covered" : "claims not covered", tone: L.coverage >= 1 ? "good" : "crit" },
      ]} />
      <MCard title="Markets" tag="can suppliers leave?" flush>
        <MList>
          {[...L.markets].sort((a, b) => b.suppliedUsd - a.suppliedUsd).map((m) => {
            const out = m.suppliedUsd ? m.cashUsd / m.suppliedUsd : 0;
            const t: Status = m.utilization >= 0.95 ? "crit" : m.frozen || !m.oracleOk ? "warn" : m.utilization >= 0.8 ? "warn" : "good";
            return (
              <MRow key={m.symbol} icon={<AssetCoin a={m.symbol} size={34} />} title={`${m.symbol} · ${pct(m.supplyApy, 1)}`}
                sub={<>{usd(m.suppliedUsd)} supplied · {pct(m.utilization, 0)} used<span className="m-bar"><i style={{ width: `${Math.max(2, out * 100)}%`, background: out < 0.05 ? "var(--crit)" : out < 0.2 ? "var(--warn)" : "var(--good)" }} /></span></>}
                value={usd(m.cashUsd)} valueSub="can leave now"
                pill={t !== "good" ? { t, text: m.utilization >= 0.95 ? "Exit blocked" : m.frozen ? "Frozen" : !m.oracleOk ? "Oracle fault" : "Tight" } : undefined} />
            );
          })}
        </MList>
      </MCard>
      {L.positions && (
        <MCard title="Borrowers" tag={`${L.positions.borrowers} accounts`}>
          <MStats items={[
            { label: "Can be liquidated", value: usd(L.positions.liquidatableUsd), sub: `${L.positions.liquidatable} accounts below 1.0`, tone: L.positions.liquidatableUsd > 0 ? "warn" : "good" },
            { label: "Bad debt", value: usd(L.positions.badDebtUsd), sub: `${L.positions.badDebtAccounts} accounts`, tone: L.positions.badDebtUsd > 0 ? "crit" : "good" },
          ]} />
          <SplitBar label="Debt by health factor" height={16} parts={L.positions.buckets.filter((b) => b.debtUsd > 0).map((b, i) => ({ key: b.label, label: `HF ${b.label}`, color: ["#FF7A7A", "#FFC061", "#8578E6", "#4ADE9B"][i % 4], share: b.debtUsd, note: `${b.accounts} accounts` }))} />
          <MList>
            <MMore first={5} label="All largest borrowers">
              {L.positions.top.map((x) => <MRow key={x.address} href={explorer("igra", x.address)} ext title={short(x.address)} sub={`health ${x.hf != null ? x.hf.toFixed(2) : "—"}`} value={usd(x.debtUsd)} valueSub={`of ${usd(x.collateralUsd)} collateral`} />)}
            </MMore>
          </MList>
        </MCard>
      )}
    </div>
  );
}

function Dex({ p }: { p: ProtocolView }) {
  const d = p.dex!;
  return (
    <div className="m-panel">
      <MStats items={[
        { label: "Liquidity", value: usd(p.tvl), sub: `${d.pairCount} pools` },
        { label: "Traded 24h", value: d.vol24 != null ? usd(d.vol24) : "—", sub: d.vol24 && p.tvl ? `${(d.vol24 / p.tvl).toFixed(2)}× liquidity` : undefined },
        { label: "Fees to LPs", value: d.feeRate != null && d.lpShare != null ? pct(d.feeRate * d.lpShare, 2) : "—", sub: d.feeSource === "on-chain" ? `median of ${d.feeSamples} swaps` : "per swap" },
        { label: "Largest pool", value: d.pools[0] ? pct(d.pools[0].share, 0) : "—", sub: d.pools[0]?.symbols.join("/") },
      ]} />
      <MCard title="Pools" tag="by liquidity" flush>
        <MList>
          <MMore first={8} label="All pools">
            {d.pools.map((q) => (
              <MRow key={q.chain + q.pair} icon={<span style={{ display: "inline-flex" }}><AssetCoin a={q.symbols[0]} size={28} /><span style={{ marginLeft: -10 }}><AssetCoin a={q.symbols[1]} size={28} /></span></span>}
                title={q.symbols.join(" / ")} sub={`${q.chain === "igra" ? "Igra" : "Kasplex"} · ${q.kind.toUpperCase()}${q.impact10k != null ? ` · $10K moves price ${pct(q.impact10k, 1)}` : ""}`}
                value={usd(q.usd)} valueSub={pct(q.share, 1)} />
            ))}
          </MMore>
        </MList>
      </MCard>
      {(d.farms?.length || d.infinity?.length) ? (
        <MCard title="Farm and staking">
          {d.farms?.map((f) => (
            <MKv key={f.address} rows={[
              ["Farm rewards", f.perDay > 0 ? `${Math.round(f.perDay).toLocaleString("en-US")} ${f.reward.sym} a day` : <Pill t="warn">Off</Pill>],
              ["Held by the farm", `${(f.budget / 1e6).toFixed(1)}M ${f.reward.sym}`],
              ["Emergency exit", `${pct(f.emergencyFeeBps / 10_000, 0)} fee`],
              ...f.pools.map((q) => [`${q.symbols.join("/")} staked`, `${pct(q.stakedShare, 0)} of its LP`] as [string, string]),
            ]} />
          ))}
          {d.infinity?.map((v) => (
            <MRow key={v.chain + v.vault} icon={<AssetCoin a={v.symbol} size={30} />} title={`${v.symbol} staking · ${v.chain === "igra" ? "Igra" : "Kasplex"}`}
              sub={v.rate != null ? `1 x${v.symbol} = ${v.rate.toFixed(4)} ${v.symbol}` : undefined}
              value={v.rate != null ? `+${pct(v.rate - 1, v.rate - 1 < 0.01 ? 2 : 1)}` : "—"} valueSub="since launch"
              pill={v.emissions?.paused ? { t: "warn", text: "Emissions paused" } : v.emissions ? undefined : { t: "info", text: "Owner top-ups only" }} />
          ))}
        </MCard>
      ) : null}
    </div>
  );
}

function Checks({ p }: { p: ProtocolView }) {
  const day = (t: number) => new Date(t).toISOString().slice(0, 10);
  return (
    <div className="m-panel">
      <MCard title="What dawns reads directly" tag={`${p.canVerify.length}`}>
        <MFlags flags={p.canVerify.map(([a, b]) => ["good", `${a}: ${b}`] as [Status, string])} />
      </MCard>
      {p.cannotVerify.length > 0 && (
        <MCard title="Not verified yet" tag={`${p.cannotVerify.length}`}>
          <MFlags flags={p.cannotVerify.map(([a, b]) => ["info", `${a}: ${b}`] as [Status, string])} />
        </MCard>
      )}
      {p.ownerLog && p.ownerLog.length > 0 && (
        <MCard title="Owner actions" tag="admin transactions" flush>
          <MList>
            <MMore first={5} label="All owner actions">
              {p.ownerLog.map((a) => <MRow key={a.tx} href={`https://explorer.igralabs.com/tx/${a.tx}`} ext title={a.what.charAt(0).toUpperCase() + a.what.slice(1)} sub={`${a.label} · ${day(a.t)}`} />)}
            </MMore>
          </MList>
        </MCard>
      )}
      {p.contracts.length > 0 && (
        <MCard title="Contracts" flush>
          <MList>{p.contracts.map((c) => <MRow key={c.addr + c.n} href={explorer(c.chain, c.addr)} ext title={c.n} sub={`${c.up} · admin: ${c.admin} · pause: ${c.pause}`} value={short(c.addr)} />)}</MList>
        </MCard>
      )}
    </div>
  );
}

export default async function MProtocol({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getSnapshot();
  const p = findProtocol(s, id);
  if (!p) notFound();
  const sig = s.signals.filter((g) => g.p === p.id && (g.t === "crit" || g.t === "warn"));
  const tabs = [
    { key: "o", label: "Overview", badge: sig.length || null, node: <Overview key="o" p={p} sig={sig} /> },
    ...(p.lending ? [{ key: "l", label: "Markets", badge: p.lending.markets.length, node: <Lending key="l" p={p} /> }] : []),
    ...(p.dex ? [{ key: "d", label: "Pools", badge: p.dex.pools.length, node: <Dex key="d" p={p} /> }] : []),
    { key: "c", label: "Checks", badge: null, node: <Checks key="c" p={p} /> },
  ];
  return (
    <>
      <DataBridge prov={s.prov} protocols={s.protocols.map(toLite)} signals={s.signals} />
      <MHead back={{ href: "/protocols", label: "Protocols" }}
        eyebrow={<>{p.category} · {p.chains.join(", ")}</>}
        title={<span style={{ display: "flex", alignItems: "center", gap: 12 }}><ProtocolCoin p={p} size={40} />{p.name}</span>}
        right={!p.floor ? <WatchButton id={p.id} /> : undefined}
        sub={<>{p.source === "onchain" && p.asOf ? <>Block #{p.asOf.block.toLocaleString("en-US")} · <Fresh since={p.asOf.timestamp * 1000} /></> : <>DefiLlama · <Fresh since={s.asOf} /></>}</>} />
      <div className="m-screen">
        <div className="m-hero" style={{ gridTemplateColumns: "1fr auto", alignItems: "end" }}>
          <span style={{ gridColumn: "1 / -1" }}>{p.lending ? "Withdrawable now" : "Value locked"}</span>
          <b>{usd(p.tvl)}</b>
          <Pill t={p.status}>{p.statusText}</Pill>
          <small style={{ gridColumn: "1 / -1" }}><Change v={p.d24} /> in 24h · <Change v={p.d7} /> in 7 days</small>
        </div>
        <MTabs tabs={tabs.map((t) => ({ key: t.key, label: t.label, badge: t.badge }))}>{tabs.map((t) => t.node)}</MTabs>
        {p.site && <MRow href={`https://${p.site}`} ext title={`Open ${p.site}`} sub="The protocol's own site" />}
      </div>
    </>
  );
}
