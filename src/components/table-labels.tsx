"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

/**
 * On phones, wide tables turn into stacked cards (CSS, globals.css "tables on phones").
 * Each cell then needs its column's name: this copies every header's text onto the
 * cells below it as data-label, and keeps doing so when tables change (filters, sorting).
 */
export function TableLabels() {
  const path = usePathname();
  useEffect(() => {
    const label = () => {
      for (const t of document.querySelectorAll<HTMLTableElement>(".tbl-wrap table")) {
        const heads = [...t.querySelectorAll("thead th")].map((th) => (th.textContent ?? "").trim());
        if (!heads.length) continue;
        for (const tr of t.querySelectorAll("tbody tr")) {
          let i = 0;
          for (const td of tr.children) {
            const span = (td as HTMLTableCellElement).colSpan || 1;
            const want = span > 1 ? "" : heads[i] ?? "";
            if (td.getAttribute("data-label") !== want) td.setAttribute("data-label", want);
            i += span;
          }
        }
      }
    };
    label();
    const mo = new MutationObserver(() => label());
    mo.observe(document.body, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, [path]);
  return null;
}
