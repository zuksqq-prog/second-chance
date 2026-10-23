import type { TokenSnapshot } from "@/lib/domain/market";
import type { PlannedExit, SellEvaluation, ThesisContent, TradeMode } from "@/lib/domain/types";

export type { TokenSnapshot, PlannedExit, SellEvaluation, ThesisContent, TradeMode };

/** Thesis as returned by the API (bigints serialised as strings). */
export interface ThesisDTO extends ThesisContent {
  id: string;
  mint: string;
  mode: TradeMode;
  tokenSymbol: string | null;
  entryMarketCap: number | null;
  originalPositionRaw: string | null;
  plannedExitSoldPercent: number;
  status: "active" | "closed";
  createdAt: string;
  original: ThesisContent;
  revisionCount: number;
}

export interface IntentDTO {
  id: string;
  mode: TradeMode;
  side: "buy" | "sell";
  mint: string;
  amountRaw: string;
  status: "pending_ack" | "cleared" | "cancelled" | "consumed" | "expired";
  acknowledgement: string | null;
  evaluation: SellEvaluation | null;
  thesisId: string | null;
  expiresAt: string;
}

export interface TradeDTO {
  id: string;
  mode: TradeMode;
  mint: string;
  tokenSymbol: string | null;
  tokenDecimals: number;
  side: "buy" | "sell";
  tokenAmountRaw: string;
  solAmountLamports: string;
  networkFeeLamports: string;
  platformFeeLamports: string;
  priceSol: number | null;
  priceUsd: number | null;
  marketCap: number | null;
  signature: string | null;
  status: "pending" | "confirmed" | "failed";
  error: string | null;
  simulated: boolean;
  secondChanceShown: boolean;
  createdAt: string;
  confirmedAt: string | null;
}

export interface PortfolioDTO {
  mode: TradeMode;
  simulated: boolean;
  solBalance: number | null;
  solUsd: number | null;
  positionsValueSol: number;
  totalValueSol: number | null;
  realizedPnlSol: number;
  unrealizedPnlSol: number;
  hasUnknownBasis: boolean;
  warnings: string[];
  rows: {
    mint: string;
    symbol: string;
    name: string | null;
    imageUrl: string | null;
    decimals: number;
    quantityRaw: string;
    quantity: number;
    costBasisStatus: "verified" | "partial" | "unknown" | "none";
    avgEntryPriceSol: number | null;
    priceSol: number | null;
    priceUsd: number | null;
    marketCap: number | null;
    marketValueSol: number | null;
    marketValueUsd: number | null;
    unrealizedPnlSol: number | null;
    unrealizedPnlPct: number | null;
    realizedPnlSol: number;
    feesSol: number;
    unknownBasisProceedsSol: number;
    thesis: { id: string; targetMarketCap: number; entryMarketCap: number | null; progress: number | null } | null;
  }[];
}

export interface SettingsDTO {
  buyPresetsSol: string[];
  sellPresetsPct: number[];
  slippageBps: number;
  priorityFeeLamports: string;
  defaultMode: TradeMode;
  widget?: { x: number; y: number; w: number; h: number; minimized: boolean; hidden: boolean; pinned: boolean };
}
