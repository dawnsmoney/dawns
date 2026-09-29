import type { SharePoint } from "@/components/share-chart";

type Move = { kind: string; at: number; navAfter: number; sharesAfter: number };
const KIND: Record<string, SharePoint["kind"]> = {
  deposit: "flow", redeem: "flow",
  lend: "loan", repay: "loan", allocate: "loan", recall: "loan",
  mark: "mark", markdown: "mark", writeoff: "mark",
};

/**
 * Share price after every recorded move (NAV ÷ shares, in KAS), from the
 * vault's opening at the launch price to now. Moves before the first share
 * exists sit at the launch price.
 */
export function sharePoints<M extends Move>(opened: number, moves: M[], launch: number, nowPrice: number, describe: (m: M) => { title: string; amt?: string }): SharePoint[] {
  const pts: SharePoint[] = [{ t: opened, price: launch, kind: "open", title: "Vault opened at the launch price" }];
  for (const m of moves) {
    const k = KIND[m.kind];
    if (!k) continue;
    const price = m.sharesAfter > 0 ? m.navAfter / m.sharesAfter / 1e8 : launch;
    pts.push({ t: m.at, price, kind: k, ...describe(m) });
  }
  const nowT = Math.floor(Date.now() / 1000);
  pts.push({ t: Math.max(nowT, pts[pts.length - 1].t + 1), price: nowPrice, kind: "now", title: "Now" });
  return pts;
}
