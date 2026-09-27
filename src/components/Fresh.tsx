"use client";

import { useEffect, useState } from "react";

/** "18s" style freshness counter. Sample behaviour: a new block lands every ~24s. */
export function Fresh() {
  const [s, setS] = useState(18);
  useEffect(() => {
    const t = setInterval(() => setS((v) => (v >= 24 ? 1 : v + 1)), 1000);
    return () => clearInterval(t);
  }, []);
  return <span suppressHydrationWarning>{s}s</span>;
}
