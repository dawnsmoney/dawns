import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Banner } from "@/components/Banner";
import { currentUser, accountOf } from "@/lib/auth/session";
import { sql, hasDb, ensureSchema } from "@/lib/db";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Admin", robots: { index: false, follow: false } };

/** Wallets allowed in (ADMIN_WALLETS, comma separated, any case). */
const ADMINS = (process.env.ADMIN_WALLETS ?? "").split(",").map((a) => a.trim().toLowerCase()).filter(Boolean);

type R = Record<string, unknown>;
const num = (x: unknown) => Number(x ?? 0).toLocaleString("en-US");
const ago = (t: unknown) => { if (!t) return "—"; const m = (Date.now() - new Date(String(t)).getTime()) / 60000; return m < 90 ? `${Math.round(m)} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`; };

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card"><span className="eyebrow muted">{label}</span><b style={{ display: "block", font: "600 28px var(--display)", margin: "6px 0 2px" }}>{value}</b>{sub && <span className="muted" style={{ fontSize: 13.5 }}>{sub}</span>}</div>
  );
}

export default async function AdminPage() {
  if (!hasDb() || !ADMINS.length) notFound();
  const u = await currentUser().catch(() => null);
  if (!u) notFound();
  const acct = await accountOf(u.id);
  if (!acct.wallets.some((w) => ADMINS.includes(w.address.toLowerCase()))) notFound();
  await ensureSchema();
  const q = sql();
  const one = async (text: string) => ((await q.query(text)) as R[])[0] ?? {};
  const [people, tg, events, daily, health, recent] = await Promise.all([
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
    q.query(`select to_char(date_trunc('day', t), 'Mon DD') as day, count(*) filter (where name = 'signin_ok') as signins,
        count(*) filter (where name = 'plan_followed') as plans, count(*) filter (where name = 'prov_open') as provs, count(*) as all_events
      from app_events where t > now() - interval '14 days' group by date_trunc('day', t) order by date_trunc('day', t) desc`) as Promise<R[]>,
    one(`select (select max(taken_at) from snapshots) as last_tick, (select count(*) from snapshots where taken_at > now() - interval '24 hours') as ticks24,
        (select max(t) from dex_events) as last_event, (select count(*) from bridge_exits where checks = 0) as unchecked_exits,
        (select count(*) from fee_samples where t > now() - interval '7 days') as fee_samples`),
    q.query(`select e.t, e.name, e.path, e.props, e.user_id from app_events e order by e.t desc limit 25`) as Promise<R[]>,
  ]);
  return (
    <>
      <Banner short crumb={[{ label: "Admin" }]} title="dawns in numbers" lede="Product use from dawns' own database. Page views and visitors are in Vercel → Analytics." />
      <div className="wrap" style={{ paddingTop: 40, display: "grid", gap: 24 }}>
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
            <thead><tr><th>Day</th><th>Sign-ins</th><th>Plans followed</th><th>Sources opened</th><th>All events</th></tr></thead>
            <tbody>{daily.map((d) => (<tr key={String(d.day)}><td><b>{String(d.day)}</b></td><td>{num(d.signins)}</td><td>{num(d.plans)}</td><td>{num(d.provs)}</td><td>{num(d.all_events)}</td></tr>))}</tbody>
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
