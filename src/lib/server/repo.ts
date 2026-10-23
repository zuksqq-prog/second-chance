import "server-only";
import { createHash } from "node:crypto";
import { sql } from "@/db";
import type { UserSettings } from "@/db/schema";
import type { SellEvaluation, Thesis, ThesisContent, TradeMode } from "@/lib/domain/types";
import type { IntentAction, TradeIntent } from "@/lib/domain/trade-intent";
import type { LedgerTrade } from "@/lib/domain/portfolio";

/**
 * Data access. Uses parameterised SQL through postgres.js so atomic,
 * conditional updates (single-use intents, balance debits) are explicit and
 * auditable. Table definitions live in src/db/schema.ts (Drizzle) and the
 * migration in drizzle/0000_init.sql.
 */

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const big = (v: unknown): bigint => BigInt(String(v ?? "0"));
const bigOrNull = (v: unknown): bigint | null => (v == null ? null : BigInt(String(v)));

// ---------- users ----------

export async function upsertUser(wallet: string) {
  await sql`insert into users (wallet_address) values (${wallet})
            on conflict (wallet_address) do update set last_seen_at = now()`;
}

export async function getSettings(wallet: string): Promise<UserSettings> {
  const [r] = await sql`select settings from users where wallet_address = ${wallet}`;
  return (r?.settings as UserSettings) ?? {};
}

export async function saveSettings(wallet: string, s: UserSettings) {
  await sql`update users set settings = settings || ${sql.json(s as never)} where wallet_address = ${wallet}`;
}

// ---------- auth nonces ----------

export async function storeNonce(nonce: string, wallet: string, message: string, expiresAt: Date) {
  await sql`insert into auth_nonces (nonce, wallet_address, message, expires_at) values (${nonce}, ${wallet}, ${message}, ${expiresAt})`;
}

/** Atomically mark a nonce used; returns the stored message or null if missing/used/expired. */
export async function consumeNonce(nonce: string, wallet: string): Promise<string | null> {
  const [r] = await sql`update auth_nonces set used_at = now()
                        where nonce = ${nonce} and wallet_address = ${wallet} and used_at is null and expires_at > now()
                        returning message`;
  return r?.message ?? null;
}

// ---------- theses ----------

function toThesis(r: Row): Thesis {
  const cur = r.current as ThesisContent;
  return {
    id: r.id,
    walletAddress: r.walletAddress,
    mint: r.mint,
    mode: r.mode,
    entryMarketCap: r.entryMarketCap,
    originalPositionRaw: bigOrNull(r.originalPositionRaw),
    plannedExitSoldPercent: r.plannedExitSoldPercent,
    status: r.status,
    createdAt: r.createdAt,
    original: r.original,
    revisionCount: r.revisionCount,
    ...cur,
  };
}

export interface ThesisRecord extends Thesis {
  tokenSymbol: string | null;
}

export async function getActiveThesis(wallet: string, mint: string, mode: TradeMode): Promise<ThesisRecord | null> {
  const [r] = await sql`select * from theses where wallet_address = ${wallet} and mint = ${mint} and mode = ${mode} and status = 'active'`;
  return r ? { ...toThesis(r), tokenSymbol: r.tokenSymbol } : null;
}

export async function getThesis(wallet: string, id: string): Promise<ThesisRecord | null> {
  const [r] = await sql`select * from theses where id = ${id} and wallet_address = ${wallet}`;
  return r ? { ...toThesis(r), tokenSymbol: r.tokenSymbol } : null;
}

export async function listTheses(wallet: string, mode: TradeMode): Promise<ThesisRecord[]> {
  const rows = await sql`select * from theses where wallet_address = ${wallet} and mode = ${mode} order by created_at desc limit 200`;
  return rows.map((r) => ({ ...toThesis(r), tokenSymbol: r.tokenSymbol }));
}

export async function createThesis(p: {
  wallet: string;
  mint: string;
  mode: TradeMode;
  tokenSymbol: string | null;
  entryMarketCap: number | null;
  content: ThesisContent;
  originalPositionRaw: bigint | null;
}): Promise<ThesisRecord> {
  return sql.begin(async (tx) => {
    const [existing] = await tx`select id from theses where wallet_address = ${p.wallet} and mint = ${p.mint} and mode = ${p.mode} and status = 'active' for update`;
    if (existing) throw Object.assign(new Error("You already have an active thesis for this token. Edit it instead."), { code: "exists" });
    const [r] = await tx`insert into theses (wallet_address, mint, mode, token_symbol, entry_market_cap, original, current, original_position_raw)
                         values (${p.wallet}, ${p.mint}, ${p.mode}, ${p.tokenSymbol}, ${p.entryMarketCap},
                                 ${tx.json(p.content as never)}, ${tx.json(p.content as never)}, ${p.originalPositionRaw?.toString() ?? null})
                         returning *`;
    await tx`insert into thesis_revisions (thesis_id, revision_no, content, changed_fields, change_reason, trigger, market_cap_at_change)
             values (${r.id}, 0, ${tx.json(p.content as never)}, ${["created"]}, 'Original thesis', 'edit', ${p.entryMarketCap})`;
    return { ...toThesis(r), tokenSymbol: r.tokenSymbol };
  }) as Promise<ThesisRecord>;
}

export async function addRevision(p: {
  thesisId: string;
  wallet: string;
  next: ThesisContent;
  changed: string[];
  reason: string;
  trigger: "edit" | "second_chance";
  marketCap: number | null;
}): Promise<ThesisRecord> {
  return sql.begin(async (tx) => {
    const [t] = await tx`update theses set current = ${tx.json(p.next as never)}, revision_count = revision_count + 1, updated_at = now()
                         where id = ${p.thesisId} and wallet_address = ${p.wallet} and status = 'active'
                         returning *`;
    if (!t) throw Object.assign(new Error("Thesis not found."), { code: "not_found" });
    await tx`insert into thesis_revisions (thesis_id, revision_no, content, changed_fields, change_reason, trigger, market_cap_at_change)
             values (${p.thesisId}, ${t.revisionCount}, ${tx.json(p.next as never)}, ${p.changed}, ${p.reason}, ${p.trigger}, ${p.marketCap})`;
    return { ...toThesis(t), tokenSymbol: t.tokenSymbol };
  }) as Promise<ThesisRecord>;
}

export async function listRevisions(thesisId: string, wallet: string) {
  return sql`select r.revision_no, r.content, r.changed_fields, r.change_reason, r.trigger, r.market_cap_at_change, r.created_at
             from thesis_revisions r join theses t on t.id = r.thesis_id
             where r.thesis_id = ${thesisId} and t.wallet_address = ${wallet}
             order by r.revision_no asc`;
}

export async function closeThesis(wallet: string, id: string) {
  await sql`update theses set status = 'closed', updated_at = now() where id = ${id} and wallet_address = ${wallet}`;
}

/** Explicit user data deletion. Revisions cascade. */
export async function deleteThesis(wallet: string, id: string) {
  await sql`delete from theses where id = ${id} and wallet_address = ${wallet}`;
}

export async function bumpThesisAfterTrade(p: {
  thesisId: string;
  boughtRaw?: bigint;
  plannedExitSoldPercent?: number;
}) {
  if (p.boughtRaw) {
    await sql`update theses set original_position_raw = coalesce(original_position_raw, 0) + ${p.boughtRaw.toString()}, updated_at = now()
              where id = ${p.thesisId} and status = 'active'`;
  }
  if (p.plannedExitSoldPercent != null) {
    await sql`update theses set planned_exit_sold_percent = ${p.plannedExitSoldPercent}, updated_at = now() where id = ${p.thesisId}`;
  }
}

// ---------- intents ----------

function toIntent(r: Row): TradeIntent & {
  orderRequestId: string | null;
  orderMessageHash: string | null;
  orderCreatedAt: Date | null;
  orderOutAmountRaw: bigint | null;
  ackNote: string | null;
} {
  return {
    id: r.id,
    walletAddress: r.walletAddress,
    mode: r.mode,
    side: r.side,
    mint: r.mint,
    amountRaw: big(r.amountRaw),
    thesisId: r.thesisId,
    evaluation: r.evaluation as SellEvaluation | null,
    status: r.status,
    acknowledgement: r.acknowledgement,
    createdAt: r.createdAt,
    expiresAt: r.expiresAt,
    consumedAt: r.consumedAt,
    orderRequestId: r.orderRequestId,
    orderMessageHash: r.orderMessageHash,
    orderCreatedAt: r.orderCreatedAt,
    orderOutAmountRaw: bigOrNull(r.orderOutAmountRaw),
    ackNote: r.ackNote,
  };
}
export type StoredIntent = ReturnType<typeof toIntent>;

/** Insert, or return the existing intent for this idempotency key (double-click safe). */
export async function insertIntent(i: TradeIntent, idempotencyKey: string): Promise<StoredIntent> {
  const [r] = await sql`insert into trade_intents (id, wallet_address, mode, side, mint, amount_raw, thesis_id, evaluation, status, idempotency_key, created_at, expires_at)
                        values (${i.id}, ${i.walletAddress}, ${i.mode}, ${i.side}, ${i.mint}, ${i.amountRaw.toString()}, ${i.thesisId},
                                ${i.evaluation ? sql.json(i.evaluation as never) : null}, ${i.status}, ${idempotencyKey}, ${i.createdAt}, ${i.expiresAt})
                        on conflict (wallet_address, idempotency_key) do nothing
                        returning *`;
  if (r) return toIntent(r);
  const [existing] = await sql`select * from trade_intents where wallet_address = ${i.walletAddress} and idempotency_key = ${idempotencyKey}`;
  return toIntent(existing);
}

export async function getIntent(wallet: string, id: string): Promise<StoredIntent | null> {
  const [r] = await sql`select * from trade_intents where id = ${id} and wallet_address = ${wallet}`;
  return r ? toIntent(r) : null;
}

/** Conditional transition: only succeeds from pending_ack and before expiry. */
export async function acknowledgeIntent(wallet: string, id: string, action: IntentAction, note: string | null): Promise<StoredIntent | null> {
  const next = action === "keep_holding" ? "cancelled" : "cleared";
  const [r] = await sql`update trade_intents set status = ${next}, acknowledgement = ${action}, ack_note = ${note}
                        where id = ${id} and wallet_address = ${wallet} and status = 'pending_ack' and expires_at > now()
                        returning *`;
  return r ? toIntent(r) : null;
}

export async function attachOrder(id: string, wallet: string, o: { requestId: string; messageHash: string; inAmount: bigint; outAmount: bigint }) {
  const [r] = await sql`update trade_intents set order_request_id = ${o.requestId}, order_message_hash = ${o.messageHash},
                          order_in_amount_raw = ${o.inAmount.toString()}, order_out_amount_raw = ${o.outAmount.toString()}, order_created_at = now()
                        where id = ${id} and wallet_address = ${wallet} and status = 'cleared' and expires_at > now()
                        returning id`;
  return !!r;
}

/**
 * Single-use consumption. The WHERE clause is the enforcement point: a sell
 * can only execute through an intent that is cleared (reminder acknowledged
 * when required), unexpired, and — for real trades — whose signed message
 * matches the quoted one. Two concurrent requests: exactly one wins.
 */
export async function consumeIntent(wallet: string, id: string, messageHash: string | null): Promise<StoredIntent | null> {
  const [r] = messageHash
    ? await sql`update trade_intents set status = 'consumed', consumed_at = now()
                where id = ${id} and wallet_address = ${wallet} and status = 'cleared' and expires_at > now()
                  and order_message_hash = ${messageHash}
                returning *`
    : await sql`update trade_intents set status = 'consumed', consumed_at = now()
                where id = ${id} and wallet_address = ${wallet} and status = 'cleared' and expires_at > now()
                  and mode = 'paper'
                returning *`;
  return r ? toIntent(r) : null;
}

export function sha256Hex(b: Uint8Array): string {
  return createHash("sha256").update(b).digest("hex");
}

// ---------- trades ----------

export interface TradeRow {
  id: string;
  mode: TradeMode;
  mint: string;
  tokenSymbol: string | null;
  tokenDecimals: number;
  side: "buy" | "sell";
  tokenAmountRaw: bigint;
  solAmountLamports: bigint;
  networkFeeLamports: bigint;
  platformFeeLamports: bigint;
  priceSol: number | null;
  priceUsd: number | null;
  marketCap: number | null;
  signature: string | null;
  status: "pending" | "confirmed" | "failed";
  error: string | null;
  simulated: boolean;
  secondChanceShown: boolean;
  intentId: string | null;
  createdAt: Date;
  confirmedAt: Date | null;
}

function toTrade(r: Row): TradeRow {
  return {
    ...(r as TradeRow),
    tokenAmountRaw: big(r.tokenAmountRaw),
    solAmountLamports: big(r.solAmountLamports),
    networkFeeLamports: big(r.networkFeeLamports),
    platformFeeLamports: big(r.platformFeeLamports),
  };
}

export async function insertTrade(t: Omit<TradeRow, "id" | "createdAt" | "confirmedAt"> & { wallet: string; jupiterRequestId?: string | null }, txn = sql): Promise<TradeRow> {
  const [r] = await txn`insert into trades (wallet_address, mode, mint, token_symbol, token_decimals, side, token_amount_raw, sol_amount_lamports,
                          network_fee_lamports, platform_fee_lamports, price_sol, price_usd, market_cap, signature, jupiter_request_id, status, error,
                          intent_id, simulated, second_chance_shown, confirmed_at)
                        values (${t.wallet}, ${t.mode}, ${t.mint}, ${t.tokenSymbol}, ${t.tokenDecimals}, ${t.side}, ${t.tokenAmountRaw.toString()},
                          ${t.solAmountLamports.toString()}, ${t.networkFeeLamports.toString()}, ${t.platformFeeLamports.toString()},
                          ${t.priceSol}, ${t.priceUsd}, ${t.marketCap}, ${t.signature}, ${t.jupiterRequestId ?? null}, ${t.status}, ${t.error},
                          ${t.intentId}, ${t.simulated}, ${t.secondChanceShown}, ${t.status === "confirmed" ? new Date() : null})
                        returning *`;
  return toTrade(r);
}

export async function updateTrade(id: string, patch: Partial<Pick<TradeRow, "status" | "error" | "signature" | "tokenAmountRaw" | "solAmountLamports" | "networkFeeLamports" | "platformFeeLamports">>) {
  const [r] = await sql`update trades set
      status = coalesce(${patch.status ?? null}, status),
      error = coalesce(${patch.error ?? null}, error),
      signature = coalesce(${patch.signature ?? null}, signature),
      token_amount_raw = coalesce(${patch.tokenAmountRaw?.toString() ?? null}::numeric, token_amount_raw),
      sol_amount_lamports = coalesce(${patch.solAmountLamports?.toString() ?? null}::numeric, sol_amount_lamports),
      network_fee_lamports = coalesce(${patch.networkFeeLamports?.toString() ?? null}::numeric, network_fee_lamports),
      platform_fee_lamports = coalesce(${patch.platformFeeLamports?.toString() ?? null}::numeric, platform_fee_lamports),
      confirmed_at = case when ${patch.status ?? null}::text = 'confirmed' then now() else confirmed_at end
    where id = ${id} returning *`;
  return r ? toTrade(r) : null;
}

export async function getTrade(wallet: string, id: string): Promise<(TradeRow & { walletAddress: string }) | null> {
  const [r] = await sql`select * from trades where id = ${id} and wallet_address = ${wallet}`;
  return r ? { ...toTrade(r), walletAddress: r.walletAddress } : null;
}

export async function listTrades(wallet: string, mode: TradeMode, limit = 200): Promise<TradeRow[]> {
  const rows = await sql`select * from trades where wallet_address = ${wallet} and mode = ${mode} order by created_at desc limit ${limit}`;
  return rows.map(toTrade);
}

export async function listPendingRealTrades(wallet: string): Promise<TradeRow[]> {
  const rows = await sql`select * from trades where wallet_address = ${wallet} and mode = 'real' and status = 'pending' and signature is not null`;
  return rows.map(toTrade);
}

/** All wallets' pending real trades (for the background reconciler). */
export async function listAllPendingRealTrades(limit = 100): Promise<{ id: string; walletAddress: string }[]> {
  const rows = await sql`select id, wallet_address from trades where mode = 'real' and status = 'pending' order by created_at asc limit ${limit}`;
  return rows.map((r) => ({ id: r.id as string, walletAddress: r.walletAddress as string }));
}

/** Mark lapsed intents expired so they show correctly in audits. */
export async function expireStaleIntents(): Promise<number> {
  const r = await sql`update trade_intents set status = 'expired' where status in ('pending_ack','cleared') and expires_at < now() returning id`;
  return r.length;
}

export function toLedger(rows: TradeRow[]): LedgerTrade[] {
  return rows
    .filter((r) => r.status === "confirmed" && r.tokenAmountRaw > 0n)
    .map((r) => ({
      id: r.id,
      mint: r.mint,
      side: r.side,
      tokenAmountRaw: r.tokenAmountRaw,
      solAmountLamports: r.solAmountLamports,
      networkFeeLamports: r.networkFeeLamports,
      platformFeeLamports: r.platformFeeLamports,
      timestamp: r.confirmedAt ?? r.createdAt,
    }));
}

// ---------- paper account ----------

export async function getOrCreatePaperAccount(wallet: string, startingLamports: bigint) {
  await sql`insert into paper_accounts (wallet_address, sol_balance_lamports, starting_balance_lamports)
            values (${wallet}, ${startingLamports.toString()}, ${startingLamports.toString()})
            on conflict (wallet_address) do nothing`;
  const [r] = await sql`select * from paper_accounts where wallet_address = ${wallet}`;
  return { solBalanceLamports: big(r.solBalanceLamports), startingBalanceLamports: big(r.startingBalanceLamports), resetAt: r.resetAt as Date | null };
}

export async function resetPaperAccount(wallet: string, startingLamports: bigint) {
  await sql.begin(async (tx) => {
    await tx`delete from trades where wallet_address = ${wallet} and mode = 'paper'`;
    await tx`update theses set status = 'closed', updated_at = now() where wallet_address = ${wallet} and mode = 'paper' and status = 'active'`;
    await tx`update paper_accounts set sol_balance_lamports = ${startingLamports.toString()}, starting_balance_lamports = ${startingLamports.toString()}, reset_at = now()
             where wallet_address = ${wallet}`;
  });
}

/**
 * Apply a paper fill atomically: adjust SOL balance (never below zero) and
 * record the trade. Token balance checks for sells are done by the caller
 * inside the same transaction via `paperTokenBalance`.
 */
export async function applyPaperFill(p: {
  wallet: string;
  solDeltaLamports: bigint;
  trade: Parameters<typeof insertTrade>[0];
  requireTokenRaw?: { mint: string; amount: bigint };
}): Promise<TradeRow> {
  return sql.begin(async (tx) => {
    if (p.requireTokenRaw) {
      const [b] = await tx`select coalesce(sum(case when side = 'buy' then token_amount_raw else -token_amount_raw end), 0) as bal
                           from trades where wallet_address = ${p.wallet} and mode = 'paper' and mint = ${p.requireTokenRaw.mint} and status = 'confirmed'`;
      if (big(b.bal) < p.requireTokenRaw.amount) throw Object.assign(new Error("You don't hold that many tokens in paper mode."), { code: "insufficient" });
    }
    const [acct] = await tx`update paper_accounts set sol_balance_lamports = sol_balance_lamports + ${p.solDeltaLamports.toString()}::numeric
                            where wallet_address = ${p.wallet} and sol_balance_lamports + ${p.solDeltaLamports.toString()}::numeric >= 0
                            returning sol_balance_lamports`;
    if (!acct) throw Object.assign(new Error("Not enough paper SOL for this trade, including fees."), { code: "insufficient" });
    return insertTrade(p.trade, tx as unknown as typeof sql);
  }) as Promise<TradeRow>;
}

// ---------- watchlist ----------

export async function listWatchlist(wallet: string) {
  return sql`select mint, symbol, added_at from watchlist where wallet_address = ${wallet} order by added_at desc`;
}
export async function addWatch(wallet: string, mint: string, symbol: string | null) {
  await sql`insert into watchlist (wallet_address, mint, symbol) values (${wallet}, ${mint}, ${symbol}) on conflict do nothing`;
}
export async function removeWatch(wallet: string, mint: string) {
  await sql`delete from watchlist where wallet_address = ${wallet} and mint = ${mint}`;
}
