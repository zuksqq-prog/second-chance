import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyTrade,
  buildPositions,
  costBasisStatus,
  emptyPosition,
  percentOf,
  reconcile,
  toRaw,
  valuePosition,
  type LedgerTrade,
} from "../src/lib/domain/portfolio";

const SOL = 1_000_000_000n;
let n = 0;
const tr = (side: "buy" | "sell", tokens: bigint, sol: bigint, fee = 0n, platform = 0n): LedgerTrade => ({
  id: String(++n),
  mint: "M",
  side,
  tokenAmountRaw: tokens,
  solAmountLamports: sol,
  networkFeeLamports: fee,
  platformFeeLamports: platform,
  timestamp: new Date(1_700_000_000_000 + n * 1000),
});

test("buy then full sell realizes PnL net of fees", () => {
  let p = emptyPosition("M");
  p = applyTrade(p, tr("buy", 1000n, 1n * SOL, 10_000n));
  assert.equal(p.knownCostLamports, SOL + 10_000n);
  p = applyTrade(p, tr("sell", 1000n, 2n * SOL, 10_000n));
  assert.equal(p.knownQtyRaw, 0n);
  assert.equal(p.knownCostLamports, 0n);
  assert.equal(p.realizedPnlLamports, SOL - 20_000n);
  assert.equal(p.totalFeesLamports, 20_000n);
  assert.equal(costBasisStatus(p), "none");
});

test("average cost across two buys, partial sell keeps remaining basis", () => {
  let p = emptyPosition("M");
  p = applyTrade(p, tr("buy", 1000n, 1n * SOL));
  p = applyTrade(p, tr("buy", 1000n, 3n * SOL));
  // avg = 2 SOL per 1000
  p = applyTrade(p, tr("sell", 500n, 2n * SOL));
  assert.equal(p.knownQtyRaw, 1500n);
  assert.equal(p.knownCostLamports, 3n * SOL);
  assert.equal(p.realizedPnlLamports, 1n * SOL);
});

test("cannot sell more than tracked", () => {
  const p = applyTrade(emptyPosition("M"), tr("buy", 10n, SOL));
  assert.throws(() => applyTrade(p, tr("sell", 11n, SOL)), /exceeds/);
});

test("external deposits are unknown basis; sells split pro-rata", () => {
  let p = applyTrade(emptyPosition("M"), tr("buy", 1000n, 1n * SOL));
  const r = reconcile(p, 2000n);
  assert.equal(r.adjustmentRaw, 1000n);
  p = r.position;
  assert.equal(costBasisStatus(p), "partial");
  p = applyTrade(p, tr("sell", 1000n, 2n * SOL));
  // half known (500 @ 1 SOL/1000 = 0.5 SOL cost, proceeds 1 SOL) → +0.5 SOL realized
  assert.equal(p.realizedPnlLamports, SOL / 2n);
  assert.equal(p.unknownBasisProceedsLamports, 1n * SOL);
  assert.equal(p.knownQtyRaw, 500n);
  assert.equal(p.unknownQtyRaw, 500n);
});

test("external removals take unknown first, then known with cost", () => {
  let p = applyTrade(emptyPosition("M"), tr("buy", 1000n, 1n * SOL));
  p = reconcile(p, 1500n).position; // +500 unknown
  p = reconcile(p, 800n).position; // -700: 500 unknown, 200 known
  assert.equal(p.unknownQtyRaw, 0n);
  assert.equal(p.knownQtyRaw, 800n);
  assert.equal(p.knownCostLamports, (SOL * 800n) / 1000n);
  assert.equal(p.realizedPnlLamports, 0n);
  assert.equal(costBasisStatus(p), "verified");
});

test("fully unknown position is labelled unknown and has no unrealized PnL", () => {
  const p = reconcile(emptyPosition("M"), 5_000_000n).position;
  assert.equal(costBasisStatus(p), "unknown");
  const v = valuePosition(p, 6, 0.001);
  assert.equal(v.unrealizedPnlSol, null);
  assert.equal(v.avgEntryPriceSol, null);
  assert.ok(Math.abs((v.marketValueSol ?? 0) - 0.005) < 1e-12);
});

test("valuation: unrealized PnL on known bucket", () => {
  const p = applyTrade(emptyPosition("M"), tr("buy", 2_000_000n, SOL)); // 2 tokens (6 dp) for 1 SOL
  const v = valuePosition(p, 6, 0.75);
  assert.equal(v.avgEntryPriceSol, 0.5);
  assert.equal(v.marketValueSol, 1.5);
  assert.equal(v.unrealizedPnlSol, 0.5);
  assert.equal(v.unrealizedPnlPct, 50);
  assert.equal(valuePosition(p, 6, null).unrealizedPnlSol, null);
});

test("buildPositions sorts by time and groups by mint", () => {
  const a = tr("buy", 100n, SOL);
  const b = { ...tr("buy", 50n, SOL), mint: "N" };
  const c = tr("sell", 100n, 2n * SOL);
  const m = buildPositions([c, b, a]);
  assert.equal(m.get("M")?.realizedPnlLamports, SOL);
  assert.equal(m.get("N")?.knownQtyRaw, 50n);
});

test("toRaw is exact; percentOf rounds down and 100% is exact", () => {
  assert.equal(toRaw("0.1", 9), 100_000_000n);
  assert.equal(toRaw("0.25", 9), 250_000_000n);
  assert.equal(toRaw("1", 6), 1_000_000n);
  assert.equal(toRaw("1.1234567", 6), 1_123_456n);
  assert.throws(() => toRaw("-1", 9));
  assert.throws(() => toRaw("1e5", 9));
  assert.equal(percentOf(1001n, 25), 250n);
  assert.equal(percentOf(1001n, 100), 1001n);
  assert.throws(() => percentOf(10n, 0));
  assert.throws(() => percentOf(10n, 101));
});
