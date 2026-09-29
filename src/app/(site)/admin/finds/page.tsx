import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Banner } from "@/components/Banner";
import { FindReview } from "@/components/find-review";
import { isAdmin } from "@/lib/admin";
import { sql, ensureSchema } from "@/lib/db";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Finds", robots: { index: false, follow: false } };

type F = { id: string; protocol: string; target: string; asset: string | null; link: string | null; why: string; status: string; note: string | null; created_at: string; by: string | null; pts: number };

/** "Find an opportunity" submissions, newest first: pending ones to review, then the last decisions. */
export default async function FindsPage() {
  if (!(await isAdmin())) notFound();
  await ensureSchema();
  const rows = (await sql().query(`select f.*, (select address from wallets w where w.user_id = f.user_id order by created_at limit 1) as by,
      (select coalesce(sum(pts), 0)::int from points p where p.user_id = f.user_id) as pts
    from finds f order by (f.status = 'pending') desc, f.created_at desc limit 60`)) as F[];
  return (
    <>
      <Banner short crumb={[{ href: "/admin", label: "Admin" }, { label: "Finds" }]} title="Finds to review" lede="Accept a find when dawns can read it on-chain and it belongs in Opportunities. The finder gets 1,000 points once; add its opportunity id when it is listed so its page credits them." />
      <div className="wrap" style={{ paddingTop: 32, display: "grid", gap: 16 }}>
        {!rows.length && <p className="muted">No finds yet.</p>}
        {rows.map((f) => (
          <div key={f.id} className="card" style={{ display: "grid", gap: 10 }}>
            <div className="c-head"><h3>{f.protocol} · {f.target}{f.asset ? ` · ${f.asset}` : ""}</h3><span className="tag">{f.status}</span></div>
            <p style={{ margin: 0 }}>{f.why}</p>
            <small className="muted">{new Date(f.created_at).toISOString().slice(0, 16).replace("T", " ")} · {f.by ?? "unknown"} · {f.pts.toLocaleString("en-US")} points{f.link ? <> · <a href={f.link.startsWith("http") ? f.link : "#"} target="_blank" rel="noopener noreferrer">{f.link}</a></> : null}</small>
            {f.status === "pending" ? <FindReview id={f.id} /> : f.note ? <small>Note: {f.note}</small> : null}
          </div>
        ))}
      </div>
    </>
  );
}
