"use client";

import { Children, useState } from "react";

/**
 * Sections of a screen as segments instead of one long scroll. The bar sticks under the
 * top bar; switching keeps the reader at the top of the section.
 */
export function MTabs({ tabs, children, initial = 0 }: { tabs: { key: string; label: string; badge?: string | number | null }[]; children: React.ReactNode; initial?: number }) {
  const [on, setOn] = useState(initial);
  const panels = Children.toArray(children);
  return (
    <div className="m-tabset">
      <div className="m-seg" role="tablist">
        {tabs.map((t, i) => (
          <button key={t.key} type="button" role="tab" aria-selected={on === i} className={on === i ? "on" : ""}
            onClick={() => { setOn(i); const el = document.getElementById("m-tabtop"); if (el && el.getBoundingClientRect().top < 0) el.scrollIntoView(); }}>
            {t.label}{t.badge != null && t.badge !== "" && <em>{t.badge}</em>}
          </button>
        ))}
      </div>
      <span id="m-tabtop" className="m-tabtop" aria-hidden />
      <div role="tabpanel" className="m-panel">{panels[on]}</div>
    </div>
  );
}

/** A list that shows its first rows and the rest on request. */
export function MMore({ children, first = 8, label = "Show all" }: { children: React.ReactNode; first?: number; label?: string }) {
  const [all, setAll] = useState(false);
  const items = Children.toArray(children);
  return (
    <>
      {all ? items : items.slice(0, first)}
      {!all && items.length > first && <button type="button" className="m-more" onClick={() => setAll(true)}>{label} {items.length}</button>}
    </>
  );
}
