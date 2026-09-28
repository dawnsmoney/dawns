import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Banner } from "@/components/Banner";
import { Pill } from "@/components/bits";
import { SplitBar, Compare } from "@/components/viz";
import { MANAGERS, trackRecord, KIND } from "@/lib/vaults/registry";

type P = { params: Promise<{ id: string }> };
export const revalidate = 60;
export function generateStaticParams() { return MANAGERS.map((m) => ({ id: m.id })); }
export async function generateMetadata({ params }: P): Promise<Metadata> {
  const { id } = await params;
  const m = MANAGERS.find((x) => x.id === id);
  return { title: m ? `${m.name} · vault manager` : "Manager not found" };
}
const kas = (x: number) => `${x.toLocaleString("en-US", { maximumFractionDigits: 2 })} KAS`;
const short = (s: string) => (s.length > 22 ? `${s.slice(0, 14)}…${s.slice(-6)}` : s);

export default async function ManagerPage({ params }: P) {
  const { id } = await params;
  const m = MANAGERS.find((x) => x.id === id);
  if (!m) notFound();
  const t = trackRecord(m.id);
  const done = m.checks.filter((c) => c[1]).length;
  return (
    <>
      <Banner short crumb={[{ href: "/vaults", label: "Vaults" }, { href: "/managers", label: "Managers" }, { label: m.name }]} title={m.name} lede={m.about} />
      <div className="wrap" style={{ paddingTop: 40, display: "grid", gap: 28 }}>
        <div className="depth-top depth-4" style={{ margin: 0 }}>
          <div className="card"><span className="eyebrow muted">Vaults</span><b>{t.vaults.length}</b><small>{t.live} live on testnet-10</small></div>
          <div className="card"><span className="eyebrow muted">Moves</span><b>{t.moves}</b><small>accepted by the network</small></div>
          <div className="card"><span className="eyebrow muted">Refused</span><b>{t.refusals}</b><small>rule-breaking attempts, on the record</small></div>
          <div className="card"><span className="eyebrow muted">NAV per share</span><b>{t.navReturn == null ? "—" : `${t.navReturn >= 0 ? "+" : "−"}${(Math.abs(t.navReturn) * 100).toFixed(2)}%`}</b><small>since launch, NAV vault</small></div>
        </div>

        <div className="grid gA">
          <div className="card">
            <div className="c-head"><h3>What dawns has checked</h3><span className="tag">{done} of {m.checks.length}</span></div>
            <SplitBar label="Checks" height={16} parts={[{ key: "ok", label: "Checked", color: "#199e70", share: done }, { key: "no", label: "Not yet", color: "#4A4270", share: m.checks.length - done }]} />
            <ul className="findings" style={{ marginTop: 14 }}>{m.checks.map(([c, ok]) => <li key={c}><Pill t={ok ? "good" : "warn"}>{ok ? "Yes" : "Not yet"}</Pill> {c}</li>)}</ul>
          </div>
          <div className="card">
            <div className="c-head"><h3>Capital sent and returned</h3><span className="tag">at cost, all vaults</span></div>
            <Compare a={{ label: "Sent out", value: t.sent, display: kas(t.sent) }} b={{ label: "Returned", value: t.back, display: kas(t.back) }} />
            <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>What left each vault for an approved destination, and what came back. The difference is still deployed.</p>
          </div>
        </div>

        <section>
          <div className="c-head" style={{ marginBottom: 14 }}><h3>Vaults</h3></div>
          <div className="vcards">
            {t.vaults.map((v) => {
              const k = KIND[v.kind];
              const body = (<><span className="vc-top"><span className="vc-kind" style={{ ["--c" as string]: k.color }}><i />{k.label}</span><Pill t={v.status === "live" ? "good" : "info"}>{v.status === "live" ? "Live" : v.status === "ready" ? "Launching" : "Designed"}</Pill></span><b className="vc-name">{v.name}</b><small className="muted">{v.pitch}</small>{v.figures.length > 0 && <span className="vc-figs">{v.figures.map((f) => <span key={f.label}><small>{f.label}</small><b>{f.value}</b></span>)}</span>}</>);
              return v.href ? <Link key={v.id} href={v.href} className="card vcard">{body}</Link> : <div key={v.id} className="card vcard dim">{body}</div>;
            })}
          </div>
        </section>

        <div className="card">
          <div className="c-head"><h3>Keys</h3><span className="tag">one job each</span></div>
          <div className="vlog">{t.keys.map((k) => <div key={k.vault + k.role} className="vlog-row" style={{ ["--c" as string]: k.role === "Allocator" ? "#3987e5" : k.role === "Valuer" ? "#c98500" : "#e66767" }}><i /><div><b>{k.role}</b><small>{k.vault}</small></div><span className="amt mono" style={{ fontSize: 12.5 }}>{short(k.address)}</span></div>)}</div>
        </div>
        {m.site && <p className="muted" style={{ fontSize: 13, margin: 0 }}><Link href={m.site}>{m.site.replace("https://", "")}</Link></p>}
      </div>
    </>
  );
}
