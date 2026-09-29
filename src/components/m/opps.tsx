import Link from "next/link";
import { AssetCoin, Pill } from "../bits";
import { usd, pct } from "@/lib/format";
import type { Opportunity } from "@/lib/types";
import type { Trend } from "../opportunities";
import { Tags } from "../intel";

const hrs = (h: number) => (h >= 48 ? `${Math.round(h / 24)} days` : `${Math.max(1, Math.round(h))} h`);

/** One opportunity: yield and the way out on the face, the reading behind it one tap away. */
export function MOpp({ o, t }: { o: Opportunity; t?: Trend }) {
  const y = (v: number) => pct(v, v < 0.1 ? 2 : 1);
  const exit = o.kind === "supply" ? o.exitShare ?? 0 : null;
  return (
    <details className="m-opp">
      <summary>
        <span className="m-opp-i">{o.assets.slice(0, 2).map((a, i) => <span key={a + i} style={{ marginLeft: i ? -12 : 0 }}><AssetCoin a={a} size={32} /></span>)}</span>
        <span className="m-opp-t"><b>{o.name.replace(/ liquidity$/, "")}</b><small>{o.pname} · {o.chain === "igra" ? "Igra" : "Kasplex"}</small></span>
        <span className="m-opp-v">
          <b>{o.apy != null ? pct(o.apy, o.apy < 0.1 ? 2 : 1) : "—"}</b>
          <small style={{ color: o.status === "crit" ? "var(--crit)" : o.status === "warn" ? "var(--warn)" : undefined }}>{o.farm ? (o.farm.on ? `+${o.farm.apr != null ? pct(o.farm.apr, 1) : "?"} ${o.farm.reward}` : `${o.farm.reward} off`) : o.kind === "supply" ? `${pct(exit ?? 0, 0)} can leave` : "pool price exit"}</small>
        </span>
      </summary>
      <div className="m-opp-body">
        <div className="m-opp-row"><Pill t={o.status}>{o.statusText}</Pill><span className="muted">{o.apyShort}</span></div>
        {t && <Tags tags={t.tags} />}
        <dl className="m-kv">
          {t?.apy7 != null && <div><dt>Average</dt><dd>7D {y(t.apy7)}{t.apyDays > 7 && t.apy30 != null ? ` · ${Math.min(30, t.apyDays)}D ${y(t.apy30)}` : ""}</dd></div>}
          <div><dt>Size</dt><dd>{usd(o.size)}{o.vol24 != null ? ` · ${usd(o.vol24)} traded 24h` : ""}</dd></div>
          <div><dt>Exit now</dt><dd>{o.kind === "supply" ? `${usd(o.exitNow ?? 0)} (${pct(exit ?? 0, 0)})` : "any time, at the pool price"}</dd></div>
          <div><dt>Stability</dt><dd>{o.kind === "supply" ? (o.apyRange ? `${pct(o.apyRange[0], 1)} – ${pct(o.apyRange[1], 1)} over ${hrs(o.rangeHours)}` : "building history") : o.ilAtMove != null ? `${pct(o.priceMove ?? 0, 0)} price move · trails holding by ${pct(o.ilAtMove, 1)}` : "building history"}</dd></div>
        </dl>
        <ul className="m-opp-notes">{o.notes.map((n) => <li key={n}>{n}</li>)}{t?.tags.filter((x) => x.key !== "new").map((x) => <li key={x.key}>Dawns view · {x.text}: {x.why}.</li>)}</ul>
        <Link className="m-btn ghost" href={`/protocols/${o.protocol}`}>{o.pname} health</Link>
      </div>
    </details>
  );
}
