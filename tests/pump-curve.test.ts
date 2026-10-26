import { test } from "node:test";
import assert from "node:assert/strict";
import { bondingProgress, curvePriceSol, INITIAL_REAL_TOKEN_RESERVES, parseBondingCurve, quoteCurveBuy, quoteCurveSell } from "../src/lib/domain/pump-curve";

function encode(c: { vT: bigint; vS: bigint; rT: bigint; rS: bigint; supply: bigint; complete: boolean; creator?: Uint8Array }): Uint8Array {
  const b = new Uint8Array(81);
  b.set([0x17, 0xb7, 0xf8, 0x37, 0x60, 0xd8, 0xac, 0x60]); // discriminator (value irrelevant to parsing)
  const put = (o: number, v: bigint) => {
    for (let i = 0; i < 8; i++) b[o + i] = Number((v >> BigInt(8 * i)) & 0xffn);
  };
  put(8, c.vT);
  put(16, c.vS);
  put(24, c.rT);
  put(32, c.rS);
  put(40, c.supply);
  b[48] = c.complete ? 1 : 0;
  if (c.creator) b.set(c.creator, 49);
  return b;
}

// Fresh pump.fun curve parameters.
const fresh = { vT: 1_073_000_000_000_000n, vS: 30_000_000_000n, rT: INITIAL_REAL_TOKEN_RESERVES, rS: 0n, supply: 1_000_000_000_000_000n, complete: false };

test("parses a fresh curve: 0% bonded, ~28 lamport-SOL price", () => {
  const c = parseBondingCurve(encode(fresh))!;
  assert.equal(c.virtualTokenReserves, fresh.vT);
  assert.equal(c.realTokenReserves, INITIAL_REAL_TOKEN_RESERVES);
  assert.equal(bondingProgress(c), 0);
  assert.ok(Math.abs(curvePriceSol(c) - 30 / 1_073_000_000) < 1e-15);
});

test("progress halfway and complete", () => {
  const half = parseBondingCurve(encode({ ...fresh, rT: INITIAL_REAL_TOKEN_RESERVES / 2n }))!;
  assert.equal(bondingProgress(half), 50);
  const done = parseBondingCurve(encode({ ...fresh, rT: 0n, complete: true }))!;
  assert.equal(bondingProgress(done), 100);
  assert.equal(done.complete, true);
});

test("rejects short or nonsense data", () => {
  assert.equal(parseBondingCurve(new Uint8Array(20)), null);
  assert.equal(parseBondingCurve(encode({ ...fresh, vT: 0n })), null);
  assert.equal(parseBondingCurve(encode({ ...fresh, rT: fresh.vT + 1n })), null);
});

test("buy then sell round-trips below cost (fees + impact)", () => {
  const c = parseBondingCurve(encode(fresh))!;
  const buy = quoteCurveBuy(c, 1_000_000_000n); // 1 SOL
  assert.ok(buy.ok);
  assert.equal(buy.feeLamports, 12_500_000n);
  // ~34.3M tokens for ~0.9875 SOL on a fresh curve
  assert.ok(buy.tokenAmountRaw > 34_000_000_000_000n && buy.tokenAmountRaw < 35_000_000_000_000n);
  assert.ok(buy.priceImpactPct > 0);
  const after = { ...c, virtualTokenReserves: c.virtualTokenReserves - buy.tokenAmountRaw, virtualSolReserves: c.virtualSolReserves + buy.solAmountLamports, realTokenReserves: c.realTokenReserves - buy.tokenAmountRaw, realSolReserves: buy.solAmountLamports };
  const sell = quoteCurveSell(after, buy.tokenAmountRaw);
  assert.ok(sell.ok);
  assert.ok(sell.solAmountLamports - sell.feeLamports < 1_000_000_000n);
});

test("completed curve refuses quotes", () => {
  const done = parseBondingCurve(encode({ ...fresh, rT: 0n, complete: true }))!;
  assert.equal(quoteCurveBuy(done, 1n).ok, false);
  assert.equal(quoteCurveSell(done, 1n).ok, false);
});

test("buy is capped by remaining real tokens", () => {
  const c = parseBondingCurve(encode({ ...fresh, rT: 1_000_000n }))!;
  const q = quoteCurveBuy(c, 50_000_000_000n);
  assert.equal(q.tokenAmountRaw, 1_000_000n);
});

test("reads the creator (dev) wallet when present", async () => {
  const { base58Decode } = await import("../src/lib/domain/base58");
  const dev = "HsDCUYeuf6eM92nwDjeciHZvjYZwosQn7KAct1g6vGyd";
  const c = parseBondingCurve(encode({ ...fresh, creator: base58Decode(dev) }))!;
  assert.equal(c.creator, dev);
  assert.equal(parseBondingCurve(encode(fresh))!.creator, null);
});
