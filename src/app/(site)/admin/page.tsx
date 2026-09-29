import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Banner } from "@/components/Banner";
import { isAdmin } from "@/lib/admin";
import { sql, hasDb, ensureSchema } from "@/lib/db";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Admin", robots: { index: false, follow: false } };


type R = Record<string, unknown>;
const num = (x: unknown) => Number(x ?? 0).toLocaleString("en-US");
const ago = (t: unknown) => { if (!t) return "—"; const m = (Date.now() - new Date(String(t)).getTime()) / 60000; return m < 90 ? `${Math.round(m)} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`; };

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card"><span className="eyebrow muted">{label}</span><b style={{ display: "block", font: "600 28px var(--display)", margin: "6px 0 2px" }}>{value}</b>{sub && <span className="muted" style={{ fontSize: 13.5 }}>{sub}</span>}</div>
  );
}

export default async function AdminPage() {
  if (!hasDb() || !(await isAdmin())) notFound();
  await ensureSchema();
  const q = sql();
  const one = async (text: string) => ((await q.query(text)) as R[])[0] ?? {};
  const pio = await one(`select (select count(distinct user_id) from points) as pioneers,
      (select count(distinct user_id) from points where t > now() - interval '7 days' and kind <> 'join') as active7,
      (select count(*) from referral_visits where t > now() - interval '7 days') as visits7,
      (select count(*) from referrals) as refs, (select count(activated_at) from referrals) as active_refs,
      (select count(*) from finds where status = 'pending') as pending`);
  const [people, tg, events, daily, health, recent, vis, pages, refs, countries] = await Promise.all([
    one(`select (select count(*) from users) as users,
        (select count(*) from users where created_at > now() - interval '7 days') as users7,
        (select count(*) from wallets where kind = 'kaspa') as kaspa, (select count(*) from wallets where kind = 'evm') as evm,
        (select count(*) from profiles) as profiles, (select count(*) from profiles where plan is not null) as plans,
        (select coalesce(sum((p.policy->>'amount')::numeric), 0) from profiles p where p.plan is not null) as plan_usd`),
    one(`select count(*) as chats, count(*) filter (where user_id is not null) as linked, count(*) filter (where daily) as daily,
        (select count(*) from telegram_subs) as subs, (select count(*) from alerts_sent where sent_at > now() - interval '7 days') as alerts7
      from telegram_chats`),
    q.query(`select name, count(*) filter (where t > now() - interval '24 hours') as d1, count(*) filter (where t > now() - interval '7 days') as d7,
        count(*) as d30, count(distinct user_id) filter (where t > now() - interval '7 days') as users7
      from app_events where t > now() - interval '30 days' group by name order by d7 desc`) as Promise<R[]>,
    q.query(`select to_char(date_trunc('day', t), 'Mon DD') as day,
        count(distinct vid) filter (where name = 'pageview') as visitors, count(*) filter (where name = 'pageview') as views,
        count(*) filter (where name = 'signin_ok') as signins,
        count(*) filter (where name = 'plan_followed') as plans, count(*) filter (where name = 'prov_open') as provs, count(*) as all_events
      from app_events where t > now() - interval '14 days' group by date_trunc('day', t) order by date_trunc('day', t) desc`) as Promise<R[]>,
    one(`select (select max(taken_at) from snapshots) as last_tick, (select count(*) from snapshots where taken_at > now() - interval '24 hours') as ticks24,
        (select max(t) from dex_events) as last_event, (select count(*) from bridge_exits where checks = 0) as unchecked_exits,
        (select count(*) from fee_samples where t > now() - interval '7 days') as fee_samples`),
    q.query(`select e.t, e.name, e.path, e.props, e.user_id from app_events e where e.name <> 'pageview' order by e.t desc limit 25`) as Promise<R[]>,
    // visitors are unique per UTC day by design (the id's salt rotates daily), so weekly numbers add daily uniques
    one(`with d as (select date_trunc('day', t) as day, count(distinct vid) as v, count(*) as pv from app_events where name = 'pageview' and t > now() - interval '30 days' group by 1)
      select coalesce(sum(v) filter (where day = date_trunc('day', now())), 0) as today, coalesce(sum(pv) filter (where day = date_trunc('day', now())), 0) as today_pv,
        coalesce(sum(v) filter (where day = date_trunc('day', now()) - interval '1 day'), 0) as yesterday,
        coalesce(sum(v) filter (where day > now() - interval '7 days'), 0) as week, coalesce(sum(pv) filter (where day > now() - interval '7 days'), 0) as week_pv,
        coalesce(sum(v), 0) as month, min(day) as since from d`),
    q.query(`select path, count(*) as views, count(distinct vid) as visitors from app_events where name = 'pageview' and t > now() - interval '7 days' group by path order by views desc limit 12`) as Promise<R[]>,
    q.query(`select props->>'ref' as ref, count(*) as views from app_events where name = 'pageview' and props ? 'ref' and t > now() - interval '7 days' group by 1 order by views desc limit 10`) as Promise<R[]>,
    q.query(`select props->>'country' as country, count(distinct vid) as visitors from app_events where name = 'pageview' and props ? 'country' and t > now() - interval '7 days' group by 1 order by visitors desc limit 10`) as Promise<R[]>,
  ]);
  return (
    <>
      <Banner short crumb={[{ label: "Admin" }]} title="dawns in numbers" lede="Visitors and product use from dawns' own database. No cookies: a visitor is counted once per day from a hashed IP and browser, never stored." />
      <div className="wrap" style={{ paddingTop: 40, display: "grid", gap: 24 }}>
        <Link href="/admin/cards" className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, textDecoration: "none", color: "inherit" }}>
          <div><b style={{ font: "600 18px var(--display)" }}>Share cards</b><span className="muted" style={{ display: "block", fontSize: 13.5, marginTop: 4 }}>Today&apos;s drafts for X and Telegram: review, edit, approve, download.</span></div>
          <span className="btn iris sm">Open</span>
        </Link>
        <div className="grid g3" style={{ margin: "0" }}>
          <Link href="/admin/signal" className="card" style={{ textDecoration: "none", color: "inherit" }}><b style={{ font: "600 18px var(--display)" }}>The Dawns Signal</b><span className="muted" style={{ display: "block", fontSize: 13.5, marginTop: 4 }}>This week&apos;s draft: edit, publish, Telegram, X thread.</span></Link>
          <Link href="/admin/finds" className="card" style={{ textDecoration: "none", color: "inherit" }}><b style={{ font: "600 18px var(--display)" }}>Finds · {num(pio.pending)} to review</b><span className="muted" style={{ display: "block", fontSize: 13.5, marginTop: 4 }}>Opportunities Pioneers submitted.</span></Link>
          <div className="card"><b style={{ font: "600 18px var(--display)" }}>Pioneers · {num(pio.pioneers)}</b><span className="muted" style={{ display: "block", fontSize: 13.5, marginTop: 4 }}>{num(pio.active7)} earned this week · {num(pio.visits7)} visitors via share links · {num(pio.refs)} referred ({num(pio.active_refs)} active)</span></div>
        </div>
        <div className="grid g2">
          <Stat label="Visitors today" value={num(vis.today)} sub={`${num(vis.today_pv)} page views · ${num(vis.yesterday)} yesterday`} />
          <Stat label="Visitors, last 7 days" value={num(vis.week)} sub={`${num(vis.week_pv)} page views · ${num(vis.month)} in 30 days${vis.since ? ` · counting since ${new Date(String(vis.since)).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : ""}`} />
        </div>
        <div className="grid g3">
          <div className="card flush"><div className="tbl-wrap"><table>
            <thead><tr><th>Page · 7 days</th><th>Views</th><th>Visitors</th></tr></thead>
            <tbody>{pages.map((r) => (<tr key={String(r.path)}><td className="muted">{String(r.path)}</td><td>{num(r.views)}</td><td>{num(r.visitors)}</td></tr>))}</tbody>
          </table></div></div>
          <div className="card flush"><div className="tbl-wrap"><table>
            <thead><tr><th>Came from</th><th>Views</th></tr></thead>
            <tbody>{refs.length ? refs.map((r) => (<tr key={String(r.ref)}><td className="muted">{String(r.ref)}</td><td>{num(r.views)}</td></tr>)) : <tr><td className="muted" colSpan={2}>Direct visits only so far</td></tr>}</tbody>
          </table></div></div>
          <div className="card flush"><div className="tbl-wrap"><table>
            <thead><tr><th>Country</th><th>Visitors</th></tr></thead>
            <tbody>{countries.map((r) => (<tr key={String(r.country)}><td className="muted">{String(r.country)}</td><td>{num(r.visitors)}</td></tr>))}</tbody>
          </table></div></div>
        </div>
        <div className="grid g2">
          <Stat label="Profiles" value={num(people.users)} sub={`${num(people.users7)} new this week`} />
          <Stat label="Wallets" value={num(Number(people.kaspa) + Number(people.evm))} sub={`${num(people.kaspa)} Kaspa · ${num(people.evm)} EVM`} />
          <Stat label="Following a plan" value={num(people.plans)} sub={`$${num(people.plan_usd)} planned in total`} />
          <Stat label="Telegram chats" value={num(tg.chats)} sub={`${num(tg.linked)} linked · ${num(tg.daily)} morning report · ${num(tg.alerts7)} alerts sent 7d`} />
        </div>
        <div className="grid gA">
          <div className="card flush"><div className="tbl-wrap"><table>
            <thead><tr><th>Event</th><th>24h</th><th>7 days</th><th>30 days</th><th>Signed-in users 7d</th></tr></thead>
            <tbody>{events.map((e) => (<tr key={String(e.name)}><td><b>{String(e.name)}</b></td><td>{num(e.d1)}</td><td>{num(e.d7)}</td><td>{num(e.d30)}</td><td>{num(e.users7)}</td></tr>))}</tbody>
          </table></div></div>
          <div className="card flush"><div className="tbl-wrap"><table>
            <thead><tr><th>Day</th><th>Visitors</th><th>Views</th><th>Sign-ins</th><th>Plans followed</th><th>Sources opened</th><th>All events</th></tr></thead>
            <tbody>{daily.map((d) => (<tr key={String(d.day)}><td><b>{String(d.day)}</b></td><td>{num(d.visitors)}</td><td>{num(d.views)}</td><td>{num(d.signins)}</td><td>{num(d.plans)}</td><td>{num(d.provs)}</td><td>{num(d.all_events)}</td></tr>))}</tbody>
          </table></div></div>
        </div>
        <div className="card">
          <div className="c-head"><h3>Pipeline health</h3></div>
          <div className="vlist">
            <div className="vrow"><span /><div>Last run<small>{num(health.ticks24)} runs in 24h</small></div><b>{ago(health.last_tick)}</b></div>
            <div className="vrow"><span /><div>Newest indexed DEX event</div><b>{ago(health.last_event)}</b></div>
            <div className="vrow"><span /><div>Bridge exits not yet checked on L1</div><b>{num(health.unchecked_exits)}</b></div>
            <div className="vrow"><span /><div>Swap fee samples, 7 days</div><b>{num(health.fee_samples)}</b></div>
          </div>
        </div>
        <div className="card flush"><div className="tbl-wrap"><table>
          <thead><tr><th>Latest events</th><th>Page</th><th>Details</th><th>Signed in</th><th>When</th></tr></thead>
          <tbody>{recent.map((e, i) => (<tr key={i}><td><b>{String(e.name)}</b></td><td className="muted">{String(e.path ?? "")}</td><td className="muted wrap" style={{ fontSize: 13 }}>{e.props ? JSON.stringify(e.props) : ""}</td><td className="muted">{e.user_id ? "yes" : "—"}</td><td className="muted">{ago(e.t)}</td></tr>))}</tbody>
        </table></div></div>
      </div>
    </>
  );
}
