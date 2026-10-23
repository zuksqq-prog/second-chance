import type { PlannedExit, SellEvaluation, Thesis, ThesisContent } from "./types";

export interface SellEvaluationInput {
  thesis: Thesis | null;
  /** Current market cap in USD, or null if market data could not be retrieved. */
  currentMarketCap: number | null;
  /** When the market cap was observed. Used to reject stale data. */
  marketDataObservedAt: Date | null;
  now: Date;
  /** Raw token amount the user wants to sell. */
  sellAmountRaw: bigint;
  /** Raw token amount the user currently holds. */
  positionRaw: bigint;
  /** Maximum age before market data is treated as unavailable. Default 60s. */
  maxMarketDataAgeMs?: number;
  /** Tolerance when deciding a planned exit level is "reached". Default 3%. */
  exitTolerance?: number;
}

const DEFAULT_MAX_AGE_MS = 60_000;
const DEFAULT_EXIT_TOLERANCE = 0.03;
/** Allowance slack, in percentage points, for rounding in percentage presets. */
const ALLOWANCE_SLACK_PCT = 0.5;

export function progressTowardTarget(
  entry: number | null,
  current: number | null,
  target: number | null,
): number | null {
  if (current == null || target == null || !(target > 0)) return null;
  if (entry != null && entry > 0 && target > entry) {
    const p = (current - entry) / (target - entry);
    return clamp(p, 0, 1);
  }
  return clamp(current / target, 0, 1);
}

/** Percent of the original position that a sell of `sellAmountRaw` represents. */
export function sellPercentOfOriginal(
  sellAmountRaw: bigint,
  originalRaw: bigint | null,
  positionRaw: bigint,
): number | null {
  const base = originalRaw != null && originalRaw > 0n ? originalRaw : positionRaw;
  if (base <= 0n) return null;
  // basis points with bigint to avoid precision loss on large raw amounts
  const bps = (sellAmountRaw * 1_000_000n) / base;
  return Number(bps) / 10_000;
}

export function reachedExits(
  exits: PlannedExit[],
  currentMarketCap: number,
  tolerance = DEFAULT_EXIT_TOLERANCE,
): PlannedExit[] {
  return exits
    .filter((e) => currentMarketCap >= e.atMarketCap * (1 - tolerance))
    .sort((a, b) => a.atMarketCap - b.atMarketCap);
}

/**
 * Decide whether a sell needs the SECOND CHANCE reminder.
 * Pure and deterministic: the server calls this to create a trade intent;
 * the client may call it only for display.
 */
export function evaluateSell(input: SellEvaluationInput): SellEvaluation {
  const { thesis, now } = input;
  const maxAge = input.maxMarketDataAgeMs ?? DEFAULT_MAX_AGE_MS;
  const tolerance = input.exitTolerance ?? DEFAULT_EXIT_TOLERANCE;

  if (!thesis || thesis.status !== "active") {
    return {
      verdict: "no_thesis",
      requiresAcknowledgement: false,
      currentMarketCap: input.currentMarketCap,
      targetMarketCap: null,
      entryMarketCap: null,
      progress: null,
      sellPercentOfOriginal: null,
      matchedExit: null,
      plannedAllowancePercent: 0,
      marketDataNote: null,
    };
  }

  const sellPct = sellPercentOfOriginal(input.sellAmountRaw, thesis.originalPositionRaw, input.positionRaw);
  const base = {
    targetMarketCap: thesis.targetMarketCap,
    entryMarketCap: thesis.entryMarketCap,
    sellPercentOfOriginal: sellPct,
  };

  const stale =
    input.marketDataObservedAt == null ||
    now.getTime() - input.marketDataObservedAt.getTime() > maxAge;
  const mc = input.currentMarketCap;
  if (mc == null || !Number.isFinite(mc) || mc <= 0 || stale) {
    return {
      ...base,
      verdict: "market_data_unavailable",
      requiresAcknowledgement: true,
      currentMarketCap: mc != null && Number.isFinite(mc) && mc > 0 ? mc : null,
      progress: null,
      matchedExit: null,
      plannedAllowancePercent: 0,
      marketDataNote:
        mc == null || !(mc > 0)
          ? "Current market cap is unavailable. We can't tell whether this sell matches your plan."
          : "Market data is stale. We can't confirm whether this sell matches your plan.",
    };
  }

  const progress = progressTowardTarget(thesis.entryMarketCap, mc, thesis.targetMarketCap);

  if (mc >= thesis.targetMarketCap) {
    return {
      ...base,
      verdict: "at_or_above_target",
      requiresAcknowledgement: false,
      currentMarketCap: mc,
      progress,
      matchedExit: null,
      plannedAllowancePercent: 100,
      marketDataNote: null,
    };
  }

  const reached = reachedExits(thesis.plannedExits, mc, tolerance);
  const reachedPct = reached.reduce((s, e) => s + e.sellPercent, 0);
  const allowance = Math.max(0, reachedPct - thesis.plannedExitSoldPercent);

  if (reached.length > 0 && sellPct != null && sellPct <= allowance + ALLOWANCE_SLACK_PCT) {
    return {
      ...base,
      verdict: "planned_exit",
      requiresAcknowledgement: false,
      currentMarketCap: mc,
      progress,
      matchedExit: reached[reached.length - 1],
      plannedAllowancePercent: allowance,
      marketDataNote: null,
    };
  }

  return {
    ...base,
    verdict: "below_target",
    requiresAcknowledgement: true,
    currentMarketCap: mc,
    progress,
    matchedExit: null,
    plannedAllowancePercent: allowance,
    marketDataNote: null,
  };
}

/**
 * Apply an edit as a new revision. Returns the next current content and the
 * revision record; the original is never touched.
 */
export function reviseThesis(
  current: ThesisContent,
  patch: Partial<ThesisContent>,
  changeReason: string,
): { next: ThesisContent; changed: (keyof ThesisContent)[] } {
  if (!changeReason.trim()) throw new Error("A reason for the change is required.");
  const next: ThesisContent = { ...pickContent(current), ...pickContent(stripUndefined(patch) as ThesisContent) };
  validateThesisContent(next);
  const changed = (Object.keys(next) as (keyof ThesisContent)[]).filter(
    (k) => JSON.stringify(next[k]) !== JSON.stringify(current[k]),
  );
  if (changed.length === 0) throw new Error("No changes to save.");
  return { next, changed };
}

export function validateThesisContent(c: ThesisContent): void {
  if (!c.reason || c.reason.trim().length < 3) throw new Error("Say briefly why you're buying.");
  if (c.reason.length > 2000) throw new Error("Reason is too long (2000 characters max).");
  if (!Number.isFinite(c.targetMarketCap) || c.targetMarketCap <= 0)
    throw new Error("Target market cap must be a positive number.");
  if (c.targetMarketCap > 1e13) throw new Error("Target market cap is unrealistically large.");
  let total = 0;
  for (const e of c.plannedExits) {
    if (!Number.isFinite(e.atMarketCap) || e.atMarketCap <= 0)
      throw new Error("Each planned exit needs a positive market cap.");
    if (!Number.isFinite(e.sellPercent) || e.sellPercent <= 0 || e.sellPercent > 100)
      throw new Error("Each planned exit percent must be between 0 and 100.");
    total += e.sellPercent;
  }
  if (total > 100.0001) throw new Error("Planned exits add up to more than 100% of the position.");
  if (c.plannedExits.length > 10) throw new Error("Up to 10 planned exits.");
}

/** Update cumulative planned-exit sold percent after a sell that matched the plan. */
export function recordPlannedExitSale(thesis: Thesis, sellPct: number): number {
  return Math.min(100, thesis.plannedExitSoldPercent + Math.max(0, sellPct));
}

export const CONTENT_KEYS = ["reason", "targetMarketCap", "holdingPeriod", "invalidation", "plannedExits", "notes"] as const;

export function pickContent(c: Partial<ThesisContent>): ThesisContent {
  const out: Record<string, unknown> = {};
  for (const k of CONTENT_KEYS) if (c[k] !== undefined) out[k] = c[k];
  return out as unknown as ThesisContent;
}

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  return out;
}
