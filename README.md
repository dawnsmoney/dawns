# dawns.money

Financial intelligence for Kaspa DeFi. Live, on-chain health for every protocol, with the source of every number one click away. Watch the protocols you use and get told when something moves.

Later phases add opportunities, allocation and non-custodial vaults on top of the same data layer.

## Status

Prototype. Protocol TVLs match DefiLlama on 27 Sep 2026. Everything else in `src/lib/data.ts` (time series, markets, pools, addresses, events) is sample data. That file is the seam the indexer replaces: pages only read from its exports.

## Stack

- Next.js 16 (App Router, static export of every page), React 19, TypeScript
- Plain CSS in `src/app/globals.css`, no UI framework
- Fonts self-hosted from `src/fonts` (Outfit, DM Sans, IBM Plex Mono, all SIL OFL 1.1)
- Charts are hand-built SVG components in `src/components/charts.tsx`

## Run it

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # production build
npm run lint
```

## Layout

```
src/
  app/                    routes
    page.tsx              Kaspa DeFi overview
    protocols/            list + /protocols/[id] health pages
    watchlist/            per-viewer watch rules (localStorage for now)
    opportunities/        phase 3 preview
    vaults/               phase 5 concept
    brand/                logo, colours, type
  components/             UI (server by default, "use client" where interactive)
  lib/data.ts             sample data, provenance trails, watch rules
  lib/format.ts           number and date formatting
public/brand/             logo SVGs
```

## Deploy

Vercel, framework preset Next.js, no environment variables needed yet.

## Next

1. Indexer for the Kaskad pool and Zealous pairs (Igra RPC), then Kasplex and Kaspa L1 sources
2. Snapshot store (Postgres) and a provenance record per metric
3. Alert rules engine with Telegram and email delivery
4. Daily dawn report generated from real events
