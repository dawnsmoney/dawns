"use client";

import { Children, useEffect, useState, type ReactNode } from "react";

/**
 * One section at a time. The hash keeps the tab (#holders), so a link or a
 * reload lands where the reader was. Pass one element per tab (a wrapper div,
 * not a fragment: server components flatten fragments into their children).
 */
export function ResearchTabs({ tabs, children }: { tabs: { key: string; label: string; badge?: string | number | null }[]; children: ReactNode }) {
  const panels = Children.toArray(children);
  const [on, setOn] = useState(0);
  useEffect(() => {
    const pick = () => { const i = tabs.findIndex((t) => `#${t.key}` === window.location.hash); if (i >= 0) setOn(i); };
    const t = setTimeout(pick, 0);
    window.addEventListener("hashchange", pick);
    return () => { clearTimeout(t); window.removeEventListener("hashchange", pick); };
  }, [tabs]);
  const go = (i: number) => { setOn(i); try { history.replaceState(null, "", `#${tabs[i].key}`); } catch { /* ignore */ } };
  return (
    <div className="rt">
      <nav className="rt-nav" role="tablist" aria-label="Sections">
        {tabs.map((t, i) => (
          <button key={t.key} type="button" role="tab" aria-selected={i === on} className={i === on ? "on" : ""} onClick={() => go(i)}>
            {t.label}{t.badge != null && t.badge !== "" && <em>{t.badge}</em>}
          </button>
        ))}
      </nav>
      <div className="rt-panel" role="tabpanel">{panels[on]}</div>
    </div>
  );
}
