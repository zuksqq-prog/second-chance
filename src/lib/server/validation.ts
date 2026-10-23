import { z } from "zod";
import { isSolanaAddress } from "@/lib/domain/sanitize";

export const address = z.string().refine(isSolanaAddress, "Invalid Solana address.");
export const mode = z.enum(["paper", "real"]);
export const rawAmount = z
  .string()
  .regex(/^\d{1,30}$/, "Amount must be a whole number of base units.")
  .transform((s) => BigInt(s))
  .refine((v) => v > 0n, "Amount must be greater than zero.");

const mcap = z.number().finite().positive().max(1e13);

export const plannedExit = z.object({
  id: z.string().min(1).max(40),
  atMarketCap: mcap,
  sellPercent: z.number().finite().gt(0).max(100),
});

export const thesisContent = z.object({
  reason: z.string().trim().min(3, "Say briefly why you're buying.").max(2000),
  targetMarketCap: mcap,
  holdingPeriod: z.string().trim().max(80).nullable().default(null),
  invalidation: z.string().trim().max(1000).nullable().default(null),
  plannedExits: z.array(plannedExit).max(10).default([]),
  notes: z.string().trim().max(2000).nullable().default(null),
});

export const createThesisBody = z.object({
  mint: address,
  mode,
  content: thesisContent,
  /** Market cap at entry; when omitted the server uses the live value. */
  entryMarketCap: mcap.nullable().optional(),
});

export const reviseThesisBody = z.object({
  patch: thesisContent.partial(),
  reason: z.string().trim().min(3, "Tell your future self why the plan changed.").max(1000),
});

export const startTradeBody = z.object({
  mode,
  side: z.enum(["buy", "sell"]),
  mint: address,
  amountRaw: rawAmount,
  idempotencyKey: z.string().min(8).max(64),
});

export const ackBody = z.object({
  action: z.enum(["keep_holding", "update_thesis", "sell_anyway"]),
  update: z.object({ patch: thesisContent.partial().default({}), reason: z.string().trim().max(1000) }).optional(),
});

export const paperExecuteBody = z.object({
  intentId: z.string().uuid(),
  slippageBps: z.number().int().min(1).max(5000),
  priorityFeeLamports: z
    .string()
    .regex(/^\d{1,12}$/)
    .transform((s) => BigInt(s)),
});

export const realOrderBody = z.object({ intentId: z.string().uuid(), slippageBps: z.number().int().min(1).max(5000) });
export const realExecuteBody = z.object({
  intentId: z.string().uuid(),
  signedTransaction: z.string().min(100).max(4000).regex(/^[A-Za-z0-9+/=]+$/, "Invalid transaction encoding."),
});

export const settingsBody = z.object({
  buyPresetsSol: z.array(z.string().regex(/^\d+(\.\d{1,9})?$/)).min(1).max(8).optional(),
  sellPresetsPct: z.array(z.number().gt(0).max(100)).min(1).max(8).optional(),
  slippageBps: z.number().int().min(1).max(5000).optional(),
  priorityFeeLamports: z.string().regex(/^\d{1,12}$/).optional(),
  widget: z
    .object({
      x: z.number().finite(),
      y: z.number().finite(),
      w: z.number().min(200).max(1600),
      h: z.number().min(120).max(1400),
      minimized: z.boolean(),
      hidden: z.boolean(),
      pinned: z.boolean(),
    })
    .optional(),
  defaultMode: mode.optional(),
});

export const watchBody = z.object({ mint: address, symbol: z.string().max(16).nullable().optional() });

export const discoveryQuery = z.object({
  kind: z.enum(["trending", "new"]).default("trending"),
  page: z.coerce.number().int().min(1).max(10).default(1),
  minMarketCap: z.coerce.number().optional(),
  maxMarketCap: z.coerce.number().optional(),
  minLiquidity: z.coerce.number().optional(),
  minVolume24h: z.coerce.number().optional(),
  maxAgeHours: z.coerce.number().optional(),
  minAgeHours: z.coerce.number().optional(),
  minChange1h: z.coerce.number().optional(),
  maxChange1h: z.coerce.number().optional(),
  minTxns1h: z.coerce.number().optional(),
});
