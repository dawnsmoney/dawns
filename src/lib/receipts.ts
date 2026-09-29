import "server-only";
import { getSnapshot } from "./snapshot";
import { getNav, navFigures } from "./vaults/nav";
import { receiptsFrom, navReceipt, type Receipt } from "./underneath";

/** Every receipt token dawns can look through, largest first; the testnet vault share last. */
export async function allReceipts(): Promise<Receipt[]> {
  const [s, { l, m }] = await Promise.all([getSnapshot(), getNav()]);
  const out = receiptsFrom(s).sort((a, b) => (b.size ?? 0) - (a.size ?? 0));
  if (l && m && l.shareCovid) {
    const f = navFigures(l, m);
    out.push(navReceipt({ shareCovid: l.shareCovid, name: m.name, price: f.price, nav: f.nav, liquid: f.liquid, shares: f.shares,
      places: m.destinations.map((d, i) => ({ label: d.label.replace(" (test wallet)", ""), kas: f.marks[i] ?? 0 })) }));
  }
  return out;
}
