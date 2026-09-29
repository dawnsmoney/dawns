/** Shown the moment an asset is tapped, while its page is read. */
export default function Loading() {
  return (
    <div className="pf-skel" style={{ padding: "calc(env(safe-area-inset-top,0px) + 84px) 16px 24px" }} aria-busy="true">
      <p className="eyebrow muted" style={{ margin: 0 }}><span className="pf-spin" aria-hidden />Reading the asset…</p>
      <div className="card sk" />
      <div className="card sk tall" />
    </div>
  );
}
