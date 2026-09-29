"use client";

import { useRef, type ReactNode } from "react";

export interface WizardStep {
  key: string;
  /** Short name on the rail: "Amount", "Risk" */
  title: string;
  /** One line under the heading of the open step */
  hint?: string;
  /** What was chosen, shown on the rail once the step is behind you */
  summary?: ReactNode;
  /** The step can be left forward. Default true. */
  ok?: boolean;
  /** Why Next is disabled, when it is */
  need?: string;
  body: ReactNode;
}

/**
 * One thing at a time. A numbered rail (every step you have reached can be reopened, each
 * shows what you chose), the open step, and Back / Next. `step` is controlled so a page
 * can jump straight to the end (a saved profile, a copied strategy).
 */
export function Wizard({ steps, step, onStep, aside, nextLabel, className }: {
  steps: WizardStep[]; step: number; onStep: (i: number) => void;
  /** Live figures kept in view on every step but the last */
  aside?: ReactNode;
  /** Label of the Next button on the step before the last ("See the plan") */
  nextLabel?: string;
  className?: string;
}) {
  const top = useRef<HTMLDivElement>(null);
  const i = Math.max(0, Math.min(steps.length - 1, step));
  const cur = steps[i];
  const last = i === steps.length - 1;
  /** Steps you may open: every one up to the first that is not ok yet. */
  const reach = (() => { let r = 0; while (r < steps.length - 1 && steps[r].ok !== false) r++; return r; })();
  const go = (n: number) => {
    onStep(n);
    const el = top.current;
    if (el && el.getBoundingClientRect().top < 0) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  return (
    <div className={`wz${className ? ` ${className}` : ""}`} ref={top}>
      <ol className="wz-rail" aria-label="Steps">
        {steps.map((s, n) => {
          const state = n === i ? "on" : n < i ? "done" : n <= reach ? "open" : "shut";
          return (
            <li key={s.key} className={`wz-st ${state}`}>
              <button type="button" title={s.title} disabled={state === "shut"} aria-current={n === i ? "step" : undefined} onClick={() => go(n)}>
                <i aria-hidden>{n < i ? "✓" : n + 1}</i>
                <span><b>{s.title}</b>{s.summary != null && n !== i && n < Math.max(i, reach + 1) ? <small>{s.summary}</small> : null}</span>
              </button>
            </li>
          );
        })}
      </ol>
      <div className="wz-body card">
        <div className="wz-head">
          <span className="eyebrow muted">Step {i + 1} of {steps.length}</span>
          <h3>{cur.title}</h3>
          {cur.hint && <p className="muted">{cur.hint}</p>}
        </div>
        {cur.body}
        {!last && (
          <div className="wz-foot">
            {i > 0 ? <button type="button" className="btn ghost" onClick={() => go(i - 1)}>Back</button> : <span />}
            <div className="wz-next">
              {cur.ok === false && cur.need && <small className="muted">{cur.need}</small>}
              <button type="button" className="btn sun" disabled={cur.ok === false} onClick={() => go(i + 1)}>{i === steps.length - 2 && nextLabel ? nextLabel : "Next"}</button>
            </div>
          </div>
        )}
        {last && i > 0 && <div className="wz-foot"><button type="button" className="btn ghost" onClick={() => go(i - 1)}>Back</button><span /></div>}
      </div>
      {aside && !last && <div className="wz-aside">{aside}</div>}
    </div>
  );
}

/** A small inline stepper for flows inside a panel: Amount · Review · Send. */
export function MiniSteps({ items, at }: { items: string[]; at: number }) {
  return (
    <ol className="wz-mini" aria-label="Steps">
      {items.map((t, n) => <li key={t} className={n === at ? "on" : n < at ? "done" : ""} aria-current={n === at ? "step" : undefined}><i aria-hidden>{n < at ? "✓" : n + 1}</i>{t}</li>)}
    </ol>
  );
}
