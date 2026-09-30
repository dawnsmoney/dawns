/** Shown at once on a phone while a sheet is read. */
export default function Loading() {
  return (
    <div style={{ padding: "16px 16px 24px" }} aria-busy="true">
      <p className="muted" style={{ margin: 0 }}><span className="pf-spin" aria-hidden />Reading the sheet…</p>
      <div className="card sk" style={{ marginTop: 16 }} />
      <div className="card sk tall" style={{ marginTop: 12 }} />
    </div>
  );
}
