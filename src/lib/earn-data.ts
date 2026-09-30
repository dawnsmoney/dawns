import "server-only";
import { getSnapshot } from "./snapshot";
import { getIntelRaw } from "./intel-db";
import { buildIntel } from "./intel";
import { vaults } from "./vaults/registry";
import { earnFor, isHave, isWin, type Have, type Win } from "./earn";

/** Everything the Earn page shows, for one asset and exit window. */
export async function earnPage(sp: { [k: string]: string | string[] | undefined }) {
  const have: Have = isHave(sp.have) ? sp.have : "kas";
  const win: Win = isWin(sp.win) ? sp.win : "any";
  const [s, raw, vs] = await Promise.all([getSnapshot(), getIntelRaw().catch(() => null), vaults().catch(() => [])]);
  const intel = raw ? buildIntel(raw, s) : null;
  const { options, excluded } = earnFor(s, intel, have, win);
  // dawns' own vaults run on testnet: shown to KAS holders, clearly marked
  const vaultCards = have === "kas" ? vs.filter((v) => v.status === "live" && (v.id === "nav-tn10" || v.id === "demo-tn10" || v.id === "credit-tn10" || (v.id === "fixed-tn10" && win === "lock"))) : [];
  const mins = Math.max(1, Math.round((Date.now() - s.asOf) / 60_000));
  const stamp = `read ${mins < 90 ? `${mins} min` : `${Math.round(mins / 60)} h`} ago${s.blocks.igra ? ` · Igra block ${s.blocks.igra.block.toLocaleString("en-US")}` : ""}`;
  return { have, win, options, excluded, vaults: vaultCards, stamp, s };
}
