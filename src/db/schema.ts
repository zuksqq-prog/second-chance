import { sql } from "drizzle-orm";
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { SellEvaluation, ThesisContent } from "@/lib/domain/types";

/** Raw token / lamport amounts are stored as numeric(40,0) strings and parsed to bigint. */
const raw = (name: string) => numeric(name, { precision: 40, scale: 0 });

export const users = pgTable("users", {
  walletAddress: text("wallet_address").primaryKey(),
  settings: jsonb("settings").$type<UserSettings>().notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
});

export interface UserSettings {
  buyPresetsSol?: string[];
  sellPresetsPct?: number[];
  slippageBps?: number;
  priorityFeeLamports?: string;
  widget?: { x: number; y: number; w: number; h: number; minimized: boolean; hidden: boolean; pinned: boolean };
  defaultMode?: "paper" | "real";
  instant?: InstantSettings;
}

export interface InstantSettings {
  buySlippageBps: number;
  buyPriorityLamports: string;
  sellSlippageBps: number;
  sellPriorityLamports: string;
  /** Panel position; per account so it follows you between devices. */
  x?: number;
  y?: number;
}

export const authNonces = pgTable("auth_nonces", {
  nonce: text("nonce").primaryKey(),
  walletAddress: text("wallet_address").notNull(),
  message: text("message").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
});

export const theses = pgTable(
  "theses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    walletAddress: text("wallet_address").notNull().references(() => users.walletAddress, { onDelete: "cascade" }),
    mint: text("mint").notNull(),
    mode: text("mode", { enum: ["paper", "real"] }).notNull(),
    tokenSymbol: text("token_symbol"),
    entryMarketCap: doublePrecision("entry_market_cap"),
    /** Immutable first version. Never updated after insert. */
    original: jsonb("original").$type<ThesisContent>().notNull(),
    /** Latest revision's content (denormalised for fast reads). */
    current: jsonb("current").$type<ThesisContent>().notNull(),
    originalPositionRaw: raw("original_position_raw"),
    plannedExitSoldPercent: doublePrecision("planned_exit_sold_percent").notNull().default(0),
    status: text("status", { enum: ["active", "closed"] }).notNull().default("active"),
    revisionCount: integer("revision_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("theses_one_active_per_token").on(t.walletAddress, t.mint, t.mode).where(sql`status = 'active'`),
    index("theses_wallet_idx").on(t.walletAddress),
  ],
);

export const thesisRevisions = pgTable(
  "thesis_revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    thesisId: uuid("thesis_id").notNull().references(() => theses.id, { onDelete: "cascade" }),
    revisionNo: integer("revision_no").notNull(),
    content: jsonb("content").$type<ThesisContent>().notNull(),
    changedFields: text("changed_fields").array().notNull(),
    changeReason: text("change_reason").notNull(),
    /** 'edit' from the thesis panel, 'second_chance' from the pre-sell reminder. */
    trigger: text("trigger", { enum: ["edit", "second_chance"] }).notNull(),
    marketCapAtChange: doublePrecision("market_cap_at_change"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("thesis_revisions_no").on(t.thesisId, t.revisionNo)],
);

export const tradeIntents = pgTable(
  "trade_intents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    walletAddress: text("wallet_address").notNull().references(() => users.walletAddress, { onDelete: "cascade" }),
    mode: text("mode", { enum: ["paper", "real"] }).notNull(),
    side: text("side", { enum: ["buy", "sell"] }).notNull(),
    mint: text("mint").notNull(),
    amountRaw: raw("amount_raw").notNull(),
    thesisId: uuid("thesis_id").references(() => theses.id, { onDelete: "set null" }),
    evaluation: jsonb("evaluation").$type<SellEvaluation>(),
    status: text("status", { enum: ["pending_ack", "cleared", "cancelled", "consumed", "expired"] }).notNull(),
    acknowledgement: text("acknowledgement", { enum: ["keep_holding", "update_thesis", "sell_anyway"] }),
    ackNote: text("ack_note"),
    /** Client-generated key; the same key always maps to the same intent (double-click protection). */
    idempotencyKey: text("idempotency_key").notNull(),
    /** Real trades: the Jupiter order bound to this intent. */
    orderRequestId: text("order_request_id"),
    /** sha256 of the unsigned message we handed to the wallet; the signed tx must match. */
    orderMessageHash: text("order_message_hash"),
    orderInAmountRaw: raw("order_in_amount_raw"),
    orderOutAmountRaw: raw("order_out_amount_raw"),
    orderCreatedAt: timestamp("order_created_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("trade_intents_idem").on(t.walletAddress, t.idempotencyKey)],
);

export const trades = pgTable(
  "trades",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    walletAddress: text("wallet_address").notNull().references(() => users.walletAddress, { onDelete: "cascade" }),
    mode: text("mode", { enum: ["paper", "real"] }).notNull(),
    mint: text("mint").notNull(),
    tokenSymbol: text("token_symbol"),
    tokenDecimals: integer("token_decimals").notNull(),
    side: text("side", { enum: ["buy", "sell"] }).notNull(),
    tokenAmountRaw: raw("token_amount_raw").notNull(),
    solAmountLamports: raw("sol_amount_lamports").notNull(),
    networkFeeLamports: raw("network_fee_lamports").notNull().default("0"),
    platformFeeLamports: raw("platform_fee_lamports").notNull().default("0"),
    priceSol: doublePrecision("price_sol"),
    priceUsd: doublePrecision("price_usd"),
    marketCap: doublePrecision("market_cap"),
    /** Real trades: on-chain signature. Paper trades: null. */
    signature: text("signature"),
    jupiterRequestId: text("jupiter_request_id"),
    status: text("status", { enum: ["pending", "confirmed", "failed"] }).notNull(),
    error: text("error"),
    intentId: uuid("intent_id").references(() => tradeIntents.id, { onDelete: "set null" }),
    /** Paper trades are always 'paper'. */
    simulated: boolean("simulated").notNull(),
    secondChanceShown: boolean("second_chance_shown").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("trades_signature").on(t.signature).where(sql`signature is not null`),
    index("trades_wallet_mode_idx").on(t.walletAddress, t.mode, t.createdAt),
  ],
);

export const paperAccounts = pgTable("paper_accounts", {
  walletAddress: text("wallet_address").primaryKey().references(() => users.walletAddress, { onDelete: "cascade" }),
  solBalanceLamports: raw("sol_balance_lamports").notNull(),
  startingBalanceLamports: raw("starting_balance_lamports").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  resetAt: timestamp("reset_at", { withTimezone: true }),
});

export const watchlist = pgTable(
  "watchlist",
  {
    walletAddress: text("wallet_address").notNull().references(() => users.walletAddress, { onDelete: "cascade" }),
    mint: text("mint").notNull(),
    symbol: text("symbol"),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.walletAddress, t.mint] })],
);
