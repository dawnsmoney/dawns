/** Shown at once while a phone reads the wallets. */
export default function Loading() {
  return (
    <div className="m-screen" style={{ paddingTop: 24 }} aria-busy="true">
      <p className="muted" style={{ margin: 0 }}><span className="pf-spin" />Reading your wallets on Igra, Kasplex and Kaspa L1…</p>
      <div className="card sk" style={{ marginTop: 16 }} />
      <div className="card sk tall" style={{ marginTop: 12 }} />
    </div>
  );
}
