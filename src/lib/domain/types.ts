// Shared domain types. Pure — no framework or I/O imports, so these modules
// can be unit-tested in isolation and imported by both server and client.

export type TradeMode = "paper" | "real";
export type Side = "buy" | "sell";

export interface PlannedExit {
  id: string;
  /** Market cap (USD) at which the user planned to take this partial exit. */
  atMarketCap: number;
  /** Percent of the ORIGINAL position planned to be sold at this level (0–100). */
  sellPercent: number;
}

export interface ThesisContent {
  reason: string;
  targetMarketCap: number;
  holdingPeriod: string | null;
  invalidation: string | null;
  plannedExits: PlannedExit[];
  notes: string | null;
}

export interface Thesis extends ThesisContent {
  id: string;
  walletAddress: string;
  mint: string;
  mode: TradeMode;
  entryMarketCap: number | null;
  /** Raw token amount held when the thesis was created (base units). Null if unknown. */
  originalPositionRaw: bigint | null;
  /** Cumulative percent of the original position already sold under planned exits. */
  plannedExitSoldPercent: number;
  status: "active" | "closed";
  createdAt: Date;
  /** The immutable first version. Edits create revisions, never overwrite this. */
  original: ThesisContent;
  revisionCount: number;
}

export type SellVerdict =
  | "no_thesis"
  | "at_or_above_target"
  | "planned_exit"
  | "below_target"
  | "market_data_unavailable";

export interface SellEvaluation {
  verdict: SellVerdict;
  requiresAcknowledgement: boolean;
  currentMarketCap: number | null;
  targetMarketCap: number | null;
  entryMarketCap: number | null;
  /** 0..1 progress from entry toward target; null when unknown. */
  progress: number | null;
  /** Percent of the original position this sell represents. */
  sellPercentOfOriginal: number | null;
  matchedExit: PlannedExit | null;
  /** Remaining percent of original position allowed by reached planned exits. */
  plannedAllowancePercent: number;
  marketDataNote: string | null;
}
