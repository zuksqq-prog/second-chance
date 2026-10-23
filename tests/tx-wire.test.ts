import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { bytesEqual, isZero, parseWireTx, readCompactU16 } from "../src/lib/domain/tx-wire";

const key = (b: number) => new Uint8Array(32).fill(b);

/** Build a minimal transaction: [sigCount][sigs][message]. */
function buildTx(opts: { v0: boolean; payer: Uint8Array; others?: Uint8Array[]; signed?: boolean; sigCount?: number }) {
  const keys = [opts.payer, ...(opts.others ?? [key(9)])];
  const header = [1, 0, 1];
  const msg = [
    ...(opts.v0 ? [0x80] : []),
    ...header,
    keys.length,
    ...keys.flatMap((k) => [...k]),
    ...new Array(32).fill(7), // recent blockhash
    0, // 0 instructions
    ...(opts.v0 ? [0] : []), // 0 address table lookups
  ];
  const n = opts.sigCount ?? 1;
  const sigs = Array.from({ length: n }, () => new Array(64).fill(opts.signed ? 5 : 0));
  return Uint8Array.from([n, ...sigs.flat(), ...msg]);
}

test("compact-u16 decoding", () => {
  assert.deepEqual(readCompactU16(Uint8Array.from([0x05]), 0), { value: 5, size: 1 });
  assert.deepEqual(readCompactU16(Uint8Array.from([0x80, 0x01]), 0), { value: 128, size: 2 });
  assert.deepEqual(readCompactU16(Uint8Array.from([0xff, 0xff, 0x03]), 0), { value: 65535, size: 3 });
  assert.throws(() => readCompactU16(Uint8Array.from([0x80]), 0));
});

test("parses legacy and v0 transactions; fee payer is first key", () => {
  for (const v0 of [false, true]) {
    const tx = parseWireTx(buildTx({ v0, payer: key(1) }));
    assert.equal(tx.version, v0 ? 0 : "legacy");
    assert.ok(bytesEqual(tx.staticAccountKeys[0], key(1)));
    assert.equal(tx.staticAccountKeys.length, 2);
    assert.ok(isZero(tx.signatures[0]));
  }
});

test("signing changes signatures but not the message hash", () => {
  const unsigned = parseWireTx(buildTx({ v0: true, payer: key(1) }));
  const signed = parseWireTx(buildTx({ v0: true, payer: key(1), signed: true }));
  const h = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
  assert.equal(h(unsigned.message), h(signed.message));
  assert.ok(!isZero(signed.signatures[0]));
});

test("a different transaction has a different message hash", () => {
  const a = parseWireTx(buildTx({ v0: true, payer: key(1) }));
  const b = parseWireTx(buildTx({ v0: true, payer: key(1), others: [key(8)] }));
  assert.ok(!bytesEqual(a.message, b.message));
});

test("rejects malformed input", () => {
  assert.throws(() => parseWireTx(Uint8Array.from([])));
  assert.throws(() => parseWireTx(Uint8Array.from([0])), /signature count/);
  assert.throws(() => parseWireTx(buildTx({ v0: true, payer: key(1) }).slice(0, 80)));
  assert.throws(() => parseWireTx(buildTx({ v0: true, payer: key(1), sigCount: 2 })), /header/);
  const bad = buildTx({ v0: true, payer: key(1) });
  bad[65] = 0x81; // version 1
  assert.throws(() => parseWireTx(bad), /Unsupported/);
});
