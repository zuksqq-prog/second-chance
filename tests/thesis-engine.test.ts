import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateSell,
  progressTowardTarget,
  reviseThesis,
  sellPercentOfOriginal,
  validateThesisContent,
} from "../src/lib/domain/thesis-engine";
import type { Thesis, ThesisContent } from "../src/lib/domain/types";

const now = new Date("2026-10-22T12:00:00Z");
const fresh = new Date(now.getTime() - 5_000);

function thesis(over: Partial<Thesis> = {}): Thesis {
  const content: ThesisContent = {
    reason: "I believe this narrative has room to run. I'm holding until $10M unless the fundamentals change.",
    targetMarketCap: 10_000_000,
    holdingPeriod: "2 weeks",
    invalidation: "Dev sells or liquidity pulled",
    plannedExits: [],
    notes: null,
  };
  return {
    id: "t1",
    walletAddress: "W",
    mint: "M",
    mode: "paper",
    entryMarketCap: 1_000_000,
    originalPositionRaw: 1_000_000n,
    plannedExitSoldPercent: 0,
    status: "active",
    createdAt: now,
    original: content,
    revisionCount: 0,
    ...content,
    ...over,
  };
}

const base = { now, marketDataObservedAt: fresh, positionRaw: 1_000_000n };

test("no thesis → no reminder", () => {
  const r = evaluateSell({ ...base, thesis: null, currentMarketCap: 4_200_000, sellAmountRaw: 500_000n });
  assert.equal(r.verdict, "no_thesis");
  assert.equal(r.requiresAcknowledgement, false);
});

test("closed thesis → no reminder", () => {
  const r = evaluateSell({ ...base, thesis: thesis({ status: "closed" }), currentMarketCap: 1, sellAmountRaw: 1n });
  assert.equal(r.verdict, "no_thesis");
});

test("selling at $4.2M with a $10M target requires acknowledgement", () => {
  const r = evaluateSell({ ...base, thesis: thesis(), currentMarketCap: 4_200_000, sellAmountRaw: 1_000_000n });
  assert.equal(r.verdict, "below_target");
  assert.equal(r.requiresAcknowledgement, true);
  assert.equal(r.targetMarketCap, 10_000_000);
  assert.equal(r.sellPercentOfOriginal, 100);
  // progress from 1M entry to 10M target at 4.2M = 3.2/9
  assert.ok(Math.abs((r.progress ?? 0) - 3.2 / 9) < 1e-9);
});

test("at or above target → sell freely", () => {
  for (const mc of [10_000_000, 25_000_000]) {
    const r = evaluateSell({ ...base, thesis: thesis(), currentMarketCap: mc, sellAmountRaw: 1_000_000n });
    assert.equal(r.verdict, "at_or_above_target");
    assert.equal(r.requiresAcknowledgement, false);
  }
});

test("market data unavailable → reminder shown with note, still allowed", () => {
  const r = evaluateSell({ ...base, thesis: thesis(), currentMarketCap: null, sellAmountRaw: 10n });
  assert.equal(r.verdict, "market_data_unavailable");
  assert.equal(r.requiresAcknowledgement, true);
  assert.match(r.marketDataNote ?? "", /unavailable/);
});

test("stale market data is treated as unavailable", () => {
  const r = evaluateSell({
    ...base,
    thesis: thesis(),
    currentMarketCap: 20_000_000,
    marketDataObservedAt: new Date(now.getTime() - 120_000),
    sellAmountRaw: 10n,
  });
  assert.equal(r.verdict, "market_data_unavailable");
  assert.match(r.marketDataNote ?? "", /stale/);
  assert.equal(r.currentMarketCap, 20_000_000);
});

test("NaN / zero market cap is unavailable", () => {
  for (const mc of [NaN, 0, -5]) {
    const r = evaluateSell({ ...base, thesis: thesis(), currentMarketCap: mc, sellAmountRaw: 10n });
    assert.equal(r.verdict, "market_data_unavailable");
  }
});

test("planned partial exit within allowance passes without reminder", () => {
  const t = thesis({ plannedExits: [{ id: "e1", atMarketCap: 4_000_000, sellPercent: 25 }] });
  const r = evaluateSell({ ...base, thesis: t, currentMarketCap: 4_200_000, sellAmountRaw: 250_000n });
  assert.equal(r.verdict, "planned_exit");
  assert.equal(r.requiresAcknowledgement, false);
  assert.equal(r.matchedExit?.id, "e1");
});

test("selling more than the planned exit allows triggers reminder", () => {
  const t = thesis({ plannedExits: [{ id: "e1", atMarketCap: 4_000_000, sellPercent: 25 }] });
  const r = evaluateSell({ ...base, thesis: t, currentMarketCap: 4_200_000, sellAmountRaw: 500_000n });
  assert.equal(r.verdict, "below_target");
  assert.equal(r.plannedAllowancePercent, 25);
});

test("exit level not yet reached triggers reminder", () => {
  const t = thesis({ plannedExits: [{ id: "e1", atMarketCap: 5_000_000, sellPercent: 25 }] });
  const r = evaluateSell({ ...base, thesis: t, currentMarketCap: 4_200_000, sellAmountRaw: 250_000n });
  assert.equal(r.verdict, "below_target");
});

test("exit tolerance: 3% below the level still counts as reached", () => {
  const t = thesis({ plannedExits: [{ id: "e1", atMarketCap: 4_300_000, sellPercent: 25 }] });
  const r = evaluateSell({ ...base, thesis: t, currentMarketCap: 4_200_000, sellAmountRaw: 250_000n });
  assert.equal(r.verdict, "planned_exit");
});

test("already-used allowance is subtracted", () => {
  const t = thesis({
    plannedExits: [
      { id: "e1", atMarketCap: 3_000_000, sellPercent: 20 },
      { id: "e2", atMarketCap: 4_000_000, sellPercent: 20 },
    ],
    plannedExitSoldPercent: 20,
  });
  // 40% reached, 20% used → 20% left
  const ok = evaluateSell({ ...base, thesis: t, currentMarketCap: 4_100_000, sellAmountRaw: 200_000n, positionRaw: 800_000n });
  assert.equal(ok.verdict, "planned_exit");
  assert.equal(ok.matchedExit?.id, "e2");
  const over = evaluateSell({ ...base, thesis: t, currentMarketCap: 4_100_000, sellAmountRaw: 300_000n, positionRaw: 800_000n });
  assert.equal(over.verdict, "below_target");
});

test("sell percent uses original position, falling back to current position", () => {
  assert.equal(sellPercentOfOriginal(250n, 1000n, 500n), 25);
  assert.equal(sellPercentOfOriginal(250n, null, 500n), 50);
  assert.equal(sellPercentOfOriginal(1n, null, 0n), null);
  // huge raw amounts stay precise
  assert.equal(sellPercentOfOriginal(123_456_789_000_000_000n, 493_827_156_000_000_000n, 1n), 25);
});

test("progress handles missing entry and clamps", () => {
  assert.equal(progressTowardTarget(null, 5, 10), 0.5);
  assert.equal(progressTowardTarget(2, 1, 10), 0);
  assert.equal(progressTowardTarget(2, 20, 10), 1);
  assert.equal(progressTowardTarget(2, null, 10), null);
});

test("revisions never mutate the original and require a reason", () => {
  const t = thesis();
  const before = JSON.stringify(t.original);
  const { next, changed } = reviseThesis(t, { targetMarketCap: 6_000_000 }, "Market turned; lowering target");
  assert.equal(next.targetMarketCap, 6_000_000);
  assert.deepEqual(changed, ["targetMarketCap"]);
  assert.equal(JSON.stringify(t.original), before);
  assert.throws(() => reviseThesis(t, { targetMarketCap: 6_000_000 }, "  "), /reason/);
  assert.throws(() => reviseThesis(t, { targetMarketCap: t.targetMarketCap }, "x"), /No changes/);
});

test("validation rejects bad theses", () => {
  const ok: ThesisContent = { reason: "Strong community", targetMarketCap: 1e7, holdingPeriod: null, invalidation: null, plannedExits: [], notes: null };
  validateThesisContent(ok);
  assert.throws(() => validateThesisContent({ ...ok, reason: "" }));
  assert.throws(() => validateThesisContent({ ...ok, targetMarketCap: -1 }));
  assert.throws(() => validateThesisContent({ ...ok, targetMarketCap: Infinity }));
  assert.throws(() =>
    validateThesisContent({
      ...ok,
      plannedExits: [
        { id: "a", atMarketCap: 1e6, sellPercent: 60 },
        { id: "b", atMarketCap: 2e6, sellPercent: 50 },
      ],
    }),
  );
});
