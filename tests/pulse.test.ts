import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyPulse, pulseItemFromGecko, type PulseItem } from "../src/lib/domain/pulse";

const SOL = "So11111111111111111111111111111111111111112";

// Shape copied from a live GeckoTerminal new_pools response (Oct 26, 2026).
function pool(mint: string, poolAddr: string, dex: string, createdIso: string) {
  return {
    id: `solana_${poolAddr}`,
    type: "pool",
    attributes: {
      base_token_price_usd: "0.00000281614",
      base_token_price_quote_token: "0.00000002796266345",
      address: poolAddr,
      name: "wrthbuy / SOL",
      pool_created_at: createdIso,
      fdv_usd: "2816.140219",
      market_cap_usd: null,
      price_change_percentage: { m5: "4.5", h1: "4.5", h6: "4.5", h24: "4.5" },
      transactions: { h1: { buys: 2, sells: 1, buyers: 2, sellers: 1 }, h24: { buys: 14, sells: 6, buyers: 14, sellers: 5 } },
      volume_usd: { m5: "118.67", h1: "118.67", h6: "118.67", h24: "1022.74" },
      reserve_in_usd: "2401.99",
    },
    relationships: {
      base_token: { data: { id: `solana_${mint}`, type: "token" } },
      quote_token: { data: { id: `solana_${SOL}`, type: "token" } },
      dex: { data: { id: dex, type: "dex" } },
    },
  };
}
const included = (mint: string, sym: string) => [{ id: `solana_${mint}`, type: "token", attributes: { address: mint, name: sym, symbol: sym, image_url: "missing.png" } }];

const M1 = "3uqzoJn3zzWUKfSsd3Nn61nbwkPUiajZvVTWdHWopump";
const P1 = "9xMZdUPkTeF8woF2gi6QLqxfd91ts3qHDm9S8nhxzeU8";
const M2 = "DprqGDR9ibkSgYjowLNRqHKMXfjHp4Fz4eZr7C4vpump";
const P2 = "75BZfZRgScRZzM99zAzMNtzjZ3NLFuoJ8fpWGzSn328f";
const M3 = "44pseyL2LmzmHaqHS9txTid3NbJvQSmNsXHHdjGgpump";
const P3 = "ABkUjUiwFVRtDuDWod9Vyn8v3hEUiGmVCiDU5bP9oUzE";

test("builds a pulse item from a GeckoTerminal pool", () => {
  const it = pulseItemFromGecko(pool(M1, P1, "pump-fun", "2026-10-26T06:43:01Z"), included(M1, "WRTH"), 1)!;
  assert.equal(it.mint, M1);
  assert.equal(it.dex, "pump-fun");
  assert.equal(it.dexLabel, "Pump");
  assert.equal(it.symbol, "WRTH");
  assert.equal(it.marketCap, 2816.140219);
  assert.equal(it.marketCapIsFdv, true);
  assert.equal(it.buyers1h, 2);
  assert.equal(it.buys24h, 14);
  assert.equal(it.imageUrl, null);
  assert.equal(pulseItemFromGecko({ ...pool(M1, P1, "bad dex!", "2026-10-26T06:43:01Z") }, included(M1, "X"), 1), null);
});

test("classifies into New Pairs, Final Stretch, Migrated", () => {
  const now = Date.parse("2026-10-26T07:00:00Z");
  const fresh = { ...pulseItemFromGecko(pool(M1, P1, "pump-fun", "2026-10-26T06:43:01Z"), included(M1, "A"), now)!, bondingProgress: 3 };
  const close = { ...pulseItemFromGecko(pool(M2, P2, "pump-fun", "2026-10-26T06:00:00Z"), included(M2, "B"), now)!, bondingProgress: 88 };
  const migrated = pulseItemFromGecko(pool(M3, P3, "pumpswap", "2026-10-26T06:42:55Z"), included(M3, "C"), now)!;
  const oldMigration = { ...migrated, mint: "old", pairCreatedAt: now - 30 * 3600_000 } as PulseItem;
  const cols = classifyPulse([fresh, close], [close], [migrated, oldMigration], now);
  assert.deepEqual(cols.newPairs.map((t) => t.symbol), ["A"]);
  assert.deepEqual(cols.finalStretch.map((t) => t.symbol), ["B"]);
  assert.deepEqual(cols.migrated.map((t) => t.symbol), ["C"]);
});

test("completed curves leave New Pairs and Final Stretch", () => {
  const now = Date.parse("2026-10-26T07:00:00Z");
  const done = { ...pulseItemFromGecko(pool(M2, P2, "pump-fun", "2026-10-26T06:00:00Z"), included(M2, "B"), now)!, bondingProgress: 100 };
  const cols = classifyPulse([done], [done], [], now);
  assert.equal(cols.newPairs.length, 0);
  assert.equal(cols.finalStretch.length, 0);
});
