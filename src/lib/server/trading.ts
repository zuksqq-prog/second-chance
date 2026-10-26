import "server-only";
import { randomUUID } from "node:crypto";
import { evaluateSell, recordPlannedExitSale, reviseThesis, sellPercentOfOriginal } from "@/lib/domain/thesis-engine";
import { acknowledge as acknowledgeDomain, assertExecutable, createIntent, effectiveStatus, IntentError, type IntentAction } from "@/lib/domain/trade-intent";
import type { ThesisContent, TradeMode } from "@/lib/domain/types";
import { BASE_NETWORK_FEE_LAMPORTS, simulatePaperFill } from "@/lib/domain/paper-fill";
import { curvePriceSol, quoteCurveBuy, quoteCurveSell } from "@/lib/domain/pump-curve";
import { getBondingCurve } from "./pump";
import { WSOL_MINT } from "@/lib/domain/market";
import { buildPositions, totalQty } from "@/lib/domain/portfolio";
import { bytesEqual, isZero, parseWireTx } from "@/lib/domain/tx-wire";
import { env, realTradingStatus } from "./env";
import { HttpError } from "./http";
import { getSolUsd, getToken } from "./market-data";
import * as repo from "./repo";
import { getDecimals, getSignatureStatus, getTokenHoldings, getTxEffects } from "./solana-rpc";
import { executeErrorMessage, executeOrder, getOrder, orderErrorMessage } from "./jupiter";
import { base58Decode } from "./siws";
import { log } from "./log";
import { tradeLimiter } from "./rate-limit";

/** A Jupiter order older than this must be re-quoted before signing/submission. */
export const ORDER_MAX_AGE_MS = 45_000;
/** A submitted transaction not seen on-chain after this long is treated as expired. */
const LANDING_TIMEOUT_MS = 150_000;

// ---------------------------------------------------------------- positions

export async function paperPositionRaw(wallet: string, mint: string): Promise<bigint> {
  const trades = repo.toLedger(await repo.listTrades(wallet, "paper", 5000)).filter((t) => t.mint === mint);
  const p = buildPositions(trades).get(mint);
  return p ? totalQty(p) : 0n;
}

export async function realPositionRaw(wallet: string, mint: string): Promise<bigint> {
  const h = await getTokenHoldings(wallet);
  return h.find((x) => x.mint === mint)?.amountRaw ?? 0n;
}

const positionRaw = (wallet: string, mint: string, mode: TradeMode) =>
  mode === "paper" ? paperPositionRaw(wallet, mint) : realPositionRaw(wallet, mint);

// ---------------------------------------------------------------- intents

export async function startTrade(
  wallet: string,
  p: { mode: TradeMode; side: "buy" | "sell"; mint: string; amountRaw: bigint; idempotencyKey: string },
) {
  if (p.mode === "real") {
    const s = realTradingStatus(wallet);
    if (!s.enabled) throw new HttpError(403, "real_trading_disabled", s.reason!);
  }
  const rl = tradeLimiter.take(`w:${wallet}`);
  if (!rl.ok) throw new HttpError(429, "rate_limited", "You're trading very fast. Wait a few seconds.");

  const now = new Date();
  let evaluation = null;
  let thesis = null;
  if (p.side === "sell") {
    thesis = await repo.getActiveThesis(wallet, p.mint, p.mode);
    const held = await positionRaw(wallet, p.mint, p.mode);
    if (held <= 0n) throw new HttpError(409, "no_position", "You don't hold this token.");
    if (p.amountRaw > held) throw new HttpError(409, "exceeds_position", "That's more than you hold.");
    let mc: number | null = null;
    let observedAt: Date | null = null;
    try {
      const snap = await getToken(p.mint, { fresh: true });
      mc = snap?.marketCap ?? null;
      observedAt = snap ? new Date(snap.observedAt) : null;
      if (mc == null) {
        // Curve-only token: market cap straight from the bonding curve.
        const [curve, solUsd, decimals] = await Promise.all([getBondingCurve(p.mint), getSolUsd(), getDecimals(p.mint)]);
        if (curve && solUsd) {
          mc = curvePriceSol(curve) * (Number(curve.tokenTotalSupply) / 10 ** decimals) * solUsd;
          observedAt = new Date();
        }
      }
    } catch (e) {
      log.warn("sell_market_data_unavailable", { mint: p.mint, err: String(e) });
    }
    evaluation = evaluateSell({ thesis, currentMarketCap: mc, marketDataObservedAt: observedAt, now, sellAmountRaw: p.amountRaw, positionRaw: held });
  }
  const intent = createIntent({
    id: randomUUID(),
    walletAddress: wallet,
    mode: p.mode,
    side: p.side,
    mint: p.mint,
    amountRaw: p.amountRaw,
    thesisId: thesis?.id ?? null,
    evaluation,
    now,
  });
  const stored = await repo.insertIntent(intent, p.idempotencyKey);
  return { intent: publicIntent(stored), thesis };
}

export async function acknowledgeTrade(
  wallet: string,
  intentId: string,
  action: IntentAction,
  update?: { patch: Partial<ThesisContent>; reason: string },
) {
  const intent = await repo.getIntent(wallet, intentId);
  if (!intent) throw new IntentError("not_found", "Trade not found.");
  // Validate the transition with the domain model first (clear error messages).
  acknowledgeDomain(intent, action, new Date());

  let thesis = null;
  if (action === "update_thesis") {
    if (!update?.reason?.trim()) throw new HttpError(400, "reason_required", "Tell your future self why the plan changed.");
    if (!intent.thesisId) throw new HttpError(409, "no_thesis", "There's no thesis to update.");
    const current = await repo.getThesis(wallet, intent.thesisId);
    if (!current) throw new HttpError(404, "not_found", "Thesis not found.");
    const patch = update.patch ?? {};
    const hasChanges = Object.keys(patch).length > 0;
    if (hasChanges) {
      const { next, changed } = reviseThesis(current, patch, update.reason);
      thesis = await repo.addRevision({ thesisId: current.id, wallet, next, changed, reason: update.reason.trim(), trigger: "second_chance", marketCap: intent.evaluation?.currentMarketCap ?? null });
    } else {
      // Note-only revision: content unchanged, reason recorded.
      thesis = await repo.addRevision({ thesisId: current.id, wallet, next: pickContent(current), changed: ["note"], reason: update.reason.trim(), trigger: "second_chance", marketCap: intent.evaluation?.currentMarketCap ?? null });
    }
  }
  const updated = await repo.acknowledgeIntent(wallet, intentId, action, update?.reason?.trim() ?? null);
  if (!updated) throw new IntentError("invalid_state", "This sell can no longer be acknowledged. Start it again.");
  return { intent: publicIntent(updated), thesis };
}

function pickContent(t: ThesisContent): ThesisContent {
  return { reason: t.reason, targetMarketCap: t.targetMarketCap, holdingPeriod: t.holdingPeriod, invalidation: t.invalidation, plannedExits: t.plannedExits, notes: t.notes };
}

export function publicIntent(i: repo.StoredIntent) {
  return {
    id: i.id,
    mode: i.mode,
    side: i.side,
    mint: i.mint,
    amountRaw: i.amountRaw.toString(),
    status: effectiveStatus(i, new Date()),
    acknowledgement: i.acknowledgement,
    evaluation: i.evaluation,
    thesisId: i.thesisId,
    expiresAt: i.expiresAt,
  };
}

async function loadExecutable(wallet: string, intentId: string, mode: TradeMode) {
  const intent = await repo.getIntent(wallet, intentId);
  if (!intent) throw new IntentError("not_found", "Trade not found.");
  assertExecutable(intent, { walletAddress: wallet, mode, side: intent.side, mint: intent.mint, amountRaw: intent.amountRaw }, new Date());
  return intent;
}

// ---------------------------------------------------------------- paper

export async function executePaper(wallet: string, intentId: string, opts: { slippageBps: number; priorityFeeLamports: bigint }) {
  const e = env();
  const intent = await loadExecutable(wallet, intentId, "paper");
  const [snap, solUsd, decimals, curve] = await Promise.all([
    getToken(intent.mint, { fresh: true }).catch(() => null),
    getSolUsd(),
    getDecimals(intent.mint),
    getBondingCurve(intent.mint).catch(() => null),
  ]);
  if (!solUsd) throw new HttpError(502, "no_sol_price", "Live SOL price is unavailable right now.");

  let fill: ReturnType<typeof simulatePaperFill>;
  if (curve && !curve.complete) {
    // Still on the pump.fun bonding curve: fill exactly along the curve.
    const q = intent.side === "buy" ? quoteCurveBuy(curve, intent.amountRaw) : quoteCurveSell(curve, intent.amountRaw);
    if (!q.ok) throw new HttpError(409, "fill_failed", q.error!);
    const maxImpact = Math.min(opts.slippageBps, e.MAX_SLIPPAGE_BPS) / 100;
    if (q.priceImpactPct > maxImpact)
      throw new HttpError(409, "fill_failed", `Estimated price impact ${q.priceImpactPct.toFixed(2)}% exceeds your slippage of ${maxImpact.toFixed(2)}%.`);
    fill = {
      ok: true,
      tokenAmountRaw: q.tokenAmountRaw,
      solAmountLamports: q.solAmountLamports,
      networkFeeLamports: BASE_NETWORK_FEE_LAMPORTS + opts.priorityFeeLamports,
      platformFeeLamports: q.feeLamports,
      priceImpactPct: q.priceImpactPct,
      executionPriceSol: q.executionPriceSol,
    };
  } else {
    if (!snap || snap.priceSol == null) throw new HttpError(409, "no_price", "No live SOL price for this token, so a paper fill can't be estimated.");
    fill = simulatePaperFill({
      side: intent.side,
      amountInRaw: intent.amountRaw,
      tokenDecimals: decimals,
      priceSol: snap.priceSol,
      solUsd,
      liquidityUsd: snap.liquidityUsd,
      slippageBps: Math.min(opts.slippageBps, e.MAX_SLIPPAGE_BPS),
      priorityFeeLamports: opts.priorityFeeLamports,
      platformFeeBps: 10, // approximates a typical router fee so paper PnL isn't flattering
    });
  }
  if (!fill.ok) throw new HttpError(409, "fill_failed", fill.error!);
  const curveMc = curve ? curvePriceSol(curve) * (Number(curve.tokenTotalSupply) / 10 ** decimals) * solUsd : null;

  const acct = await repo.getOrCreatePaperAccount(wallet, BigInt(Math.round(e.PAPER_STARTING_SOL * 1e9)));
  // Pre-checks so an obviously unaffordable trade doesn't burn the intent (the atomic checks below still apply).
  if (intent.side === "buy" && acct.solBalanceLamports < intent.amountRaw + fill.networkFeeLamports)
    throw new HttpError(409, "insufficient_balance", "Not enough paper SOL for this trade, including fees.");
  if (intent.side === "sell" && (await paperPositionRaw(wallet, intent.mint)) < intent.amountRaw)
    throw new HttpError(409, "insufficient_balance", "You don't hold that many tokens in paper mode.");
  const consumed = await repo.consumeIntent(wallet, intentId, null);
  if (!consumed) throw new IntentError("already_used", "This trade was already submitted.");

  const solDelta =
    intent.side === "buy"
      ? -(intent.amountRaw + fill.networkFeeLamports)
      : fill.solAmountLamports - fill.platformFeeLamports - fill.networkFeeLamports;

  try {
    const trade = await repo.applyPaperFill({
      wallet,
      solDeltaLamports: solDelta,
      requireTokenRaw: intent.side === "sell" ? { mint: intent.mint, amount: intent.amountRaw } : undefined,
      trade: {
        wallet,
        mode: "paper",
        mint: intent.mint,
        tokenSymbol: snap?.symbol ?? null,
        tokenDecimals: decimals,
        side: intent.side,
        tokenAmountRaw: fill.tokenAmountRaw,
        solAmountLamports: fill.solAmountLamports,
        networkFeeLamports: fill.networkFeeLamports,
        platformFeeLamports: fill.platformFeeLamports,
        priceSol: fill.executionPriceSol,
        priceUsd: fill.executionPriceSol * solUsd,
        marketCap: snap?.marketCap ?? curveMc,
        signature: null,
        status: "confirmed",
        error: null,
        simulated: true,
        secondChanceShown: !!intent.evaluation?.requiresAcknowledgement,
        intentId,
      },
    });
    await afterConfirmed(wallet, intent, trade.tokenAmountRaw);
    return { trade, fill: { priceImpactPct: fill.priceImpactPct } };
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "insufficient") throw new HttpError(409, "insufficient_balance", (err as Error).message);
    throw err;
  }
}

/** Thesis bookkeeping once a trade is confirmed (paper or real). */
async function afterConfirmed(wallet: string, intent: repo.StoredIntent, tokenAmountRaw: bigint) {
  const thesis = await repo.getActiveThesis(wallet, intent.mint, intent.mode);
  if (!thesis) return;
  if (intent.side === "buy") {
    await repo.bumpThesisAfterTrade({ thesisId: thesis.id, boughtRaw: tokenAmountRaw });
    return;
  }
  const remaining = await positionRaw(wallet, intent.mint, intent.mode).catch(() => null);
  if (intent.evaluation?.verdict === "planned_exit") {
    const pct = sellPercentOfOriginal(tokenAmountRaw, thesis.originalPositionRaw, tokenAmountRaw + (remaining ?? 0n)) ?? 0;
    await repo.bumpThesisAfterTrade({ thesisId: thesis.id, plannedExitSoldPercent: recordPlannedExitSale(thesis, pct) });
  }
  if (remaining === 0n) await repo.closeThesis(wallet, thesis.id);
}

// ---------------------------------------------------------------- real (Jupiter)

export async function createRealOrder(wallet: string, intentId: string, opts: { slippageBps: number }) {
  const e = env();
  const status = realTradingStatus(wallet);
  if (!status.enabled) throw new HttpError(403, "real_trading_disabled", status.reason!);
  const intent = await loadExecutable(wallet, intentId, "real");
  if (opts.slippageBps > e.MAX_SLIPPAGE_BPS) throw new HttpError(400, "slippage_too_high", `Slippage above ${e.MAX_SLIPPAGE_BPS / 100}% isn't allowed.`);
  if (intent.side === "buy" && intent.amountRaw > BigInt(Math.round(e.MAX_REAL_TRADE_SOL * 1e9)))
    throw new HttpError(400, "over_cap", `Real buys are capped at ${e.MAX_REAL_TRADE_SOL} SOL during the beta.`);
  if (intent.side === "sell") {
    const held = await realPositionRaw(wallet, intent.mint);
    if (intent.amountRaw > held) throw new HttpError(409, "exceeds_position", "Your on-chain balance is lower than this sell. Refresh and try again.");
  }

  const order = await getOrder({
    inputMint: intent.side === "buy" ? WSOL_MINT : intent.mint,
    outputMint: intent.side === "buy" ? intent.mint : WSOL_MINT,
    amountRaw: intent.amountRaw,
    taker: wallet,
    slippageBps: opts.slippageBps,
  });
  if (!order.transaction) throw new HttpError(409, "order_failed", orderErrorMessage(order));

  const bytes = Buffer.from(order.transaction, "base64");
  const parsed = parseWireTx(bytes);
  const payer = parsed.staticAccountKeys[0];
  if (!payer || !bytesEqual(payer, base58Decode(wallet))) {
    log.error("order_fee_payer_mismatch", { intentId });
    throw new HttpError(502, "order_invalid", "The swap transaction didn't match your wallet. Nothing was signed.");
  }
  const ok = await repo.attachOrder(intentId, wallet, {
    requestId: order.requestId,
    messageHash: repo.sha256Hex(parsed.message),
    inAmount: BigInt(order.inAmount ?? intent.amountRaw.toString()),
    outAmount: BigInt(order.outAmount),
  });
  if (!ok) throw new IntentError("invalid_state", "This trade expired. Start it again.");
  return {
    transaction: order.transaction,
    requestId: order.requestId,
    inAmountRaw: order.inAmount ?? intent.amountRaw.toString(),
    outAmountRaw: order.outAmount,
    router: order.router ?? null,
    feeBps: order.feeBps ?? null,
    priceImpactPct: order.priceImpactPct != null ? Number(order.priceImpactPct) : null,
    quoteValidForMs: ORDER_MAX_AGE_MS,
  };
}

export async function executeReal(wallet: string, intentId: string, signedTransactionB64: string) {
  const status = realTradingStatus(wallet);
  if (!status.enabled) throw new HttpError(403, "real_trading_disabled", status.reason!);

  let parsed;
  try {
    parsed = parseWireTx(Buffer.from(signedTransactionB64, "base64"));
  } catch {
    throw new HttpError(400, "bad_transaction", "The signed transaction couldn't be read.");
  }
  const payer = parsed.staticAccountKeys[0];
  if (!payer || !bytesEqual(payer, base58Decode(wallet))) throw new HttpError(403, "forbidden", "Transaction fee payer isn't your wallet.");
  if (isZero(parsed.signatures[0])) throw new HttpError(400, "unsigned", "The transaction wasn't signed by your wallet.");

  const intent = await loadExecutable(wallet, intentId, "real");
  if (!intent.orderRequestId || !intent.orderCreatedAt) throw new HttpError(409, "no_order", "Get a quote before submitting.");
  if (Date.now() - intent.orderCreatedAt.getTime() > ORDER_MAX_AGE_MS)
    throw new HttpError(409, "quote_expired", "Your quote expired. Get a fresh quote and sign again.");

  const hash = repo.sha256Hex(parsed.message);
  const consumed = await repo.consumeIntent(wallet, intentId, hash);
  if (!consumed) {
    const again = await repo.getIntent(wallet, intentId);
    if (again?.status === "consumed") throw new IntentError("already_used", "This trade was already submitted.");
    throw new HttpError(409, "tx_mismatch", "The signed transaction doesn't match your quote. Nothing was submitted.");
  }

  const [snap, solUsd, decimals] = await Promise.all([
    getToken(intent.mint).catch(() => null),
    getSolUsd().catch(() => null),
    getDecimals(intent.mint),
  ]);
  const trade = await repo.insertTrade({
    wallet,
    mode: "real",
    mint: intent.mint,
    tokenSymbol: snap?.symbol ?? null,
    tokenDecimals: decimals,
    side: intent.side,
    // Buys start with the quoted output; replaced by the actual on-chain delta on confirmation.
    tokenAmountRaw: intent.side === "sell" ? intent.amountRaw : consumed.orderOutAmountRaw ?? 0n,
    solAmountLamports: intent.side === "buy" ? intent.amountRaw : 0n,
    networkFeeLamports: 0n,
    platformFeeLamports: 0n,
    priceSol: snap?.priceSol ?? null,
    priceUsd: snap?.priceUsd ?? null,
    marketCap: snap?.marketCap ?? null,
    signature: null,
    jupiterRequestId: intent.orderRequestId,
    status: "pending",
    error: null,
    simulated: false,
    secondChanceShown: !!intent.evaluation?.requiresAcknowledgement,
    intentId,
  });

  let result;
  try {
    result = await executeOrder({ signedTransaction: signedTransactionB64, requestId: intent.orderRequestId });
  } catch (err) {
    // Network failure talking to Jupiter: the tx may or may not have landed.
    // Keep the trade pending without a signature; the user sees "unknown" and
    // the portfolio reconciles against on-chain balances.
    log.error("jupiter_execute_unreachable", { tradeId: trade.id, err: String(err) });
    await repo.updateTrade(trade.id, { error: "Lost contact with the swap service. Check your wallet; balances will reconcile." });
    return { trade: await repo.getTrade(wallet, trade.id), state: "unknown" as const };
  }

  if (result.status !== "Success") {
    await repo.updateTrade(trade.id, { status: "failed", error: executeErrorMessage(result), signature: result.signature ?? null });
    return { trade: await repo.getTrade(wallet, trade.id), state: "failed" as const, error: executeErrorMessage(result) };
  }

  const amounts = jupiterAmounts(intent.side, result);
  await repo.updateTrade(trade.id, { signature: result.signature ?? null, ...amounts });
  // Jupiter says landed; we still confirm independently before marking it confirmed.
  const final = await reconcileRealTrade(wallet, trade.id);
  if (solUsd == null) log.warn("sol_usd_unavailable_at_execute", { tradeId: trade.id });
  return { trade: final, state: final?.status === "confirmed" ? ("confirmed" as const) : ("pending" as const) };
}

function jupiterAmounts(side: "buy" | "sell", r: Awaited<ReturnType<typeof executeOrder>>) {
  const n = (s?: string) => (s != null && /^\d+$/.test(s) ? BigInt(s) : null);
  if (side === "buy") {
    const total = n(r.totalInputAmount);
    const used = n(r.inputAmountResult);
    const out = n(r.totalOutputAmount);
    return {
      ...(used != null ? { solAmountLamports: used } : total != null ? { solAmountLamports: total } : {}),
      ...(total != null && used != null ? { platformFeeLamports: total - used } : {}),
      ...(out != null ? { tokenAmountRaw: out } : {}),
    };
  }
  const gross = n(r.outputAmountResult);
  const net = n(r.totalOutputAmount);
  return {
    ...(gross != null ? { solAmountLamports: gross } : net != null ? { solAmountLamports: net } : {}),
    ...(gross != null && net != null ? { platformFeeLamports: gross - net } : {}),
  };
}

/**
 * Bring a pending real trade to its true on-chain state:
 * confirmed (with actual fee and token delta), failed, or still pending.
 */
export async function reconcileRealTrade(wallet: string, tradeId: string) {
  const t = await repo.getTrade(wallet, tradeId);
  if (!t || t.status !== "pending" || !t.signature) return t;
  const st = await getSignatureStatus(t.signature).catch(() => null);
  if (st?.err) {
    return repo.updateTrade(t.id, { status: "failed", error: "The transaction failed on-chain (often slippage). Network fee may have been charged." });
  }
  if (st && (st.status === "confirmed" || st.status === "finalized")) {
    const fx = await getTxEffects(t.signature, wallet, t.mint).catch(() => null);
    const patch: Parameters<typeof repo.updateTrade>[1] = { status: "confirmed" };
    if (fx) {
      patch.networkFeeLamports = fx.feeLamports;
      const tokenDelta = fx.tokenDeltaRaw < 0n ? -fx.tokenDeltaRaw : fx.tokenDeltaRaw;
      if (tokenDelta > 0n) patch.tokenAmountRaw = tokenDelta;
    }
    const updated = await repo.updateTrade(t.id, patch);
    const intent = t.intentId ? await repo.getIntent(wallet, t.intentId) : null;
    if (intent && updated) await afterConfirmed(wallet, intent, updated.tokenAmountRaw);
    return updated;
  }
  if (Date.now() - t.createdAt.getTime() > LANDING_TIMEOUT_MS) {
    return repo.updateTrade(t.id, { status: "failed", error: "The transaction didn't land before it expired. No swap happened." });
  }
  return t;
}
