import Link from "next/link";
import { sql } from "@/lib/db";
import { watchesOf, fillBaseline, earnView } from "@/lib/earn-watch";
import { earnHref, earnName } from "@/lib/earn";
import type { Portfolio } from "@/lib/portfolio";
import type { Snapshot } from "@/lib/types";
import { usd, pct } from "@/lib/format";
import { EarnStop } from "./earn-stop";

const kas = (v: number | null, d = 1) => (v == null ? "—" : `${v >= 0 ? "" : "−"}${Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: d })} KAS`);
const signedUsd = (v: number) => `${v >= 0 ? "+" : "−"}${usd(Math.abs(v))}`;
const day = (t: string) => new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/**
 * Portfolio · Earn: every option the signed-in user asked dawns to watch, what changed
 * since (yield, pool, their position) and the result against simply holding what they
 * started with. Shown only on the user's own wallets.
 */
export async function EarnPositions({ userId, s, pf, compact }: { userId: string; s: Snapshot; pf: Portfolio; compact?: boolean }) {
  const rows = await watchesOf(userId).catch(() => []);
  const open = rows.length ? ((await sql().query("select key, strong, severity from user_signals where user_id = $1 and key like 'e:%' and resolved_at is null", [userId]).catch(() => [])) as { key: string; strong: string; severity: string }[]) : [];
  const items = await Promise.all(rows.map(async (w0) => {
    const pos = pf.positions.filter((p) => p.opp === w0.opp);
    const w = await fillBaseline(userId, w0, pos).catch(() => w0);
    return { w, v: earnView(s, w, pos), alerts: open.filter((a) => a.key.startsWith(`e:${w.opp}:`)) };
  }));
  const k = (v: number | null) => (v != null && s.kasUsd ? v / s.kasUsd : null);
  return (
    <section id="earn" className={`card epos${compact ? " compact" : ""}`}>
      <div className="c-head"><h3>Earn · dawns is watching</h3><Link href="/earn" className="tag">Find more</Link></div>
      {!items.length && <p className="muted" style={{ margin: 0 }}>Nothing watched yet. On any <Link href="/earn">Earn</Link> option, turn on &quot;Watch it for me&quot;: dawns records the numbers that day and tells you in Telegram when they change.</p>}
      <div className="epos-list">
        {items.map(({ w, v, alerts }) => {
          const name = v.o ? `${earnName(v.o)} · ${v.o.pname}` : w.opp;
          return (
            <article key={w.opp} className="epos-item">
              <div className="epos-top">
                <div><Link href={earnHref(w.opp)} className="earn-name">{name}</Link><small className="muted">watching since {day(w.started_at)}</small></div>
                <EarnStop opp={w.opp} />
              </div>
              <div className="epos-stats">
                <div><span>Your position now</span><b>{v.usdNow != null ? usd(v.usdNow) : "Not in your wallets"}</b><small>{v.usdNow != null ? `≈ ${kas(k(v.usdNow))}` : "deposit, then dawns reads it here"}</small></div>
                <div><span>Versus just holding</span><b className={v.vsHold == null ? "" : v.vsHold >= 0 ? "up" : "down"}>{v.vsHold != null ? signedUsd(v.vsHold) : "—"}</b><small>{v.vsHold != null ? `what you started with, at today's prices: ${usd(v.hold ?? 0)}` : "needs the position when watching started"}</small></div>
                <div><span>Native yield</span><b>{v.o?.apy != null ? pct(v.o.apy) : "—"}</b><small>{w.apy0 != null ? `${pct(w.apy0)} when you started` : ""}</small></div>
                <div><span>{v.o?.kind === "supply" ? "Supplied" : "In the pool"}</span><b>{v.o ? usd(v.o.size) : "—"}</b><small>{w.size0 != null ? `${usd(w.size0)} when you started` : ""}</small></div>
              </div>
              {v.held0 && v.heldNow.length > 0 && (
                <small className="muted">Held then: {v.held0.map((h) => `${h.amount.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${h.sym}`).join(" + ")} · now: {v.heldNow.map((h) => `${h.amount.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${h.sym}`).join(" + ")}</small>
              )}
              <div className="epos-alerts">
                {alerts.length ? alerts.map((a) => <span key={a.key} className={`earn-tag ${a.severity === "crit" ? "down" : "warn"}`}>{a.strong}</span>) : <span className="earn-tag up">Nothing to flag</span>}
              </div>
            </article>
          );
        })}
      </div>
      {items.length > 0 && <p className="muted" style={{ fontSize: 13, margin: "12px 0 0" }}>&quot;Versus just holding&quot; prices the tokens your wallet held in this option when watching started at today&apos;s prices, and compares with the position now: for a pool it is fees minus the price effect, for lending the interest earned. Alerts go to your linked Telegram.</p>}
    </section>
  );
}
