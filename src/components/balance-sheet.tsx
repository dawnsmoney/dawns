import { SplitBar } from "./viz";

export type Line = { key: string; label: string; value: number; color: string; note?: string };

/**
 * What is held against what is owed, each as one bar, then the ratio. Every
 * figure is read on-chain by whoever renders it; `basis` says how.
 */
export function BalanceSheet({ assets, claims, below, fmt, assetsTag, claimsTag, ratioLabel = "Coverage", basis }: {
  assets: Line[]; claims: Line[];
  /** capital that stands behind the claims without being one (a seed, a junior tranche, reserves) */
  below?: { label: string; value: number; note: string } | null;
  fmt: (x: number) => string; assetsTag?: string; claimsTag?: string; ratioLabel?: string; basis?: React.ReactNode;
}) {
  const A = assets.reduce((s, x) => s + x.value, 0), C = claims.reduce((s, x) => s + x.value, 0);
  const ratio = C > 0 ? A / C : null;
  const part = (xs: Line[]) => xs.filter((x) => x.value > 0).map((x) => ({ key: x.key, label: x.label, color: x.color, share: x.value, note: `${fmt(x.value)}${x.note ? ` · ${x.note}` : ""}` }));
  const rows = (xs: Line[], tot: number) => (
    <div className="bs-rows">
      {xs.filter((x) => x.value > 0).map((x) => (
        <div key={x.key} className="bs-row"><i style={{ background: x.color }} /><span>{x.label}{x.note && <small>{x.note}</small>}</span><b>{fmt(x.value)}</b><em>{tot ? `${Math.round((x.value / tot) * 100)}%` : ""}</em></div>
      ))}
    </div>
  );
  return (
    <div className="bs">
      <div className="bs-side">
        <div className="bs-h"><span className="eyebrow muted">Assets · what is held</span>{assetsTag && <span className="tag">{assetsTag}</span>}</div>
        <b className="bs-big">{fmt(A)}</b>
        <SplitBar label="Assets" parts={part(assets)} height={12} legend={false} tip={false} />
        {rows(assets, A)}
      </div>
      <div className="bs-side">
        <div className="bs-h"><span className="eyebrow muted">Claims · what is owed</span>{claimsTag && <span className="tag">{claimsTag}</span>}</div>
        <b className="bs-big">{fmt(C)}</b>
        <SplitBar label="Claims" parts={part(claims)} height={12} legend={false} tip={false} />
        {rows(claims, C)}
        {below && below.value > 0 && (
          <div className="bs-below"><span className="eyebrow muted">Standing behind the claims</span><div className="bs-row"><i style={{ background: "#6E6788" }} /><span>{below.label}<small>{below.note}</small></span><b>{fmt(below.value)}</b><em /></div></div>
        )}
      </div>
      <div className="bs-sum">
        <div><span className="eyebrow muted">Total assets</span><b>{fmt(A)}</b></div>
        <div><span className="eyebrow muted">Total claims</span><b>{fmt(C)}</b></div>
        <div><span className="eyebrow muted">{ratioLabel}</span><b className={ratio == null ? undefined : ratio >= 1 ? "up" : "down"}>{ratio == null ? "—" : `${(ratio * 100).toFixed(1)}%`}</b></div>
      </div>
      {basis && <p className="bs-basis">{basis}</p>}
    </div>
  );
}
