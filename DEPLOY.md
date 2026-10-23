# Deploying Second Chance

The app is a standard Next.js 15 project with a Postgres database. Recommended setup: **Vercel** for the app, **Neon** (or Supabase/Railway) for Postgres, **Helius** for RPC.

## 1. Accounts and credentials

| Service | Needed for | Where |
|---|---|---|
| Postgres | Everything (theses, intents, trades, paper accounts) | Neon / Supabase / Railway / RDS |
| Helius API key | On-chain balances, decimals, confirmations, token security; **required** for real trading | dashboard.helius.dev |
| Jupiter API key | Real swaps (keyless works for quotes at 0.5 req/s) | developers.jup.ag/portal |
| DexScreener, GeckoTerminal | Market data, discovery, candles | No key (public APIs) |

## 2. Database

```bash
DATABASE_URL="postgres://…" npm run db:migrate
```

The migration creates all tables, the partial unique index for one active thesis per token, and the trigger that makes the original thesis immutable. `npm run db:migrate` records applied files in `schema_migrations` and is safe to rerun.

## 3. Vercel

1. Import the repository in Vercel (framework auto-detected).
2. Set environment variables from `.env.example` for Production (and Preview if you want previews to work):
   `DATABASE_URL`, `SESSION_SECRET`, `HELIUS_API_KEY`, `JUPITER_API_KEY`, `CRON_SECRET`, and leave `REAL_TRADING_ENABLED=false`.
3. Deploy. Check `https://<your-domain>/api/health` returns `{"ok":true}`.
4. `vercel.json` registers a cron every 5 minutes on `/api/cron/reconcile` that settles pending real trades and expires stale intents. Vercel sends `CRON_SECRET` as a bearer token automatically when the variable is set. (Cron frequency depends on your Vercel plan.)
5. From your laptop, run `npm run smoke` with the same `HELIUS_API_KEY`/`JUPITER_API_KEY` to confirm every provider responds.

## 4. Other hosts

Any Node 20+ host works (`npm run build && npm start`): Railway, Render, Fly.io, a VPS. On a long-lived server:
- Replace Vercel Cron with any scheduler calling `GET /api/cron/reconcile` with `Authorization: Bearer $CRON_SECRET`.
- The in-memory cache and rate limiter are per instance. With more than one instance, move them to Redis (Upstash) — the interfaces in `src/lib/server/cache.ts` and `rate-limit.ts` are small on purpose.

## 5. Real-time data and background services

The current build uses **polling** (feeds every 15–30 s, token data 10 s, candles per timeframe) with server-side caching and request deduplication. This works on serverless with no extra infrastructure. GeckoTerminal and DexScreener's public APIs do not offer push streams.

For sub-second updates, add an always-on worker (Railway/Fly) that subscribes to Helius WebSockets or Laserstream for pool account changes and pushes to clients over a WebSocket or SSE channel (e.g. via Ably/Pusher or your own `ws` server). That service is not included yet; see STATUS.md.

## 6. Enabling the real-money beta

Only after completing the checklist in STATUS.md:

```
REAL_TRADING_ENABLED=true
REAL_TRADING_ALLOWLIST=<your wallet>,<tester wallet>
MAX_REAL_TRADE_SOL=0.05
```

Redeploy. Wallets not on the allowlist see Real mode as view-only.
