/** Shown the moment an asset is clicked, while its page is read. */
export default function Loading() {
  return (
    <>
      <section className="banner short" aria-busy="true">
        <div className="wrap"><p className="eyebrow muted"><span className="pf-spin" aria-hidden />Reading the asset…</p><div className="card sk" style={{ minHeight: 44, maxWidth: 360, padding: 0 }} /></div>
      </section>
      <div className="wrap pf-skel" style={{ paddingTop: 40 }}>
        <div className="card sk" />
        <div className="card sk tall" />
        <div className="card sk" />
      </div>
    </>
  );
}
