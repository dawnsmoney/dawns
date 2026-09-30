import Link from "next/link";
import { tgLink } from "@/lib/tglink";

/**
 * The disclosure that goes wherever dawns shows its own vaults: dawns runs them, and
 * reads and rates them with the same code as every protocol it covers.
 */
export function OwnVaultsNote({ id, compact, here, href }: { id?: string; compact?: boolean; here?: boolean; href?: string }) {
  const tg = id && !id.startsWith("credit-") || id === "credit-tn10" ? tgLink(`watch_${id}`) : null;
  return (
    <div className={`own-note${compact ? " compact" : ""}`}>
      <p><b>dawns runs its own vaults.</b> They are read and rated by the same code as every protocol dawns covers: a public proof of reserves, the same alerts, and the same rules for Earn. Nothing a vault&apos;s ledger says is taken on trust; the page shows where the chain disagrees.</p>
      <div className="own-links">
        {!here && <Link href={id ? `/proof/${id}` : "/proof#own"}>{id ? "This vault's proof of reserves →" : "Their proofs of reserves →"}</Link>}
        {here && id && <Link href={href ?? `/vaults/${id}`}>The vault itself →</Link>}
        {tg && <a href={tg} target="_blank" rel="noopener noreferrer">Alert me on Telegram →</a>}
      </div>
    </div>
  );
}
