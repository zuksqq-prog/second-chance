# Second Chance

**Trade your plan. Not your emotions.**

A Solana memecoin trading terminal with live discovery, charts, paper and real trading, and one thing other terminals don't have: when you go to sell below the target you set when you bought, it shows you your own words first.

> Status: Phases 1–3 implemented and unit-tested; Phase 4 (real wallet + Jupiter execution) implemented and **disabled by default**. Read [STATUS.md](STATUS.md) before enabling real money.

## What it does

- **Discover**: trending and newly created Solana pools (GeckoTerminal), filters for market cap, liquidity, volume, age, 1h change and 1h activity. Search by name, ticker or contract address (DexScreener).
- **Chart**: TradingView Lightweight Charts with real OHLCV, six timeframes, volume, crosshair, zoom/pan with older-history loading, live refresh, price ↔ market-cap view, entry/exit markers, thesis target and planned-exit lines.
- **Trade**: buy with SOL presets or custom amounts, sell by percent presets. Paper mode simulates fills at live prices with liquidity-based price impact and fees. Real mode uses Jupiter Swap API v2 (`/order` → wallet signs → `/execute`), then confirms independently on-chain.
- **Thesis engine**: write why you're buying, a target market cap, holding period, what would prove you wrong, planned partial exits and notes. The original is immutable (enforced by a database trigger); edits are revisions with a required reason.
- **SECOND CHANCE reminder**: every sell is a server-side *trade intent*. If the sell is below target and isn't a planned partial exit, the intent is created as `pending_ack` and **no execution endpoint will accept it** until you choose Keep holding, Update thesis, or Sell anyway. No cooldowns; selling is always possible. If market data is missing or stale, the reminder says so and lets you continue.
- **Thesis widget**: floating panel that follows the selected token; drag, resize from any edge or corner, minimise to a progress ring, pin, hide, and it restores after refresh (local + synced to your account).
- **Portfolio**: SOL and token balances, average entry, realized/unrealized PnL net of network and router fees, partial exits, and positions reconciled against on-chain balances. Tokens that arrived outside the terminal are labelled **unknown cost basis** and excluded from PnL rather than guessed.
- **Watchlist, history (with Solscan links), settings and presets.**

## Quick start (local)

```bash
cp .env.example .env.local        # fill DATABASE_URL and SESSION_SECRET at minimum
npm install
npm run db:migrate
npm test                          # 52 unit tests: thesis engine, intents, accounting, auth, tx checks
npm run smoke                     # live checks against DexScreener, GeckoTerminal, RPC, Jupiter (read-only)
npm run dev
```

Open http://localhost:3000, connect Phantom or Solflare, sign the sign-in message (no transaction, no fee), and trade in **Paper** mode.

## Architecture

```
src/
  lib/domain/        Pure logic, no I/O — unit tested
    thesis-engine.ts   evaluateSell(), revisions, validation
    trade-intent.ts    intent state machine (pending_ack → cleared → consumed)
    portfolio.ts       average-cost accounting, reconciliation, known vs unknown basis
    paper-fill.ts      paper fill model (live price + liquidity impact + fees)
    market.ts          provider normalisation, filters, OHLCV parsing
    tx-wire.ts         Solana tx parsing to verify the signed message matches the quote
    sanitize.ts        hostile token metadata handling
  lib/server/        Server-only services
    market-data.ts     DexScreener + GeckoTerminal, cached, deduped, paced
    solana-rpc.ts      balances, decimals, confirmations, tx effects, token security
    jupiter.ts         Swap API v2 order/execute
    trading.ts         intents, paper execution, real order/execute, reconciliation
    portfolio-service.ts
    repo.ts            all SQL (atomic single-use intents, balance debits)
    siws.ts            Sign-In With Solana (Ed25519 verify) + HMAC sessions
    http.ts            route wrapper: rate limit, CSRF/origin check, auth, errors
  app/api/           Route handlers
  components/        Terminal UI
  db/schema.ts       Drizzle schema       drizzle/0000_init.sql  migration
```

### How the reminder is enforced

1. `POST /api/trade/intent` — server loads your active thesis, your position, and a fresh market cap, runs `evaluateSell`, and stores the intent.
2. If it needs acknowledgement, the UI shows SECOND CHANCE. `POST /api/trade/intent/:id/ack` records your choice (and a thesis revision if you updated it).
3. `POST /api/trade/paper/execute` or `/api/trade/real/order` + `/api/trade/real/execute` only proceed when an atomic `UPDATE … WHERE status = 'cleared' AND expires_at > now()` succeeds. For real trades the same statement also requires the SHA-256 of the signed transaction's message to equal the quoted one. Exactly one request can consume an intent.

### Security notes

- No seed phrases or private keys ever reach the server. Every real trade is signed in the user's wallet.
- API keys (Helius, Jupiter) are server-only (`server-only` import guard); the browser talks only to this app's API.
- Sessions: httpOnly, SameSite=Lax cookies; mutating routes require same-origin JSON.
- Real trading needs `REAL_TRADING_ENABLED=true`, a dedicated RPC, and the wallet on `REAL_TRADING_ALLOWLIST`; per-trade SOL cap, slippage and priority-fee ceilings are enforced server-side.
- Token names/symbols are normalised and stripped of control and bidi characters; images load only from allowlisted HTTPS hosts; strict CSP.

See [DEPLOY.md](DEPLOY.md) for hosting and [STATUS.md](STATUS.md) for what has and hasn't been verified.
