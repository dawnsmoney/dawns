import { Header, Footer } from "@/components/layout";
import { TableLabels } from "@/components/table-labels";
import { ReportButton } from "@/components/report";

/** The desktop site. Phones are served the /m screens instead (src/proxy.ts), at the same URLs. */
export default function SiteLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <Header />
      <TableLabels />
      <main>{children}</main>
      <Footer />
      <ReportButton />
    </>
  );
}
