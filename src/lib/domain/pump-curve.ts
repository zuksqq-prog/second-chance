/**
 * pump.fun bonding curve (program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P).
 * Account layout after the 8-byte Anchor discriminator:
 *   virtual_token_reserves u64 | virtual_sol_reserves u64 | real_token_reserves u64 |
 *   real_sol_reserves u64 | token_total_supply u64 | complete bool | …
 * 793.1M tokens (6 decimals) are sold along the curve; when real token
 * reserves reach zero the curve completes and the token migrates.
 */

export const PUMP_PROGRAM_ID = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
export const INITIAL_REAL_TOKEN_RESERVES = 793_100_000_000_000n;
/** Approximate total pump.fun trading fee (protocol + creator). Used for paper fills only. */
export const PUMP_FEE_BPS = 125n;

export interface BondingCurve {
  virtualTokenReserves: bigint;
  virtualSolReserves: bigint;
  realTokenReserves: bigint;
  realSolReserves: bigint;
  tokenTotalSupply: bigint;
  complete: boolean;
}

function u64(b: Uint8Array, o: number): bigint {
  let v = 0n;
  for (let i = 7; i >= 0; i--) v = (v << 8n) | BigInt(b[o + i]);
  return v;
}

export function parseBondingCurve(data: Uint8Array): BondingCurve | null {
  if (data.length < 49) return null;
  const c: BondingCurve = {
    virtualTokenReserves: u64(data, 8),
    virtualSolReserves: u64(data, 16),
    realTokenReserves: u64(data, 24),
    realSolReserves: u64(data, 32),
    tokenTotalSupply: u64(data, 40),
    complete: data[48] === 1,
  };
  // Sanity: reject accounts that don't look like a curve.
  if (c.virtualTokenReserves === 0n || c.virtualSolReserves === 0n || c.realTokenReserves > c.virtualTokenReserves) return null;
  return c;
}

/** Bonding progress 0–100. */
export function bondingProgress(c: BondingCurve): number {
  if (c.complete) return 100;
  const r = c.realTokenReserves > INITIAL_REAL_TOKEN_RESERVES ? INITIAL_REAL_TOKEN_RESERVES : c.realTokenReserves;
  const sold = INITIAL_REAL_TOKEN_RESERVES - r;
  return Number((sold * 10_000n) / INITIAL_REAL_TOKEN_RESERVES) / 100;
}

/** Spot price in SOL per whole token (6 decimals). */
export function curvePriceSol(c: BondingCurve): number {
  return Number(c.virtualSolReserves) / 1e9 / (Number(c.virtualTokenReserves) / 1e6);
}

export interface CurveQuote {
  ok: boolean;
  error?: string;
  /** Tokens out (buy) or tokens in (sell), raw. */
  tokenAmountRaw: bigint;
  /** SOL that went into / came out of the curve, before fee, lamports. */
  solAmountLamports: bigint;
  feeLamports: bigint;
  priceImpactPct: number;
  executionPriceSol: number;
}

const fail = (error: string): CurveQuote => ({ ok: false, error, tokenAmountRaw: 0n, solAmountLamports: 0n, feeLamports: 0n, priceImpactPct: 0, executionPriceSol: 0 });

/** Constant-product buy on virtual reserves: SOL in (incl. fee) → tokens out. */
export function quoteCurveBuy(c: BondingCurve, solInLamports: bigint): CurveQuote {
  if (c.complete) return fail("This token has finished bonding and migrated.");
  if (solInLamports <= 0n) return fail("Amount must be greater than zero.");
  const fee = (solInLamports * PUMP_FEE_BPS) / 10_000n;
  const net = solInLamports - fee;
  const k = c.virtualTokenReserves * c.virtualSolReserves;
  let out = c.virtualTokenReserves - k / (c.virtualSolReserves + net);
  if (out > c.realTokenReserves) out = c.realTokenReserves;
  if (out <= 0n) return fail("The curve has no tokens left to sell.");
  const spot = curvePriceSol(c);
  const exec = Number(net) / 1e9 / (Number(out) / 1e6);
  return { ok: true, tokenAmountRaw: out, solAmountLamports: net, feeLamports: fee, priceImpactPct: (exec / spot - 1) * 100, executionPriceSol: exec };
}

/** Constant-product sell: tokens in → SOL out (fee taken from proceeds). */
export function quoteCurveSell(c: BondingCurve, tokensInRaw: bigint): CurveQuote {
  if (c.complete) return fail("This token has finished bonding and migrated.");
  if (tokensInRaw <= 0n) return fail("Amount must be greater than zero.");
  const k = c.virtualTokenReserves * c.virtualSolReserves;
  let gross = c.virtualSolReserves - k / (c.virtualTokenReserves + tokensInRaw);
  if (gross > c.realSolReserves) gross = c.realSolReserves;
  if (gross <= 0n) return fail("The curve has no SOL to pay out.");
  const fee = (gross * PUMP_FEE_BPS) / 10_000n;
  const spot = curvePriceSol(c);
  const exec = Number(gross) / 1e9 / (Number(tokensInRaw) / 1e6);
  return { ok: true, tokenAmountRaw: tokensInRaw, solAmountLamports: gross, feeLamports: fee, priceImpactPct: (1 - exec / spot) * 100, executionPriceSol: exec };
}
