import { MShell } from "@/components/m/shell";
import { TableLabels } from "@/components/table-labels";
import { ReportButton } from "@/components/report";
import "./mobile.css";

/**
 * The phone site. src/proxy.ts rewrites a phone's request for /x to /m/x, so these
 * screens answer the same URLs as the desktop pages; links here use the plain URLs.
 * (Search engines crawl as phones too, so these screens stay indexable and carry the
 * same titles as their desktop pages.)
 */
export default function MobileLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <MShell><TableLabels />{children}<ReportButton mobile /></MShell>;
}
