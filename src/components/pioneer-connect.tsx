"use client";

import { useState } from "react";
import { openConnect } from "./connect";

/** Sign in to join: the page reloads with your points once the wallet has signed. */
export function PioneerConnect() {
  const [err, setErr] = useState<string | null>(null);
  return (
    <span style={{ display: "inline-grid", gap: 6 }}>
      <button type="button" className="btn sun" onClick={() => openConnect().then(() => location.reload(), (e: Error) => { if (!/cancel/i.test(e.message)) setErr(e.message); })}>Join with your wallet</button>
      {err && <small className="cl-err">{err}</small>}
    </span>
  );
}
