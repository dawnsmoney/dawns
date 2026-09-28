"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

/**
 * On phones, wide tables turn into stacked cards (CSS, globals.css "tables on phones").
 * Each cell then needs its column's name: this copies every header's text onto the
 * cells below it as data-label, and keeps doing so when tables change (filters, sorting).
 */
const MAX_SM = 12;
/** Long tables show their first rows on phones, with a button for the rest (CSS only acts at phone width). */
function clip(t: HTMLTableElement) {
  const wrap = t.closest<HTMLElement>(".tbl-wrap");
  if (!wrap || wrap.dataset.smAll || t.classList.contains("clip-sm")) return;
  const n = t.tBodies[0]?.rows.length ?? 0;
  let btn = wrap.querySelector<HTMLButtonElement>(":scope > .sm-more");
  if (n <= MAX_SM + 3) { t.classList.remove("clip-sm12"); btn?.remove(); return; }
  t.classList.add("clip-sm12");
  if (!btn) {
    btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn ghost sm sm-more";
    btn.addEventListener("click", () => { wrap.dataset.smAll = "1"; t.classList.remove("clip-sm12"); btn?.remove(); });
    wrap.appendChild(btn);
  }
  const txt = `Show all ${n} rows`;
  if (btn.textContent !== txt) btn.textContent = txt;
}

export function TableLabels() {
  const path = usePathname();
  useEffect(() => {
    const label = () => {
      for (const t of document.querySelectorAll<HTMLTableElement>(".tbl-wrap table")) {
        clip(t);
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
