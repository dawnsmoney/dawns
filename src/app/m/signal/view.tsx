import { MHead } from "@/components/m/kit";
import { SignalView } from "@/components/signal-view";
import type { SignalIssue } from "@/lib/signal";

export function SignalPage({ issue, archive }: { issue: SignalIssue | null; archive: { id: string; title: string }[] }) {
  return (
    <>
      <MHead eyebrow="The Dawns Signal" title={issue?.data.title.replace("The Dawns Signal · ", "") ?? "The Dawns Signal"} sub="The week's biggest measured changes in Kaspa DeFi." />
      <div style={{ padding: "0 16px 24px" }}>
        {issue ? <SignalView issue={issue} archive={archive} /> : <p className="muted">The first issue is on its way.</p>}
      </div>
    </>
  );
}
