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
    bridge/               Igra bridge: KAS locked on L1 vs iKAS on Igra
    brand/                logo, colours, type
    api/cron/tick/        fresh snapshot → Neon history → signal diff → Telegram alerts
    api/telegram/         Telegram bot webhook
  components/             UI (server by default, "use client" where interactive)
  lib/snapshot.ts         builds the live snapshot every page renders from
  lib/chain/              on-chain readers (Kaskad, UniV2/V3 DEXs, balances, Igra bridge)
  lib/db.ts               Neon client and schema (created on first run)
  lib/alerts.ts           history writes, signal lifecycle, alert delivery, morning report
  lib/indexer.ts          event index: DEX swaps/removals, Kaskad flows, bridge exits → L1 payouts
  lib/history.ts          reads dawns' own history and index back into the snapshot
  lib/telegram.ts         Bot API client, webhook self-setup
  lib/llama.ts            DefiLlama client
  lib/rules.ts            watch rule definitions
  lib/format.ts           number and date formatting
public/brand/             logo SVGs
```

## Deploy

Vercel, framework preset Next.js. Pushing to `main` deploys.

| Variable | Where | What |
| --- | --- | --- |
| `DATABASE_URL` | Vercel (set by the Neon integration) | Postgres for history, signals, Telegram subscriptions |
| `CRON_SECRET` | Vercel and GitHub Actions secret | Guards `/api/cron/tick` |
| `TELEGRAM_BOT_TOKEN` | Vercel | From @BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | Vercel | Any random string; Telegram sends it back on every update |
| `NEXT_PUBLIC_TELEGRAM_BOT` | Vercel | Bot username without @, used for "Alert me on Telegram" links |
| `TELEGRAM_CHANNEL_ID` | Vercel, optional | Channel for the 07:00 Athens morning report (bot must be admin) |
| `NEXT_PUBLIC_SITE_URL` | Vercel, optional | Defaults to `https://www.dawns.money` |

Scheduling: `.github/workflows/tick.yml` calls the tick every 10 minutes. `vercel.json` adds a daily backup run.
The tick registers the Telegram webhook by itself on production, so there is no setup step.

## Next

1. Per-account lending positions (health factors, bad debt) from the Kaskad event index
2. Fee rates per DEX read on-chain, so fees stop depending on DefiLlama
3. Decode the guardian multisig behind the bridge Entry address
4. Allocation: user profile, risk and exit policy; Telegram alerts on each user's own rules
