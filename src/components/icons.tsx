import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement>;
const base = { viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" } as const;

export const Check = (p: P) => (<svg {...base} strokeWidth={2} {...p}><path d="M3 8.5l3 3 7-7" /></svg>);
export const Alert = (p: P) => (<svg {...base} strokeWidth={1.8} {...p}><path d="M8 2l6.5 11.5h-13z" /><path d="M8 6.5v3" /><path d="M8 11.8v.2" /></svg>);
export const Info = (p: P) => (<svg {...base} strokeWidth={1.6} {...p}><circle cx="8" cy="8" r="6.3" /><path d="M8 7.3v3.9" /><path d="M8 4.9v.2" /></svg>);
export const Minus = (p: P) => (<svg {...base} strokeWidth={1.8} {...p}><circle cx="8" cy="8" r="6.2" /><path d="M5.2 8h5.6" /></svg>);
export const Bell = (p: P) => (<svg {...base} strokeWidth={1.7} {...p}><path d="M4 11V7a4 4 0 0 1 8 0v4l1.2 1.5H2.8z" /><path d="M6.6 14a1.5 1.5 0 0 0 2.8 0" /></svg>);
export const Close = (p: P) => (<svg {...base} strokeWidth={1.8} width={14} height={14} {...p}><path d="M4 4l8 8M12 4l-8 8" /></svg>);
export const External = (p: P) => (<svg {...base} strokeWidth={1.7} {...p}><path d="M6 3H3v10h10v-3" /><path d="M9 3h4v4" /><path d="M13 3L7.5 8.5" /></svg>);
export const Copy = (p: P) => (<svg {...base} strokeWidth={1.7} {...p}><rect x="5" y="5" width="8.5" height="8.5" rx="2" /><path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5" /></svg>);
export const TrendDown = (p: P) => (<svg {...base} strokeWidth={1.8} {...p}><path d="M2 5l4.5 4.5 3-3L14 11" /><path d="M10 11h4V7" /></svg>);
export const TrendUp = (p: P) => (<svg {...base} strokeWidth={1.8} {...p}><path d="M2 11l4.5-4.5 3 3L14 5" /><path d="M10 5h4v4" /></svg>);
export const Arrow = (p: P) => (<svg {...base} strokeWidth={2} {...p}><path d="M3 8h10M9 4l4 4-4 4" /></svg>);
