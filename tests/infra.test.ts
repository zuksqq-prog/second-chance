import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { TtlCache } from "../src/lib/server/cache";
import { TokenBucketLimiter } from "../src/lib/server/rate-limit";
import {
  base58Decode,
  base58Encode,
  buildSignInMessage,
  signSession,
  verifySession,
  verifySignIn,
} from "../src/lib/server/siws";
import { cleanName, cleanSymbol, isSolanaAddress, safeImageUrl } from "../src/lib/domain/sanitize";
import { compactUsd, parseCompact, tokenPrice } from "../src/lib/domain/format";
import { applyFilter, bestPair, fromDexScreenerPair, parseGeckoOhlcv, WSOL_MINT } from "../src/lib/domain/market";
import { simulatePaperFill } from "../src/lib/domain/paper-fill";

test("cache dedupes concurrent loads and expires", async () => {
  let t = 0;
  const c = new TtlCache(10, () => t);
  let calls = 0;
  const load = async () => ++calls;
  const [a, b] = await Promise.all([c.get("k", 100, load), c.get("k", 100, load)]);
  assert.equal(a, 1);
  assert.equal(b, 1);
  assert.equal(calls, 1);
  t = 101;
  assert.equal(await c.get("k", 100, load), 2);
});

test("cache does not store failures", async () => {
  const c = new TtlCache();
  await assert.rejects(c.get("x", 1000, async () => Promise.reject(new Error("boom"))));
  assert.equal(await c.get("x", 1000, async () => 7), 7);
});

test("token bucket limits and refills", () => {
  let t = 0;
  const l = new TokenBucketLimiter(2, 1, () => t);
  assert.ok(l.take("a").ok);
  assert.ok(l.take("a").ok);
  const r = l.take("a");
  assert.equal(r.ok, false);
  assert.equal(r.retryAfterMs, 1000);
  assert.ok(l.take("b").ok, "keys are independent");
  t = 1000;
  assert.ok(l.take("a").ok);
});

test("base58 round trip incl. leading zeros", () => {
  const bytes = Uint8Array.from([0, 0, 1, 2, 255, 128]);
  assert.deepEqual(base58Decode(base58Encode(bytes)), bytes);
  assert.equal(base58Decode(WSOL_MINT).length, 32);
});

function walletKeypair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const raw = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  return { address: base58Encode(raw), privateKey };
}

test("sign-in verifies a real ed25519 wallet signature", () => {
  const w = walletKeypair();
  const now = new Date("2026-10-22T12:00:00Z");
  const msg = buildSignInMessage({
    domain: "secondchance.app",
    address: w.address,
    nonce: "abc123",
    issuedAt: now.toISOString(),
    expirationTime: new Date(now.getTime() + 600_000).toISOString(),
  });
  const sig = base58Encode(sign(null, Buffer.from(msg), w.privateKey));
  const expected = { domain: "secondchance.app", address: w.address, nonce: "abc123" };
  assert.deepEqual(verifySignIn({ message: msg, signatureB58: sig, expected, now }), { ok: true });
  assert.equal(verifySignIn({ message: msg, signatureB58: sig, expected: { ...expected, nonce: "zzz" }, now }).ok, false);
  assert.equal(verifySignIn({ message: msg + "x", signatureB58: sig, expected, now }).ok, false);
  assert.equal(verifySignIn({ message: msg, signatureB58: sig, expected, now: new Date(now.getTime() + 700_000) }).ok, false);
  const other = walletKeypair();
  assert.equal(verifySignIn({ message: msg, signatureB58: sig, expected: { ...expected, address: other.address }, now }).ok, false);
});

test("session tokens: valid, tampered, expired", () => {
  const tok = signSession({ wallet: "W", exp: 2000 }, "secret-secret-secret-secret-1234");
  assert.deepEqual(verifySession(tok, "secret-secret-secret-secret-1234", 1000), { wallet: "W", exp: 2000 });
  assert.equal(verifySession(tok, "other-secret-other-secret-1234567", 1000), null);
  assert.equal(verifySession(tok, "secret-secret-secret-secret-1234", 3000), null);
  const [body, mac] = tok.split(".");
  const evil = Buffer.from(JSON.stringify({ wallet: "X", exp: 9e15 })).toString("base64url");
  assert.equal(verifySession(`${evil}.${mac}`, "secret-secret-secret-secret-1234", 1000), null);
  assert.equal(verifySession(body, "secret-secret-secret-secret-1234", 1000), null);
  assert.equal(verifySession(undefined, "s", 0), null);
});

test("malicious token metadata is neutralised", () => {
  assert.equal(cleanName("Safe‮token​\u0000"), "Safetoken");
  assert.equal(cleanSymbol(""), "???");
  assert.equal(cleanSymbol("A".repeat(50)).length, 16);
  assert.equal(safeImageUrl("javascript:alert(1)"), null);
  assert.equal(safeImageUrl("http://dd.dexscreener.com/x.png"), null);
  assert.equal(safeImageUrl("https://evil.example/x.png"), null);
  assert.equal(safeImageUrl("https://dd.dexscreener.com/ds-data/tokens/solana/x.png"), "https://dd.dexscreener.com/ds-data/tokens/solana/x.png");
  assert.ok(isSolanaAddress(WSOL_MINT));
  assert.ok(!isSolanaAddress("0xabc"));
  assert.ok(!isSolanaAddress("O0Il".repeat(10)));
});

test("formatting", () => {
  assert.equal(compactUsd(4_200_000), "$4.2M");
  assert.equal(compactUsd(10_000_000), "$10M");
  assert.equal(compactUsd(950), "$950.00");
  assert.equal(compactUsd(null), "—");
  assert.equal(tokenPrice(0.00000123), "0.0₅123");
  assert.equal(parseCompact("4.2m"), 4_200_000);
  assert.equal(parseCompact("$10,000,000"), 10_000_000);
  assert.equal(parseCompact("750K"), 750_000);
  assert.equal(parseCompact("abc"), null);
  assert.equal(parseCompact("0"), null);
});

const MINT = "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr";
const PAIR = "8sLbNZoA1cfnvMJLPfp98ZLAnFSYCFApfJKMbiXNLwxj";
const dsPair = {
  chainId: "solana",
  dexId: "raydium",
  pairAddress: PAIR,
  baseToken: { address: MINT, name: "Pop‮cat", symbol: "POP" },
  quoteToken: { address: WSOL_MINT, symbol: "SOL" },
  priceNative: "0.0021",
  priceUsd: "0.42",
  txns: { h1: { buys: 10, sells: 5 }, h24: { buys: 100, sells: 90 } },
  volume: { h24: 50000, h6: 1, h1: 2, m5: 3 },
  priceChange: { m5: 1, h1: -2.5, h6: 3, h24: 10 },
  liquidity: { usd: 120000 },
  fdv: 4_500_000,
  marketCap: 4_200_000,
  pairCreatedAt: 1_760_000_000_000,
  info: { imageUrl: "javascript:x", websites: [{ url: "https://pop.cat" }], socials: [{ type: "twitter", url: "ftp://bad" }] },
};

test("DexScreener pair normalisation", () => {
  const s = fromDexScreenerPair(dsPair, 1);
  assert.ok(s);
  assert.equal(s.name, "Popcat");
  assert.equal(s.marketCap, 4_200_000);
  assert.equal(s.marketCapIsFdv, false);
  assert.equal(s.priceSol, 0.0021);
  assert.equal(s.imageUrl, null);
  assert.deepEqual(s.links, [{ label: "Website", url: "https://pop.cat/" }]);
  const fdvOnly = fromDexScreenerPair({ ...dsPair, marketCap: undefined }, 1);
  assert.equal(fdvOnly?.marketCap, 4_500_000);
  assert.equal(fdvOnly?.marketCapIsFdv, true);
  const usdc = fromDexScreenerPair({ ...dsPair, quoteToken: { address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", symbol: "USDC" } }, 1);
  assert.equal(usdc?.priceSol, null);
  assert.equal(fromDexScreenerPair({ ...dsPair, chainId: "ethereum" }, 1), null);
  assert.equal(fromDexScreenerPair({ ...dsPair, baseToken: { address: "bad" } }, 1), null);
  assert.equal(bestPair([usdc!, s])?.priceSol, 0.0021);
});

test("discovery filter", () => {
  const s = fromDexScreenerPair(dsPair, 1)!;
  const now = 1_760_000_000_000 + 3 * 3_600_000;
  assert.equal(applyFilter([s], { minMarketCap: 1e6, maxAgeHours: 4, minTxns1h: 15 }, now).length, 1);
  assert.equal(applyFilter([s], { maxAgeHours: 2 }, now).length, 0);
  assert.equal(applyFilter([s], { minLiquidity: 200_000 }, now).length, 0);
  assert.equal(applyFilter([s], { minChange1h: 0 }, now).length, 0);
});

test("OHLCV parsing sorts, drops bad rows, dedupes", () => {
  const c = parseGeckoOhlcv([
    [200, 1, 2, 0.5, 1.5, 10],
    [100, 1, 1, 1, 1, 5],
    [100, 1, 1.2, 0.9, 1.1, 6],
    [300, 0, 1, 1, 1, 1],
    ["x"],
  ]);
  assert.deepEqual(c.map((x) => x.time), [100, 200]);
  assert.equal(c[0].close, 1.1);
});

test("paper fill: buy and sell with impact and fees", () => {
  const buy = simulatePaperFill({
    side: "buy",
    amountInRaw: 1_000_000_000n,
    tokenDecimals: 6,
    priceSol: 0.001,
    solUsd: 200,
    liquidityUsd: 200_000,
    slippageBps: 500,
    priorityFeeLamports: 100_000n,
  });
  assert.ok(buy.ok);
  // trade $200 vs pool side $100k → impact ≈ 0.1996%
  assert.ok(Math.abs(buy.priceImpactPct - 0.1996) < 0.001);
  assert.equal(buy.networkFeeLamports, 105_000n);
  assert.ok(buy.tokenAmountRaw > 997_000_000n && buy.tokenAmountRaw < 1_000_000_000n);
  const sell = simulatePaperFill({
    side: "sell",
    amountInRaw: buy.tokenAmountRaw,
    tokenDecimals: 6,
    priceSol: 0.001,
    solUsd: 200,
    liquidityUsd: 200_000,
    slippageBps: 500,
    priorityFeeLamports: 0n,
  });
  assert.ok(sell.ok);
  assert.ok(sell.solAmountLamports < 1_000_000_000n, "round trip loses to impact");
});

test("paper fill refuses when impact exceeds slippage or data missing", () => {
  const base = { side: "buy" as const, amountInRaw: 100_000_000_000n, tokenDecimals: 6, priceSol: 0.001, solUsd: 200, liquidityUsd: 20_000, slippageBps: 100, priorityFeeLamports: 0n };
  assert.match(simulatePaperFill(base).error ?? "", /exceeds your slippage/);
  assert.match(simulatePaperFill({ ...base, priceSol: 0 }).error ?? "", /No live price/);
  assert.match(simulatePaperFill({ ...base, liquidityUsd: null }).error ?? "", /liquidity/);
});
