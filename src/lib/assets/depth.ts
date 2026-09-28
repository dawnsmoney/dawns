import type { PoolView, Snapshot } from "../types";
import type { Depth } from "./types";

/** Price moves the depth curve is drawn at. */
export const MOVES = [0.01, 0.02, 0.05, 0.1, 0.2, 0.3];

/**
 * Tokens of side `i` that can be sold into one pool before its price for that token falls by `move`.
 * V2 (x·y = k): selling dx of reserve R moves the price by (R / (R + dx))², so dx = R(1/√(1−m) − 1).
 * V3: the same move at the pool's in-range liquidity L and √price s (raw units):
 * token0 in = L(1/s′ − 1/s) with s′ = s√(1−m); token1 in = L(s′ − s) with s′ = s/√(1−m).
 * Fees are left out: they change the result by well under 1%.
 */
export function sellable(p: PoolView, i: 0 | 1, move: number): number | null {
  const k = 1 / Math.sqrt(1 - move);
  if (p.kind === "v2") return p.reserves[i] * (k - 1);
  if (p.L == null || p.sqrtP == null || !(p.sqrtP > 0)) return null;
  const s = p.sqrtP, dec = p.tk[i].d;
  const raw = i === 0 ? p.L * (k / s - 1 / s) : p.L * (s * k - s);
  return raw / 10 ** dec;
}

interface Acc { pools: Depth["pools"]; curve: number[]; v3: boolean }

/**
 * Depth per token (key: `chain:address`), across every DEX pool in the snapshot.
 * Each pool's figure is capped at what the other side of that pool holds: a pool cannot
 * pay out more than it has, whatever its in-range liquidity says.
 */
export function depthByToken(s: Snapshot): Map<string, Depth> {
  const acc = new Map<string, Acc>();
  for (const pr of s.protocols) {
    for (const p of pr.dex?.pools ?? []) {
      ([0, 1] as const).forEach((i) => {
        const t = p.tk[i], o = p.tk[1 - i as 0 | 1];
        const px = t.pp ?? t.px, opx = o.pp ?? o.px;
        if (px == null || !(px > 0)) return;
        const cap = opx != null ? p.reserves[1 - i] * opx : p.usd / 2;
        const at = MOVES.map((m) => { const q = sellable(p, i, m); return q == null ? null : Math.min(q * px, cap); });
        if (at.some((x) => x == null)) return;
        const k = `${p.chain}:${t.a.toLowerCase()}`;
        let a = acc.get(k);
        if (!a) { a = { pools: [], curve: MOVES.map(() => 0), v3: false }; acc.set(k, a); }
        at.forEach((x, j) => { a!.curve[j] += x!; });
        if (p.kind === "v3") a.v3 = true;
        a.pools.push({ id: `${pr.id}:${p.pair.toLowerCase()}`, pname: pr.name, chain: p.chain, pair: p.pair, other: p.symbols[1 - i], kind: p.kind, usd: p.usd, d2: at[1]!, d10: at[3]! });
      });
    }
  }
  const out = new Map<string, Depth>();
  for (const [k, a] of acc) {
    out.set(k, {
      d2: a.curve[1], d10: a.curve[3],
      curve: MOVES.map((m, j) => ({ move: m, usd: a.curve[j] })),
      pools: a.pools.sort((x, y) => y.d2 - x.d2).slice(0, 8),
      v3: a.v3,
    });
  }
  return out;
}

/** Several tokens as one asset (KAS: its wrapped forms on each chain). */
export function mergeDepth(ds: Depth[]): Depth | null {
  if (!ds.length) return null;
  return {
    d2: ds.reduce((x, d) => x + d.d2, 0), d10: ds.reduce((x, d) => x + d.d10, 0),
    curve: MOVES.map((m, j) => ({ move: m, usd: ds.reduce((x, d) => x + (d.curve[j]?.usd ?? 0), 0) })),
    pools: ds.flatMap((d) => d.pools).sort((x, y) => y.d2 - x.d2).slice(0, 8),
    v3: ds.some((d) => d.v3),
  };
}
