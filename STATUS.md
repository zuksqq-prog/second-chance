# Status report

Built in an environment with **no access to npm or any external API**. That shaped what could be verified. This file is the honest account.

## Verified here

| Area | How |
|---|---|
| Thesis engine (`evaluateSell`, planned-exit allowance, stale/missing data, revisions never touching the original, validation) | 16 unit tests |
| Trade-intent state machine (reminder required before execution, single use, expiry, wallet/mint/side/amount binding, no mode switching) | 9 unit tests |
| Portfolio accounting (average cost, fees, partial exits, unknown-basis deposits, external removals, valuation, exact amount conversion) | 9 unit tests |
| Sign-in (real Ed25519 signatures, nonce/domain/expiry/address checks), session tokens (tamper, expiry), base58 | unit tests |
| Paper fill model, provider normalisation (DexScreener, GeckoTerminal), filters, OHLCV parsing, malicious metadata, formatting, cache dedupe, rate limiter | unit tests |
| Solana wire-format parsing (legacy + v0) used to prove the signed tx matches the quote | 5 unit tests |
| SQL migration on PostgreSQL 16; original-thesis immutability trigger; one active thesis per token; pending intent cannot be consumed; intents consume exactly once; idempotency keys; real intents require matching message hash and can't be consumed via the paper path; paper balance can't go negative; paper trades must be flagged simulated | Run directly against Postgres |
| Type consistency across all of the project's own source files | `tsc --strict` against type stubs for third-party packages |

Run them: `npm test` (52 tests).

## Implemented but NOT verified here (needs your environment)

| Area | Why unverified | How to verify |
|---|---|---|
| `npm install` / `next build` | npm registry blocked in the build sandbox. Versions are pinned to releases I know exist, but there is no lockfile yet. | `npm install && npm run typecheck && npm run build`. Fix any version or type drift first. |
| UI rendering | Couldn't run Next.js, so no screenshot review of the terminal. | `npm run dev`, walk every view at desktop and phone width. |
| DexScreener / GeckoTerminal live responses | Hosts blocked here; code follows their documented response shapes. | `npm run smoke`, then open Discover and a token. |
| Helius RPC calls (balances, decimals, confirmations, tx effects, token security) | Blocked here. Standard JSON-RPC methods. | `npm run smoke` with `HELIUS_API_KEY`; connect a wallet in Real mode (view-only) and compare holdings to Solscan. |
| Jupiter Swap v2 `/order` and `/execute` | Blocked here. Implemented from the current docs (developers.jup.ag, Oct 2026). | `npm run smoke` covers a quote. Execution: see checklist below. |
| Wallet connection + message signing (Phantom, Solflare via Wallet Standard) | Needs a browser with a wallet extension. | Connect, sign in, refresh (session persists), switch wallets (session drops). |
| Repo SQL through the `postgres` driver | Driver not installable here; the same statements were tested via psql. | Paper buy → thesis → sell below target → reminder → each of the three actions. |

## Known gaps / not built yet

- **Priority fee control for real trades.** Jupiter's Order & Execute path manages priority fees and landing itself; the setting applies to paper fills and is advisory for real trades. Full control needs the `/build` path (raw instructions + your own compute-budget instructions + your own RPC submission).
- **Push-based real-time data.** Everything polls. A Helius WebSocket/Laserstream worker is described in DEPLOY.md, not implemented.
- **Pre-sign transaction simulation.** Jupiter simulates internally and the server verifies fee payer + message integrity, but there is no separate `simulateTransaction` call before signing.
- **Historical cost basis import.** Tokens bought before using the terminal show as unknown basis. Parsing wallet history (Helius Enhanced Transactions) to recover it is not built.
- **Holder distribution** is top-10 largest accounts from `getTokenLargestAccounts`, which includes pool vaults; no labelled holder analytics.
- **Multi-instance caching/rate limiting** is in-memory per instance (fine on one server; use Redis beyond that).
- **Mobile**: layouts collapse to one column with a bottom tab bar; the floating widget works with touch via pointer events but hasn't been tested on devices.
- **Automated UI/E2E tests** (Playwright) are not written.

## Real-money checklist (Phases 5–6)

Do these on mainnet with a fresh wallet holding ~0.2 SOL, `MAX_REAL_TRADE_SOL=0.02`, your wallet on the allowlist:

1. Buy 0.01 SOL of a liquid token. Confirm: wallet prompt shows the swap, Solscan link works, history shows actual fee, position matches on-chain balance.
2. Sell 25% with no thesis. Same checks; realized PnL plausible.
3. Write a thesis with a target far above market. Sell 50%: reminder appears; **Keep holding** cancels; confirm no transaction was created.
4. Sell again → **Sell anyway** → reject in wallet. Confirm nothing is sent and the UI says so.
5. Sell again → wait 60 s at the wallet prompt → approve. Expect "quote expired"; **Get new quote** works.
6. Double-click Sell / replay the execute request with the same intent. Expect exactly one transaction.
7. Set slippage to 0.01% and sell. Expect a clean failure, trade marked failed, intent consumed.
8. Kill network mid-submit (devtools offline after signing). Trade should stay pending, then reconcile via `/api/trade/:id` or the cron.
9. Transfer tokens in from another wallet. Portfolio should show partial/unknown basis, not invented PnL.
10. Security review: confirm no API keys in the client bundle (`grep -r HELIUS .next/static` returns nothing), CSP headers present, cross-origin POSTs rejected, rate limits trigger.

Only then set `REAL_TRADING_ENABLED=true` for a small allowlist.

## Credentials you need to provide

`DATABASE_URL`, `SESSION_SECRET`, `HELIUS_API_KEY`, `JUPITER_API_KEY`, `CRON_SECRET`, and (for the beta) `REAL_TRADING_ALLOWLIST`.
