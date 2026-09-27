# dawns.money

Financial intelligence for Kaspa DeFi. Live, on-chain health for every protocol, with the source of every number one click away. Watch the protocols you use and get told when something moves.

Later phases add opportunities, allocation and non-custodial vaults on top of the same data layer.

## Data

dawns reads Kaspa DeFi directly where it can and says so where it can't.

| Source | What it gives | Where |
|---|---|---|
| Igra RPC (`rpc.igralabs.com:8545`, chain 38833) | Kaskad markets, rates, caps, frozen flags, oracle prices, cash held, admin/proxy checks; Zealous and KaspaCom pairs; KasDex balances; IGRA locked in the Attestation Diamond; KaspaCom LFG bonding curves | `src/lib/chain/` |
| Kasplex RPC (`evmrpc.kasplex.org`, chain 202555) | Zealous, KaspaCom and KrokoSwap V2 pairs; KrokoSwap V3 pools (PoolCreated logs + balances); KaspaCom LFG bonding curves | `src/lib/chain/dex.ts` |
| DefiLlama API | Protocol list, daily TVL history, token balances (for flows and price-vs-flow split), DEX volume and fees, market prices | `src/lib/llama.ts` |

`src/lib/snapshot.ts` builds one snapshot (cached 2 minutes, pages revalidate every 2 minutes) and every page renders from it. Each headline number carries a provenance trail: contract, block, call and calculation.

Override RPCs with `IGRA_RPC_URL` and `KASPLEX_RPC_URL` if needed. No other configuration.

## Stack

- Next.js 16 (App Router, static export of every page), React 19, TypeScript
- Plain CSS in `src/app/globals.css`, no UI framework
- Fonts self-hosted from `src/fonts` (Outfit, DM Sans, IBM Plex Mono, all SIL OFL 1.1)
- Charts are hand-built SVG components in `src/components/charts.tsx`
- viem for on-chain reads

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
  lib/snapshot.ts         builds the live snapshot every page renders from
  lib/chain/              on-chain readers (Kaskad, UniV2 DEXs, balances)
  lib/llama.ts            DefiLlama client
  lib/rules.ts            watch rule definitions
  lib/format.ts           number and date formatting
public/brand/             logo SVGs
```

## Deploy

Vercel, framework preset Next.js, no environment variables needed yet.

## Next

1. Snapshot store (Postgres) so dawns keeps its own history instead of DefiLlama's
2. Swap and Supply/Borrow event indexing (volume, large withdrawals, per-account risk)
3. Alert delivery (Telegram, email) for watch rules
4. Igra bridge page: KAS locked on L1 vs iKAS in circulation
