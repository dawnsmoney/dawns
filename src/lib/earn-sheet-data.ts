import "server-only";
import { cache } from "react";
import { getSnapshot } from "./snapshot";
import { getIntelRaw } from "./intel-db";
import { buildIntel } from "./intel";

/**
 * One Earn option's sheet: the opportunity, its protocol and its intelligence, all from
 * cached reads so the sheet shows at once. The deposit plan reads the chain and streams
 * in separately (see EarnUse). cache() shares one read between the metadata and the page.
 */
export const earnSheet = cache(async (id: string) => {
  const s = await getSnapshot();
  const o = s.opportunities.find((x) => x.id === id);
  if (!o) return null;
  const raw = await getIntelRaw().catch(() => null);
  const it = raw ? buildIntel(raw, s).byOpp[o.id] : undefined;
  const mins = Math.max(1, Math.round((Date.now() - s.asOf) / 60_000));
  const stamp = `read ${mins < 90 ? `${mins} min` : `${Math.round(mins / 60)} h`} ago${s.blocks.igra ? ` · Igra block ${s.blocks.igra.block.toLocaleString("en-US")}` : ""}`;
  return { s, o, p: s.protocols.find((x) => x.id === o.protocol), it, stamp };
});
