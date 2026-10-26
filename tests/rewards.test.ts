import { test } from "node:test";
import assert from "node:assert/strict";
import { cashbackLamports, claimable, dailyCumulative, platformFeeFor, quests } from "../src/lib/domain/rewards";

test("quests: progress, remaining and points", () => {
  const q = quests(0, 0);
  assert.equal(q.points, 0);
  assert.equal(q.volume.label, "Trade 1 more SOL in Volume");
  assert.equal(q.tx.label, "Make 10 more transactions");
  const mid = quests(30, 75);
  // volume tiers 1 and 10 done → 6,000; tx tier 10, 50 done → 2,500
  assert.equal(mid.points, 8_500);
  assert.equal(mid.volume.label, "Trade 20 more SOL in Volume");
  assert.equal(mid.volume.nextPoints, 10_000);
  assert.ok(Math.abs(mid.volume.progress - 0.5) < 1e-9);
  assert.equal(mid.tx.label, "Make 25 more transactions");
  const done = quests(5_000, 10_000);
  assert.equal(done.volume.remaining, 0);
  assert.equal(done.volume.progress, 1);
});

test("cashback and claimable", () => {
  assert.equal(cashbackLamports(1_000_000n, 25), 250_000n);
  assert.equal(cashbackLamports(0n, 25), 0n);
  assert.equal(cashbackLamports(1_000_000n, 0), 0n);
  assert.equal(claimable(250_000n, 100_000n), 150_000n);
  assert.equal(claimable(100n, 200n), 0n);
});

test("platform fee on the SOL leg", () => {
  assert.equal(platformFeeFor(1_000_000_000n, 50), 5_000_000n); // 0.5% of 1 SOL
  assert.equal(platformFeeFor(1_000_000_000n, 0), 0n);
});

test("daily cumulative series", () => {
  const s = dailyCumulative(
    [
      { day: "2026-10-10", lamports: 1_000_000_000n },
      { day: "2026-10-24", lamports: 500_000_000n },
      { day: "2026-10-26", lamports: 250_000_000n },
    ],
    3,
    new Date("2026-10-26T12:00:00Z"),
  );
  assert.deepEqual(s, [
    { day: "2026-10-24", sol: 1.5 },
    { day: "2026-10-25", sol: 1.5 },
    { day: "2026-10-26", sol: 1.75 },
  ]);
});
