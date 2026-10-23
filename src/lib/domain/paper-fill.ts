/**
 * Paper-trading fill model. Uses a live price and live pool liquidity to
 * estimate what a real swap would do, so paper accounting is realistic.
 * Paper fills are ALWAYS labelled as simulated in storage and UI.
 *
 * Price impact uses a constant-product approximation:
 *   impact ≈ tradeValue / (poolSideValue + tradeValue)
 * where poolSideValue ≈ liquidityUsd / 2.
 */

export interface PaperFillInput {
  side: "buy" | "sell";
  /** SOL in (buy) or tokens in (sell), raw base units. */
  amountInRaw: bigint;
  tokenDecimals: number;
  /** Live token price in SOL. */
  priceSol: number;
  /** Live SOL price in USD (for liquidity conversion). */
  solUsd: number;
  liquidityUsd: number | null;
  slippageBps: number;
  priorityFeeLamports: bigint;
  /** Approximates router/platform fee. */
  platformFeeBps?: number;
}

export interface PaperFill {
  ok: boolean;
  error?: string;
  tokenAmountRaw: bigint;
  solAmountLamports: bigint; // gross SOL spent / received before fees
  networkFeeLamports: bigint;
  platformFeeLamports: bigint;
  priceImpactPct: number;
  executionPriceSol: number;
}

export const BASE_NETWORK_FEE_LAMPORTS = 5000n;
const LAMPORTS = 1_000_000_000;

export function simulatePaperFill(i: PaperFillInput): PaperFill {
  const fail = (error: string): PaperFill => ({
    ok: false,
    error,
    tokenAmountRaw: 0n,
    solAmountLamports: 0n,
    networkFeeLamports: 0n,
    platformFeeLamports: 0n,
    priceImpactPct: 0,
    executionPriceSol: 0,
  });
  if (!(i.priceSol > 0) || !Number.isFinite(i.priceSol)) return fail("No live price for this token.");
  if (!(i.solUsd > 0)) return fail("No live SOL price.");
  if (i.amountInRaw <= 0n) return fail("Amount must be greater than zero.");
  if (i.liquidityUsd == null || i.liquidityUsd < 500) return fail("Pool liquidity is too low to estimate a fill.");

  const scale = 10 ** i.tokenDecimals;
  const tradeUsd =
    i.side === "buy"
      ? (Number(i.amountInRaw) / LAMPORTS) * i.solUsd
      : (Number(i.amountInRaw) / scale) * i.priceSol * i.solUsd;
  const poolSide = i.liquidityUsd / 2;
  const impact = tradeUsd / (poolSide + tradeUsd);
  const impactBps = Math.round(impact * 10_000);
  if (impactBps > i.slippageBps)
    return fail(`Estimated price impact ${(impact * 100).toFixed(2)}% exceeds your slippage of ${(i.slippageBps / 100).toFixed(2)}%.`);

  const feeBps = i.platformFeeBps ?? 0;
  const networkFee = BASE_NETWORK_FEE_LAMPORTS + i.priorityFeeLamports;

  if (i.side === "buy") {
    const solIn = i.amountInRaw;
    const platformFee = (solIn * BigInt(feeBps)) / 10_000n;
    const execPrice = i.priceSol * (1 + impact);
    const solForSwap = Number(solIn - platformFee) / LAMPORTS;
    const tokens = BigInt(Math.floor((solForSwap / execPrice) * scale));
    return {
      ok: true,
      tokenAmountRaw: tokens,
      solAmountLamports: solIn - platformFee,
      networkFeeLamports: networkFee,
      platformFeeLamports: platformFee,
      priceImpactPct: impact * 100,
      executionPriceSol: execPrice,
    };
  }
  const execPrice = i.priceSol * (1 - impact);
  const grossSol = BigInt(Math.floor((Number(i.amountInRaw) / scale) * execPrice * LAMPORTS));
  const platformFee = (grossSol * BigInt(feeBps)) / 10_000n;
  return {
    ok: true,
    tokenAmountRaw: i.amountInRaw,
    solAmountLamports: grossSol,
    networkFeeLamports: networkFee,
    platformFeeLamports: platformFee,
    priceImpactPct: impact * 100,
    executionPriceSol: execPrice,
  };
}
