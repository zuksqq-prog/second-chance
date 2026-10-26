import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeTrades, parseGeckoTrades, positionCycle, sellInitialFraction, topTraders } from "../src/lib/domain/live-trades";

const MINT = "6GmAFSYs4gk3FDao5FzzySQpPZaWsa4rUJHacpMpUNgx";
const SOL = "So11111111111111111111111111111111111111112";
const POOL = "AfrddTGYwCVEQB1gxCAhR8i48o6qtxYqksdVkeLudEhg";
const TRADER = "HsDCUYeuf6eM92nwDjeciHZvjYZwosQn7KAct1g6vGyd";
const TX = "2wkiEBsWW3qifJj5xq8gWzHcdDbCfcPHECiEgbU2Qap3D4vti6h9wKtVPscXPbasuNHSarRUGPhyR9M13MocTdXt";

// Shape copied from a live GeckoTerminal response (Oct 26, 2026).
const buyRow = {
  id: "solana_461562753_x_111_1792996198",
  type: "trade",
  attributes: {
    block_number: 461562753,
    block_timestamp: "2026-10-26T06:29:51Z",
    tx_hash: TX,
    tx_from_address: TRADER,
    kind: "buy",
    from_token_address: SOL,
    to_token_address: MINT,
    from_token_amount: "0.1089",
    to_token_amount: "83.943474998",
    price_from_in_usd: "100.84",
    price_to_in_usd: "0.13082791",
    price_from_in_currency_token: "1.0",
    price_to_in_currency_token: "0.00129",
    volume_in_usd: "10.98",
    is_anomalous: false,
  },
};
const sellRow = {
  id: "solana_461562748_y_70_1792996196",
  attributes: {
    ...buyRow.attributes,
    block_number: 461562748,
    block_timestamp: "2026-10-26T06:29:49Z",
    kind: "sell",
    from_token_address: MINT,
    to_token_address: SOL,
    from_token_amount: "50",
    to_token_amount: "0.0648",
    price_from_in_usd: "0.1307",
    price_to_in_usd: "100.84",
    volume_in_usd: "6.54",
  },
};

test("parses buys and sells by token address, with MC from supply", () => {
  const t = parseGeckoTrades({ data: [buyRow, sellRow] }, MINT, POOL, 1_000_000_000);
  assert.equal(t.length, 2);
  assert.equal(t[0].kind, "buy");
  assert.equal(t[0].tokenAmount, 83.943474998);
  assert.equal(t[0].priceUsd, 0.13082791);
  assert.ok(Math.abs((t[0].marketCap ?? 0) - 130_827_910) < 1);
  assert.equal(t[0].trader, TRADER);
  assert.equal(t[1].kind, "sell");
  assert.equal(t[1].tokenAmount, 50);
  assert.equal(t[1].priceUsd, 0.1307);
});

test("drops anomalous, foreign-token, malformed rows", () => {
  const bad = [
    { ...buyRow, attributes: { ...buyRow.attributes, is_anomalous: true } },
    { ...buyRow, attributes: { ...buyRow.attributes, to_token_address: SOL } },
    { ...buyRow, attributes: { ...buyRow.attributes, to_token_amount: "NaN" } },
    { ...buyRow, attributes: { ...buyRow.attributes, tx_hash: "<script>" } },
    { ...buyRow, attributes: { ...buyRow.attributes, block_timestamp: "nope" } },
    null,
  ];
  assert.equal(parseGeckoTrades({ data: bad }, MINT, POOL, null).length, 0);
  assert.equal(parseGeckoTrades(null, MINT, POOL, null).length, 0);
  assert.equal(parseGeckoTrades({ data: [buyRow] }, MINT, POOL, null)[0].marketCap, null);
});

test("merge de-dupes and sorts newest first", () => {
  const a = parseGeckoTrades({ data: [buyRow, sellRow] }, MINT, POOL, null);
  const merged = mergeTrades([a, a]);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].kind, "buy");
});

test("top traders aggregate by wallet", () => {
  const a = parseGeckoTrades({ data: [buyRow, sellRow] }, MINT, POOL, null);
  const [s] = topTraders(a);
  assert.equal(s.trader, TRADER);
  assert.equal(s.buys, 1);
  assert.equal(s.sells, 1);
  assert.ok(Math.abs(s.netUsd - (6.54 - 10.98)) < 1e-9);
});

test("position cycle: open, closed, and re-entry", () => {
  assert.equal(positionCycle([]).state, "none");
  const open = positionCycle([
    { side: "buy", tokenAmountRaw: 100n, usd: 40, timestamp: 1 },
    { side: "sell", tokenAmountRaw: 40n, usd: 30, timestamp: 2 },
  ]);
  assert.deepEqual(open, { state: "open", boughtUsd: 40, soldUsd: 30 });
  const closed = positionCycle([
    { side: "buy", tokenAmountRaw: 100n, usd: 40, timestamp: 1 },
    { side: "sell", tokenAmountRaw: 100n, usd: 55, timestamp: 2 },
  ]);
  assert.deepEqual(closed, { state: "closed", boughtUsd: 40, soldUsd: 55 });
  const reentered = positionCycle([
    { side: "buy", tokenAmountRaw: 100n, usd: 40, timestamp: 1 },
    { side: "sell", tokenAmountRaw: 100n, usd: 55, timestamp: 2 },
    { side: "buy", tokenAmountRaw: 10n, usd: 5, timestamp: 3 },
  ]);
  assert.deepEqual(reentered, { state: "open", boughtUsd: 5, soldUsd: 0 });
});

test("sell init fraction", () => {
  assert.equal(sellInitialFraction(40, 80), 0.5);
  assert.equal(sellInitialFraction(40, 20), 1);
  assert.equal(sellInitialFraction(0, 20), null);
  assert.equal(sellInitialFraction(10, 0), null);
});
