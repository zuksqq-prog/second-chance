import { test } from "node:test";
import assert from "node:assert/strict";
import { countActive, emptyFilter, matchesFilter, parseNum, sanitizeFilter } from "../src/lib/domain/pulse-filters";
import type { PulseItem } from "../src/lib/domain/pulse";

const now = Date.parse("2026-10-26T07:00:00Z");
function item(over: Partial<PulseItem> & Record<string, unknown> = {}) {
  return {
    mint: "M",
    name: "Never Kill Yourself",
    symbol: "NEVER",
    imageUrl: null,
    pairAddress: "P",
    dexId: "pump-fun",
    quoteSymbol: "SOL",
    priceUsd: 0.00001,
    priceSol: 1e-7,
    marketCap: 25_000,
    marketCapIsFdv: true,
    fdv: 25_000,
    liquidityUsd: 9_000,
    volume: { m5: 1, h1: 1, h6: 1, h24: 35_000 },
    priceChange: { m5: 1, h1: 1, h6: 1, h24: 1 },
    txns24h: { buys: 100, sells: 50 },
    txns1h: { buys: 10, sells: 5 },
    pairCreatedAt: now - 19 * 60_000,
    links: [],
    source: "geckoterminal" as const,
    observedAt: now,
    dex: "pump-fun",
    dexLabel: "Pump",
    buyers1h: 40,
    sellers1h: 20,
    buys24h: 600,
    sells24h: 359,
    bondingProgress: 62,
    quote: "SOL" as const,
    socials: { twitter: "robtmb1", website: null, telegram: null, dexPaid: true },
    ...over,
  } as PulseItem & { quote: "SOL"; socials: { twitter: string | null; website: string | null; telegram: string | null; dexPaid: boolean } };
}

test("shorthand numbers", () => {
  assert.equal(parseNum("6k"), 6000);
  assert.equal(parseNum("$1.5M"), 1_500_000);
  assert.equal(parseNum(""), null);
  assert.equal(parseNum("abc"), null);
});

test("empty filter passes everything", () => {
  assert.ok(matchesFilter(item(), emptyFilter(), now));
  assert.equal(countActive(emptyFilter()).total, 0);
});

test("keywords and exclusions", () => {
  const f = { ...emptyFilter(), keywords: ["never"] };
  assert.ok(matchesFilter(item(), f, now));
  assert.ok(!matchesFilter(item({ symbol: "CAT", name: "cat" }), f, now));
  assert.ok(!matchesFilter(item(), { ...emptyFilter(), exclude: ["kill"] }, now));
});

test("protocols and quotes", () => {
  assert.ok(matchesFilter(item(), { ...emptyFilter(), protocols: ["pump-fun"] }, now));
  assert.ok(!matchesFilter(item(), { ...emptyFilter(), protocols: ["pumpswap"] }, now));
  assert.ok(!matchesFilter(item(), { ...emptyFilter(), quotes: ["USDC"] }, now));
});

test("metrics ranges incl. Axiom-style defaults", () => {
  const f = { ...emptyFilter(), volume: { min: "3000", max: "" }, marketCap: { min: "6000", max: "60000" }, txns: { min: "5", max: "" } };
  assert.ok(matchesFilter(item(), f, now));
  assert.ok(!matchesFilter(item({ marketCap: 70_000 }), f, now));
  assert.ok(!matchesFilter(item({ marketCap: null }), f, now), "unknown value fails an active range");
  assert.ok(!matchesFilter(item(), { ...emptyFilter(), bcurve: { min: "80", max: "" } }, now));
  assert.equal(countActive(f).metrics, 3);
});

test("age with units", () => {
  assert.ok(matchesFilter(item(), { ...emptyFilter(), age: { min: "", minUnit: "m", max: "20", maxUnit: "m" } }, now));
  assert.ok(!matchesFilter(item(), { ...emptyFilter(), age: { min: "", minUnit: "m", max: "10", maxUnit: "m" } }, now));
  assert.ok(matchesFilter(item(), { ...emptyFilter(), age: { min: "", minUnit: "m", max: "1", maxUnit: "h" } }, now));
});

test("socials", () => {
  const s = (k: keyof ReturnType<typeof emptyFilter>["socials"]) => ({ ...emptyFilter(), socials: { ...emptyFilter().socials, [k]: true } });
  assert.ok(matchesFilter(item(), s("twitter"), now));
  assert.ok(matchesFilter(item(), s("dexPaid"), now));
  assert.ok(!matchesFilter(item(), s("website"), now));
  assert.ok(matchesFilter(item(), s("atLeastOne"), now));
  assert.ok(!matchesFilter(item({ socials: { twitter: null, website: null, telegram: null, dexPaid: false } }), s("atLeastOne"), now));
});

test("imported filters are sanitised", () => {
  const f = sanitizeFilter({ keywords: ["a", 5, "b"], protocols: ["pump-fun", "evil"], quotes: ["SOL", "BTC"], marketCap: { min: "6k", max: "<script>" }, socials: { twitter: "yes", website: true } });
  assert.ok(f);
  assert.deepEqual(f!.keywords, ["a", "b"]);
  assert.deepEqual(f!.protocols, ["pump-fun"]);
  assert.deepEqual(f!.quotes, ["SOL"]);
  assert.deepEqual(f!.marketCap, { min: "6k", max: "" });
  assert.equal(f!.socials.twitter, false);
  assert.equal(f!.socials.website, true);
  assert.equal(sanitizeFilter("nope"), null);
});
