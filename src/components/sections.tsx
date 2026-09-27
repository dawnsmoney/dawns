"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { Signal, Status } from "@/lib/types";
import { RULES, RULE_TXT } from "@/lib/rules";
import { usd } from "@/lib/format";
import { Change, HealthMeter, Pill, ProtocolCoin, Sparkline, UtilMeter } from "./bits";
import { TrendDown, TrendUp, Info, Bell, Alert } from "./icons";
import { WatchButton } from "./actions";
import { useUI, useWatchMap } from "./providers";

export function Feed({ list, names }: { list: Signal[]; names: Record<string, string> }) {
  if (!list.length) return <p className="muted" style={{ margin: 0 }}>Nothing notable right now.</p>;
  return (
    <div className="feed">
      {list.map((e, i) => {
        const Icon = e.t === "good" ? TrendUp : e.t === "crit" ? Alert : e.t === "warn" ? TrendDown : Info;
        return (
          <div key={e.key ?? i} className={`ev ${e.t === "crit" ? "warn crit" : e.t}`}>
            <span className="ic"><Icon /></span>
            <div>
              <p><b>{e.strong}</b>{e.rest}</p>
              <div className="meta">
                <span>Now</span>
                {e.p === "igra-bridge" ? <Link href="/bridge">Igra bridge →</Link> : e.p ? <Link href={`/protocols/${e.p}`}>{names[e.p] ?? e.p} →</Link> : <span>Kaspa DeFi</span>}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export type ProtoRow = {
  id: string; name: string; letter: string; category: string; kind: "lending" | "dex" | "other"; chains: string[];
  tvl: number; d24: number | null; d7: number | null; spark: number[]; util: number | null; vol24: number | null;
  source: "onchain" | "defillama"; status: Status; statusText: string; floor: boolean;
};

type Filter = "All" | "Lending" | "DEX" | "Other";
export function ProtocolList({ rows }: { rows: ProtoRow[] }) {
  const [f, setF] = useState<Filter>("All");
  const router = useRouter();
  const shown = rows.filter((p) => f === "All" || (f === "Lending" ? p.kind === "lending" : f === "DEX" ? p.kind === "dex" : p.kind === "other"));
  return (
    <>
      <div className="filters" style={{ marginBottom: 20, justifyContent: "flex-end" }}>
        {(["All", "Lending", "DEX", "Other"] as Filter[]).map((x) => (
          <button key={x} type="button" className={x === f ? "on" : ""} onClick={() => setF(x)}>{x}</button>
        ))}
      </div>
      <div className="lt-wrap">
        <div className="lt" role="table" aria-label="Protocols">
          <div className="hd" role="row">
            <span>Protocol</span><span>TVL</span><span>24h</span><span>7d</span><span>30d</span><span>Utilization / vol</span><span>Source</span><span>Health</span><span />
          </div>
          {shown.map((p) => (
            <div key={p.id} className="rw" role="row" tabIndex={0}
              onClick={(e) => { if (!(e.target as HTMLElement).closest("a,button")) router.push(`/protocols/${p.id}`); }}
              onKeyDown={(e) => e.key === "Enter" && router.push(`/protocols/${p.id}`)}>
              <span className="proto"><ProtocolCoin p={p} size={44} /><span><b>{p.name}</b><small>{p.category} · {p.chains.join(", ")}</small></span></span>
              <span style={{ font: "600 16px var(--display)" }}>{usd(p.tvl)}</span>
              <span><Change v={p.d24} /></span>
              <span><Change v={p.d7} /></span>
              <span><Sparkline values={p.spark} /></span>
              <span>{p.util != null ? <UtilMeter v={p.util} /> : p.vol24 ? <>{usd(p.vol24)} <span className="muted">24h</span></> : <span className="muted">—</span>}</span>
              <span className="muted" style={{ fontSize: 13 }}>{p.source === "onchain" ? "On-chain" : "DefiLlama"}</span>
              <span style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "flex-end" }}>
                <HealthMeter status={p.status} />
                <span className="muted" style={{ fontSize: 13 }}>{p.statusText}</span>
              </span>
              <span><WatchButton id={p.id} floor={p.floor} /></span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

export function SubNav({ tabs }: { tabs: string[] }) {
  const [on, setOn] = useState(0);
  useEffect(() => {
    const els = tabs.map((_, i) => document.getElementById(`s-${i}`)).filter(Boolean) as HTMLElement[];
    const io = new IntersectionObserver((ents) => {
      const vis = ents.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (vis) setOn(+vis.target.id.slice(2));
    }, { rootMargin: "-140px 0px -60% 0px" });
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [tabs]);
  return (
    <nav className="subnav" aria-label="Sections">
      {tabs.map((t, i) => (
        <a key={t} href={`#s-${i}`} className={i === on ? "on" : ""} onClick={() => setOn(i)}>{t}</a>
      ))}
    </nav>
  );
}

export function WatchlistView() {
  const map = useWatchMap();
  const { openWatch, registry } = useUI();
  const protos = registry.protocols;
  const names = Object.fromEntries(Object.values(protos).map((p) => [p.id, p.name]));
  const ids = Object.keys(map).filter((k) => protos[k]);
  const add = Object.values(protos).filter((p) => !map[p.id] && !p.floor).sort((a, b) => b.tvl - a.tvl);
  if (!Object.keys(protos).length) return <div className="card"><p className="muted" style={{ margin: 0 }}>Loading…</p></div>;
  if (!ids.length)
    return (
      <div className="card" style={{ display: "grid", gap: 16, justifyItems: "center", textAlign: "center", padding: 48 }}>
        <Bell width={28} height={28} />
        <p style={{ margin: 0, maxWidth: "46ch", color: "var(--ink-2)" }}>Watch a protocol and dawns flags it here when its liquidity, utilization or risk settings cross your thresholds.</p>
        <div className="ctas" style={{ marginTop: 0, justifyContent: "center" }}>
          {add.slice(0, 5).map((p) => (<button key={p.id} className="btn ghost sm" type="button" onClick={() => openWatch(p.id)}><ProtocolCoin p={p} size={22} />Watch {p.name}</button>))}
        </div>
      </div>
    );
  return (
    <>
      <div className="grid" style={{ gap: 18 }}>
        {ids.map((k) => {
          const p = protos[k], w = map[k];
          const on = Object.entries(w.rules).filter(([, v]) => v?.on);
          const fired = registry.signals.filter((e) => e.p === k && e.rule && w.rules[e.rule]?.on);
          return (
            <div className="card" key={k}>
              <div className="c-head">
                <span className="proto"><ProtocolCoin p={p} size={52} /><span><b style={{ fontSize: 20 }}><Link href={`/protocols/${k}`} style={{ textDecoration: "none" }}>{p.name}</Link></b><small>{usd(p.tvl)}</small></span></span>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                  <Pill t={p.status}>{p.statusText}</Pill>
                  <button className="btn ghost sm" type="button" onClick={() => openWatch(k)}>Edit rules</button>
                </div>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 18 }}>
                {on.map(([r, v]) => {
                  const d = RULES[p.kind].find((x) => x.key === r);
                  return <span className="tag" key={r}>{RULE_TXT[r as keyof typeof RULE_TXT]}{d?.unit && v?.v != null ? ` · ${d.unit === "$K" ? `$${v.v}K` : `${v.v}%`}` : ""}</span>;
                })}
              </div>
              {fired.length ? <Feed list={fired} names={names} /> : <p className="muted" style={{ margin: 0 }}>Nothing crosses your rules right now.</p>}
            </div>
          );
        })}
      </div>
      {add.length > 0 && (
        <>
          <div className="l-head" style={{ marginTop: 40 }}><h2>Watch more</h2></div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {add.map((p) => (<button key={p.id} className="btn ghost sm" type="button" onClick={() => openWatch(p.id)}><ProtocolCoin p={p} size={22} />Watch {p.name}</button>))}
          </div>
        </>
      )}
    </>
  );
}

