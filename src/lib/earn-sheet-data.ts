import "server-only";
import { getSnapshot } from "./snapshot";
import { getIntelRaw } from "./intel-db";
import { buildIntel } from "./intel";
import { planFor } from "./chain/act";

/** One Earn option's sheet: the opportunity, its protocol, its intelligence and the deposit plan. */
export async function earnSheet(id: string) {
  const s = await getSnapshot();
  const o = s.opportunities.find((x) => x.id === id);
  if (!o) return null;
  const [raw, plan] = await Promise.all([getIntelRaw().catch(() => null), planFor(o, s.protocols)]);
  const it = raw ? buildIntel(raw, s).byOpp[o.id] : undefined;
  const mins = Math.max(1, Math.round((Date.now() - s.asOf) / 60_000));
  const stamp = `read ${mins < 90 ? `${mins} min` : `${Math.round(mins / 60)} h`} ago${s.blocks.igra ? ` · Igra block ${s.blocks.igra.block.toLocaleString("en-US")}` : ""}`;
  return { s, o, p: s.protocols.find((x) => x.id === o.protocol), it, plan, stamp };
}
