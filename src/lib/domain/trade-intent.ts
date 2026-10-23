import type { SellEvaluation, Side, TradeMode } from "./types";

/**
 * Trade intents make the SECOND CHANCE reminder a server-enforced step.
 * Every sell is created as an intent; execution endpoints only accept an
 * intent that is `cleared`, unexpired, bound to the same wallet/mint/side,
 * and not larger than the authorised amount. Consuming is single-use, which
 * also blocks duplicate submissions.
 */

export type IntentStatus = "pending_ack" | "cleared" | "cancelled" | "consumed" | "expired";
export type IntentAction = "keep_holding" | "update_thesis" | "sell_anyway";

export interface TradeIntent {
  id: string;
  walletAddress: string;
  mode: TradeMode;
  side: Side;
  mint: string;
  amountRaw: bigint;
  thesisId: string | null;
  evaluation: SellEvaluation | null;
  status: IntentStatus;
  acknowledgement: IntentAction | null;
  createdAt: Date;
  expiresAt: Date;
  consumedAt: Date | null;
}

export const INTENT_TTL_MS = 5 * 60_000;

export function createIntent(params: {
  id: string;
  walletAddress: string;
  mode: TradeMode;
  side: Side;
  mint: string;
  amountRaw: bigint;
  thesisId: string | null;
  evaluation: SellEvaluation | null;
  now: Date;
  ttlMs?: number;
}): TradeIntent {
  if (params.amountRaw <= 0n) throw new IntentError("invalid_amount", "Amount must be greater than zero.");
  const needsAck = params.side === "sell" && !!params.evaluation?.requiresAcknowledgement;
  return {
    id: params.id,
    walletAddress: params.walletAddress,
    mode: params.mode,
    side: params.side,
    mint: params.mint,
    amountRaw: params.amountRaw,
    thesisId: params.thesisId,
    evaluation: params.evaluation,
    status: needsAck ? "pending_ack" : "cleared",
    acknowledgement: null,
    createdAt: params.now,
    expiresAt: new Date(params.now.getTime() + (params.ttlMs ?? INTENT_TTL_MS)),
    consumedAt: null,
  };
}

export function effectiveStatus(intent: TradeIntent, now: Date): IntentStatus {
  if ((intent.status === "pending_ack" || intent.status === "cleared") && now >= intent.expiresAt) return "expired";
  return intent.status;
}

export function acknowledge(intent: TradeIntent, action: IntentAction, now: Date): TradeIntent {
  const status = effectiveStatus(intent, now);
  if (status !== "pending_ack")
    throw new IntentError("invalid_state", `This sell can't be acknowledged (status: ${status}).`);
  if (action === "keep_holding") return { ...intent, status: "cancelled", acknowledgement: action };
  // update_thesis and sell_anyway both let the user continue to confirmation.
  return { ...intent, status: "cleared", acknowledgement: action };
}

export interface ExecutionRequest {
  walletAddress: string;
  mode: TradeMode;
  side: Side;
  mint: string;
  amountRaw: bigint;
}

/** Validate that an execution request is authorised by this intent. Throws IntentError. */
export function assertExecutable(intent: TradeIntent, req: ExecutionRequest, now: Date): void {
  const status = effectiveStatus(intent, now);
  if (status === "pending_ack")
    throw new IntentError("ack_required", "Review your SECOND CHANCE reminder before selling.");
  if (status === "consumed") throw new IntentError("already_used", "This trade was already submitted.");
  if (status !== "cleared") throw new IntentError("invalid_state", `This trade can't be executed (status: ${status}).`);
  if (intent.walletAddress !== req.walletAddress) throw new IntentError("forbidden", "Wallet mismatch.");
  if (intent.mode !== req.mode) throw new IntentError("mismatch", "Trading mode changed. Start the trade again.");
  if (intent.side !== req.side || intent.mint !== req.mint)
    throw new IntentError("mismatch", "The trade doesn't match what you reviewed.");
  if (req.amountRaw <= 0n) throw new IntentError("invalid_amount", "Amount must be greater than zero.");
  if (req.amountRaw > intent.amountRaw)
    throw new IntentError("mismatch", "Amount is larger than what you reviewed. Start the trade again.");
}

export function consume(intent: TradeIntent, now: Date): TradeIntent {
  return { ...intent, status: "consumed", consumedAt: now };
}

export class IntentError extends Error {
  constructor(
    public code:
      | "invalid_amount"
      | "invalid_state"
      | "ack_required"
      | "already_used"
      | "forbidden"
      | "mismatch"
      | "not_found",
    message: string,
  ) {
    super(message);
  }
}
