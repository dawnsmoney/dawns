"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { PROTOCOLS, EVENTS, P, RULES, RULE_TXT, type DEvent, type Category } from "@/lib/data";
import { usd, pct } from "@/lib/format";
import { Change, HealthMeter, Pill, ProtocolCoin, Sparkline, UtilMeter } from "./bits";
import { TrendDown, TrendUp, Info, Bell } from "./icons";
import { WatchButton } from "./actions";
import { useUI, useWatchMap } from "./providers";

export function Feed({ list }: { list: DEvent[] }) {
  return (
    <div className="feed">
      {list.map((e, i) => {
        const Icon = e.t === "good" ? TrendUp : e.t === "warn" ? TrendDown : Info;
        return (
          <div key={i} className={`ev ${e.t}`}>
            <span className="ic"><Icon /></span>
            <div>
              <p><b>{e.strong}</b>{e.rest}</p>
              <div className="meta">
                <span>{e.ago}</span>
                {e.p ? <Link href={`/protocols/${e.p}`}>{P[e.p].name} →</Link> : <span>Kaspa DeFi</span>}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

type Filter = "All" | Category;
export function ProtocolList({ withFilters = true }: { withFilters?: boolean }) {
  const [f, setF] = useState<Filter>("All");
  const router = useRouter();
  const rows = PROTOCOLS.filter((p) => f === "All" || p.cat === f);
  return (
    <>
      {withFilters && (
        <div className="filters" style={{ marginBottom: 20, justifyContent: "flex-end" }}>
          {(["All", "Lending", "DEX"] as Filter[]).map((x) => (
            <button key={x} type="button" className={x === f ? "on" : ""} onClick={() => setF(x)}>{x}</button>
          ))}
        </div>
      )}
      <div className="lt-wrap">
        <div className="lt" role="table" aria-label="Protocols">
          <div className="hd" role="row">
            <span>Protocol</span><span>TVL</span><span>24h</span><span>7d</span><span>30d</span><span>Utilization / vol</span><span>Verified</span><span>Health</span><span />
          </div>
          {rows.map((p) => (
            <div key={p.id} className="rw" role="row" tabIndex={0}
              onClick={(e) => { if (!(e.target as HTMLElement).closest("a,button")) router.push(`/protocols/${p.id}`); }}
              onKeyDown={(e) => e.key === "Enter" && router.push(`/protocols/${p.id}`)}>
              <span className="proto"><ProtocolCoin p={p} size={44} /><span><b>{p.name}</b><small>{p.cat} · {p.chain}</small></span></span>
              <span style={{ font: "600 16px var(--display)" }}>{usd(p.tvl)}</span>
              <span><Change v={p.d24} /></span>
              <span><Change v={p.d7} /></span>
              <span><Sparkline values={p.series.slice(-30)} /></span>
              <span>{p.cat === "Lending" ? <UtilMeter v={p.util!} /> : p.vol24 ? <>{usd(p.vol24)} <span className="muted">24h</span></> : <span className="muted">—</span>}</span>
              <span>{pct(p.verif, 0)}</span>
              <span style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "flex-end" }}>
                <HealthMeter status={p.status} />
                <span className="muted" style={{ fontSize: 13 }}>{p.status === "good" ? "Healthy" : p.status === "warn" ? "Watch" : p.floor ? "Floor" : "Partial"}</span>
              </span>
              <span><WatchButton id={p.id} /></span>
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
  const { openWatch } = useUI();
  const ids = Object.keys(map).filter((k) => P[k]);
  const add = PROTOCOLS.filter((p) => !map[p.id] && !p.floor);
  if (!ids.length)
    return (
      <div className="card" style={{ display: "grid", gap: 16, justifyItems: "center", textAlign: "center", padding: 48 }}>
        <Bell width={28} height={28} />
        <p style={{ margin: 0, maxWidth: "46ch", color: "var(--ink-2)" }}>Watch a protocol and dawns tells you when its liquidity, utilization or contracts change. You set the thresholds.</p>
        <div className="ctas" style={{ marginTop: 0, justifyContent: "center" }}>
          {add.map((p) => (<button key={p.id} className="btn ghost sm" type="button" onClick={() => openWatch(p.id)}><ProtocolCoin p={p} size={22} />Watch {p.name}</button>))}
        </div>
      </div>
    );
  return (
    <>
      <div className="grid" style={{ gap: 18 }}>
        {ids.map((k) => {
          const p = P[k], w = map[k];
          const on = Object.entries(w.rules).filter(([, v]) => v?.on);
          const fired = EVENTS.filter((e) => e.p === k && e.rule && w.rules[e.rule]?.on);
          return (
            <div className="card" key={k}>
              <div className="c-head">
                <span className="proto"><ProtocolCoin p={p} size={52} /><span><b style={{ fontSize: 20 }}><Link href={`/protocols/${k}`} style={{ textDecoration: "none" }}>{p.name}</Link></b><small>{usd(p.tvl)} · <Change v={p.d24} /> 24h</small></span></span>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                  <Pill t={p.status}>{p.statusText}</Pill>
                  <button className="btn ghost sm" type="button" onClick={() => openWatch(k)}>Edit rules</button>
                </div>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 18 }}>
                {on.map(([r, v]) => {
                  const d = RULES[p.cat].find((x) => x.key === r);
                  return <span className="tag" key={r}>{RULE_TXT[r as keyof typeof RULE_TXT]}{d?.unit && v?.v != null ? ` · ${d.unit === "$K" ? `$${v.v}K` : `${v.v}%`}` : ""}</span>;
                })}
                <span className="tag">→ {w.ch.join(", ") || "in-app"}</span>
              </div>
              {fired.length ? <Feed list={fired} /> : <p className="muted" style={{ margin: 0 }}>No alerts under your rules in the last 48h.</p>}
              {w.example && <p className="foot">This example watch was added so you can see how alerts look. Remove it under Edit rules.</p>}
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
