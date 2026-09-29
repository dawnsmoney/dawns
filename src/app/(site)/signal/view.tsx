import { Banner } from "@/components/Banner";
import { SignalView } from "@/components/signal-view";
import type { SignalIssue } from "@/lib/signal";

export function SignalPage({ issue, archive }: { issue: SignalIssue | null; archive: { id: string; title: string }[] }) {
  return (
    <>
      <Banner short crumb={[{ href: "/intelligence", label: "Intelligence" }, { label: "Signal" }]} title={issue?.data.title ?? "The Dawns Signal"}
        lede="Every week, the five biggest measured changes in Kaspa DeFi: where yield moved, where capital went, where the way out narrowed." />
      <div className="wrap" style={{ paddingTop: 36 }}>
        {issue ? <SignalView issue={issue} archive={archive} /> : <p className="muted">The first issue is on its way. Follow dawns on X or Telegram to get it.</p>}
      </div>
    </>
  );
}
