"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { AssetCoin } from "./bits";
import { SLOT } from "@/lib/assets/holders";

export interface PickOption { id: string; symbol: string; name: string; sub: string; rank: number }

export function ComparePicker({ options, selected, max = 3 }: { options: PickOption[]; selected: string[]; max?: number }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const go = (ids: string[]) => { setQ(""); router.push(ids.length ? `/assets/compare?ids=${ids.map(encodeURIComponent).join(",")}` : "/assets/compare", { scroll: false }); };
  const byId = useMemo(() => new Map(options.map((o) => [o.id, o])), [options]);
  const hits = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    return options.filter((o) => !selected.includes(o.id) && (o.symbol.toLowerCase().includes(s) || o.name.toLowerCase().includes(s) || o.id.includes(s)))
      .sort((x, y) => Number(y.symbol.toLowerCase() === s) - Number(x.symbol.toLowerCase() === s) || x.rank - y.rank).slice(0, 8);
  }, [q, options, selected]);
  const full = selected.length >= max;
  return (
    <div className="picker">
      <div className="picker-chips">
        {selected.map((id, i) => {
          const o = byId.get(id);
          return (
            <span key={id} className="pchip" style={{ ["--c" as string]: SLOT[i] }}>
              <i />{o?.symbol ?? id}<small>{o?.sub}</small>
              <button type="button" aria-label={`Remove ${o?.symbol ?? id}`} onClick={() => go(selected.filter((x) => x !== id))}>×</button>
            </span>
          );
        })}
        {!full && (
          <span className="picker-in">
            <input className="search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={selected.length ? "Add another asset" : "Search an asset to compare"} aria-label="Add an asset to compare"
              onKeyDown={(e) => { if (e.key === "Enter" && hits[0]) go([...selected, hits[0].id]); }} />
            {hits.length > 0 && (
              <span className="picker-list" role="listbox">
                {hits.map((o) => (
                  <button key={o.id} type="button" role="option" aria-selected={false} onClick={() => go([...selected, o.id])}>
                    <AssetCoin a={o.symbol} size={24} /><b>{o.symbol}</b><small>{o.sub}</small>
                  </button>
                ))}
              </span>
            )}
          </span>
        )}
      </div>
      {!full && selected.length < 2 && (
        <div className="picker-sugg">
          <span className="muted">Try</span>
          {options.filter((o) => !selected.includes(o.id)).slice(0, 6).map((o) => (
            <button key={o.id} type="button" className="srcchip" onClick={() => go([...selected, o.id])}>{o.symbol}<small className="muted">{o.sub}</small></button>
          ))}
        </div>
      )}
    </div>
  );
}
