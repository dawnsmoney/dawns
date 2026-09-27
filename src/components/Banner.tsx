import Link from "next/link";
import { Clouds, BANNER_CLOUDS } from "./bits";

export function Banner({ crumb, title, lede, short, children }: { crumb?: { href?: string; label: string }[]; title?: React.ReactNode; lede?: React.ReactNode; short?: boolean; children?: React.ReactNode }) {
  return (
    <section className="sky">
      <Clouds set={BANNER_CLOUDS} />
      <div className={`wrap banner ${short ? "short" : ""}`}>
        {crumb && (
          <div className="crumb">
            {crumb.map((c, i) => (
              <span key={i} style={{ display: "contents" }}>
                {i > 0 && <span>/</span>}
                {c.href ? <Link href={c.href}>{c.label}</Link> : <span>{c.label}</span>}
              </span>
            ))}
          </div>
        )}
        {title && <h1>{title}</h1>}
        {lede && <p className="lede">{lede}</p>}
        {children}
      </div>
    </section>
  );
}
