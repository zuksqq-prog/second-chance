import { test } from "node:test";
import assert from "node:assert/strict";
import { acknowledge, assertExecutable, consume, createIntent, effectiveStatus, IntentError } from "../src/lib/domain/trade-intent";
import type { SellEvaluation } from "../src/lib/domain/types";

const now = new Date("2026-10-22T12:00:00Z");
const later = (ms: number) => new Date(now.getTime() + ms);

const needsAck: SellEvaluation = {
  verdict: "below_target",
  requiresAcknowledgement: true,
  currentMarketCap: 4.2e6,
  targetMarketCap: 1e7,
  entryMarketCap: 1e6,
  progress: 0.35,
  sellPercentOfOriginal: 100,
  matchedExit: null,
  plannedAllowancePercent: 0,
  marketDataNote: null,
};
const noAck: SellEvaluation = { ...needsAck, verdict: "at_or_above_target", requiresAcknowledgement: false };

const mk = (evaluation: SellEvaluation | null, side: "buy" | "sell" = "sell") =>
  createIntent({ id: "i1", walletAddress: "W", mode: "real", side, mint: "M", amountRaw: 1000n, thesisId: "t", evaluation, now });

const req = { walletAddress: "W", mode: "real" as const, side: "sell" as const, mint: "M", amountRaw: 1000n };

function code(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return e instanceof IntentError ? e.code : "other";
  }
  return undefined;
}

test("sell below target cannot execute until acknowledged", () => {
  const i = mk(needsAck);
  assert.equal(i.status, "pending_ack");
  assert.equal(code(() => assertExecutable(i, req, now)), "ack_required");
});

test("sell anyway clears the intent; execution allowed once", () => {
  const i = acknowledge(mk(needsAck), "sell_anyway", later(1000));
  assert.equal(i.status, "cleared");
  assert.equal(code(() => assertExecutable(i, req, later(2000))), undefined);
  const used = consume(i, later(2000));
  assert.equal(code(() => assertExecutable(used, req, later(3000))), "already_used");
});

test("keep holding cancels", () => {
  const i = acknowledge(mk(needsAck), "keep_holding", now);
  assert.equal(i.status, "cancelled");
  assert.equal(code(() => assertExecutable(i, req, now)), "invalid_state");
});

test("update thesis also lets the user continue", () => {
  assert.equal(acknowledge(mk(needsAck), "update_thesis", now).status, "cleared");
});

test("cannot acknowledge twice or acknowledge a cleared intent", () => {
  const i = acknowledge(mk(needsAck), "sell_anyway", now);
  assert.equal(code(() => acknowledge(i, "sell_anyway", now)), "invalid_state");
  assert.equal(code(() => acknowledge(mk(noAck), "sell_anyway", now)), "invalid_state");
});

test("sells at target and buys are cleared immediately", () => {
  assert.equal(mk(noAck).status, "cleared");
  assert.equal(mk(null, "buy").status, "cleared");
});

test("intents expire", () => {
  const i = mk(noAck);
  assert.equal(effectiveStatus(i, later(5 * 60_000)), "expired");
  assert.equal(code(() => assertExecutable(i, req, later(5 * 60_000 + 1))), "invalid_state");
  assert.equal(code(() => acknowledge(mk(needsAck), "sell_anyway", later(6 * 60_000))), "invalid_state");
});

test("execution must match the reviewed trade", () => {
  const i = mk(noAck);
  assert.equal(code(() => assertExecutable(i, { ...req, walletAddress: "X" }, now)), "forbidden");
  assert.equal(code(() => assertExecutable(i, { ...req, mint: "N" }, now)), "mismatch");
  assert.equal(code(() => assertExecutable(i, { ...req, side: "buy" }, now)), "mismatch");
  assert.equal(code(() => assertExecutable(i, { ...req, mode: "paper" }, now)), "mismatch");
  assert.equal(code(() => assertExecutable(i, { ...req, amountRaw: 1001n }, now)), "mismatch");
  assert.equal(code(() => assertExecutable(i, { ...req, amountRaw: 500n }, now)), undefined);
  assert.equal(code(() => assertExecutable(i, { ...req, amountRaw: 0n }, now)), "invalid_amount");
});

test("zero amount intents are rejected", () => {
  assert.equal(
    code(() => createIntent({ id: "x", walletAddress: "W", mode: "paper", side: "sell", mint: "M", amountRaw: 0n, thesisId: null, evaluation: null, now })),
    "invalid_amount",
  );
});
