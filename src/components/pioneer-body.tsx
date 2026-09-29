import Link from "next/link";
import { RULES, PIONEER_UNTIL, type PioneerView } from "@/lib/pioneer";
import { FindForm } from "./find-form";
import { Share } from "./share";
import { PioneerConnect } from "./pioneer-connect";

const n = (x: number) => x.toLocaleString("en-US");
const short = (a: string) => (a.startsWith("0x") ? `${a.slice(0, 6)}…${a.slice(-4)}` : `${a.slice(0, 12)}…${a.slice(-5)}`);
const date = (t: string | number) => new Date(t).toISOString().slice(0, 10);

type Finds = { id: string; protocol: string; target: string; asset: string | null; opp: string | null; reviewed_at: string; by: string | null }[];

/**
 * The Pioneer program: your points and where they came from, your share link, how to
 * earn, "Find an opportunity", and the finds dawns accepted. The same body on desktop and phone.
 */
export function PioneerBody({ me, finds, site }: { me: PioneerView | null; finds: Finds; site: string }) {
  const until = date(PIONEER_UNTIL);
  const link = me ? `${site.replace(/^https?:\/\//, "")}/?r=${me.code}` : null;
  return (
    <div className="pio">
      {me ? (
        <section className="card pio-me">
          <div className="pio-total">
            <span className="eyebrow muted">Your Pioneer points</span>
            <b>{n(me.total)}</b>
            <small className="muted">{me.pioneer ? <>Pioneer since {date(me.joined)} · a status for good</> : <>Joined {date(me.joined)}</>}</small>
          </div>
          <div className="pio-stats">
            <div><b>{n(me.visits)}</b><small>visitors through your link</small></div>
            <div><b>{n(me.activated)} / {n(me.referred)}</b><small>people you brought who use dawns</small></div>
            <div><b>{n(me.finds.filter((f) => f.status === "accepted").length)}</b><small>finds accepted</small></div>
          </div>
          <div className="pio-link">
            <span className="eyebrow muted">Your link</span>
            <code>{link}</code>
            <Share path="/" text="dawns reads Kaspa DeFi on-chain: where yield comes from, where capital moves, and what it costs to get out. I'm helping map it as a Dawns Pioneer." />
            <small className="muted">Any dawns page works: share an opportunity or the Signal and your code rides along.</small>
          </div>
        </section>
      ) : (
        <section className="card pio-join">
          <div>
            <b>Help map Kaspa DeFi.</b>
            <p>Explore the market, find emerging opportunities, share what you discover. Everyone who joins before {until} is a Dawns Pioneer for good, and starts with {n(RULES[0].pts)} points.</p>
          </div>
          <PioneerConnect />
        </section>
      )}

      <section className="card">
        <div className="c-head"><h3>How to earn</h3><span className="tag">points</span></div>
        <div className="pio-rules">
          {RULES.map((r) => {
            const got = me?.byKind.find((k) => k.kind === r.kind);
            return (
              <div key={r.kind} className={got ? "got" : ""}>
                <b>+{n(r.pts)}</b>
                <span><strong>{r.label}</strong><small>{r.how}</small></span>
                <em>{got ? `${n(got.pts)} earned` : ""}</em>
              </div>
            );
          })}
        </div>
        <p className="muted" style={{ fontSize: 13, margin: "12px 0 0" }}>Points count what people cause, not clicks: a share earns when someone new arrives, a referral when that person really uses dawns. Connecting a wallet alone earns nothing beyond joining.</p>
      </section>

      <section className="card" id="find">
        <div className="c-head"><h3>Find an opportunity</h3><span className="tag">+1,000 when accepted</span></div>
        <p className="muted" style={{ marginTop: 0 }}>A market, pool or vault dawns doesn&apos;t list yet? Submit it. dawns checks each find by hand: can it be read on-chain, where does its yield come from, how would you leave. Accepted finds are credited to you on the opportunity&apos;s page.</p>
        <FindForm signedIn={!!me} />
        {me && me.finds.length > 0 && (
          <div className="pio-finds">
            {me.finds.map((f) => <div key={f.id}><span>{f.protocol} · {f.target}</span><span className={`tag ${f.status === "accepted" ? "good" : ""}`}>{f.status}</span>{f.note && <small className="muted">{f.note}</small>}</div>)}
          </div>
        )}
      </section>

      {me && me.recent.length > 0 && (
        <section className="card">
          <div className="c-head"><h3>Your recent points</h3></div>
          <div className="pio-log">{me.recent.map((r, i) => <div key={i}><span>{r.label}{r.note ? <small className="muted"> · {r.note}</small> : null}</span><b>+{n(r.pts)}</b><small className="muted">{date(r.t)}</small></div>)}</div>
        </section>
      )}

      {finds.length > 0 && (
        <section className="card">
          <div className="c-head"><h3>Discovered by Pioneers</h3></div>
          <div className="pio-log">{finds.map((f) => <div key={f.id}><span>{f.opp ? <Link href={`/opportunities/${encodeURIComponent(f.opp)}`}>{f.protocol} · {f.target}</Link> : <>{f.protocol} · {f.target}</>}</span><small className="mono muted">{f.by ? short(f.by) : ""}</small><small className="muted">{date(f.reviewed_at)}</small></div>)}</div>
        </section>
      )}

      <section className="pio-terms">
        <b>What points are.</b> Recognition for early use of dawns. They have no cash value, cannot be transferred or sold, and are not a claim on any token or asset. dawns plans to let them unlock deeper intelligence and early access to new vaults; what they unlock, and the rules for earning them, may change. Depositing into a vault earns nothing. Accounts found gaming the program lose their points.
      </section>
    </div>
  );
}
