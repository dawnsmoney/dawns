import { Change, ProtocolCoin } from "../bits";
import { MRow } from "./kit";
import { usd } from "@/lib/format";
import type { ProtocolView } from "@/lib/types";

/** A protocol in a list: value locked, its day, and dawns' reading. */
export function MProtocolRow({ p }: { p: ProtocolView }) {
  return (
    <MRow href={`/protocols/${p.id}`} icon={<ProtocolCoin p={p} size={38} />} title={p.name}
      sub={`${p.category} · ${p.chains.join(", ")}`} value={usd(p.tvl)} valueSub={<Change v={p.d24} />}
      pill={p.status !== "good" ? { t: p.status, text: p.statusText } : undefined} />
  );
}
