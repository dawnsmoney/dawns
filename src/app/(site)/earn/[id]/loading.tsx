/** Shown the moment a sheet is clicked, while it is read. */
export default function Loading() {
  return (
    <div className="wrap pf-skel" style={{ paddingTop: 110, paddingBottom: 40 }} aria-busy="true">
      <p className="muted" style={{ margin: "0 0 16px" }}><span className="pf-spin" aria-hidden />Reading the sheet…</p>
      <div className="card sk" style={{ minHeight: 90 }} />
      <div className="card sk" />
      <div className="card sk tall" />
    </div>
  );
}
