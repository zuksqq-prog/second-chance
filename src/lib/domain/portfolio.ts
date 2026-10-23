/**
 * Position accounting in SOL (lamports) using the average-cost method.
 *
 * Two buckets per position:
 *  - known:   tokens acquired through trades we recorded (cost basis verified)
 *  - unknown: tokens found on-chain that we have no cost record for
 *             (airdrops, transfers in, trades made in other apps)
 *
 * All token quantities are raw base units (bigint). All SOL values are lamports.
 * Fees (network + priority + platform) are added to cost on buys and
 * subtracted from proceeds on sells.
 */

export interface LedgerTrade {
  id: string;
  mint: string;
  side: "buy" | "sell";
  tokenAmountRaw: bigint;
  /** Gross SOL spent (buy) or received (sell), before fees. */
  solAmountLamports: bigint;
  /** Network + priority fee paid in SOL. */
  networkFeeLamports: bigint;
  /** Platform/router fee expressed in SOL. */
  platformFeeLamports: bigint;
  timestamp: Date;
}

export interface Position {
  mint: string;
  knownQtyRaw: bigint;
  knownCostLamports: bigint;
  unknownQtyRaw: bigint;
  realizedPnlLamports: bigint;
  /** Proceeds from selling unknown-basis tokens; PnL for these can't be computed. */
  unknownBasisProceedsLamports: bigint;
  totalFeesLamports: bigint;
  buyCount: number;
  sellCount: number;
}

export type CostBasisStatus = "verified" | "partial" | "unknown" | "none";

export function emptyPosition(mint: string): Position {
  return {
    mint,
    knownQtyRaw: 0n,
    knownCostLamports: 0n,
    unknownQtyRaw: 0n,
    realizedPnlLamports: 0n,
    unknownBasisProceedsLamports: 0n,
    totalFeesLamports: 0n,
    buyCount: 0,
    sellCount: 0,
  };
}

export function totalQty(p: Position): bigint {
  return p.knownQtyRaw + p.unknownQtyRaw;
}

export function applyTrade(p: Position, t: LedgerTrade): Position {
  if (t.mint !== p.mint) throw new Error("Trade mint does not match position.");
  if (t.tokenAmountRaw <= 0n) throw new Error("Trade token amount must be positive.");
  if (t.solAmountLamports < 0n || t.networkFeeLamports < 0n || t.platformFeeLamports < 0n)
    throw new Error("Trade SOL amounts cannot be negative.");
  const fees = t.networkFeeLamports + t.platformFeeLamports;
  const next = { ...p, totalFeesLamports: p.totalFeesLamports + fees };

  if (t.side === "buy") {
    next.knownQtyRaw += t.tokenAmountRaw;
    next.knownCostLamports += t.solAmountLamports + fees;
    next.buyCount += 1;
    return next;
  }

  const held = totalQty(p);
  if (t.tokenAmountRaw > held) throw new Error("Sell exceeds tracked position. Reconcile with on-chain balance first.");
  const proceeds = t.solAmountLamports - fees;

  // Split the sell pro-rata between known and unknown buckets.
  const knownPart = held === 0n ? 0n : (t.tokenAmountRaw * p.knownQtyRaw) / held;
  const unknownPart = t.tokenAmountRaw - knownPart;
  const knownProceeds = t.tokenAmountRaw === 0n ? 0n : (proceeds * knownPart) / t.tokenAmountRaw;
  const unknownProceeds = proceeds - knownProceeds;

  const costRemoved = p.knownQtyRaw === 0n ? 0n : (p.knownCostLamports * knownPart) / p.knownQtyRaw;
  next.knownQtyRaw -= knownPart;
  next.knownCostLamports -= costRemoved;
  next.unknownQtyRaw -= unknownPart;
  next.realizedPnlLamports += knownProceeds - costRemoved;
  next.unknownBasisProceedsLamports += unknownProceeds;
  next.sellCount += 1;
  if (next.knownQtyRaw === 0n) next.knownCostLamports = 0n;
  return next;
}

/**
 * Bring a tracked position in line with the on-chain balance.
 * - More on-chain than tracked: the extra is added as unknown-basis tokens.
 * - Less on-chain than tracked: tokens left outside the terminal. Remove
 *   unknown first, then known (with its cost, no realized PnL — proceeds unknown).
 */
export function reconcile(p: Position, onChainQtyRaw: bigint): { position: Position; adjustmentRaw: bigint } {
  const tracked = totalQty(p);
  const diff = onChainQtyRaw - tracked;
  if (diff === 0n) return { position: p, adjustmentRaw: 0n };
  const next = { ...p };
  if (diff > 0n) {
    next.unknownQtyRaw += diff;
  } else {
    let remove = -diff;
    const fromUnknown = remove < next.unknownQtyRaw ? remove : next.unknownQtyRaw;
    next.unknownQtyRaw -= fromUnknown;
    remove -= fromUnknown;
    if (remove > 0n) {
      const costRemoved = next.knownQtyRaw === 0n ? 0n : (next.knownCostLamports * remove) / next.knownQtyRaw;
      next.knownQtyRaw -= remove;
      next.knownCostLamports -= costRemoved;
      if (next.knownQtyRaw === 0n) next.knownCostLamports = 0n;
    }
  }
  return { position: next, adjustmentRaw: diff };
}

export function costBasisStatus(p: Position): CostBasisStatus {
  if (totalQty(p) === 0n) return "none";
  if (p.unknownQtyRaw === 0n) return "verified";
  if (p.knownQtyRaw === 0n) return "unknown";
  return "partial";
}

export interface PositionValuation {
  costBasisStatus: CostBasisStatus;
  /** UI amount (decimals applied). */
  quantity: number;
  /** Average cost per whole token in SOL (known bucket only). */
  avgEntryPriceSol: number | null;
  marketValueSol: number | null;
  /** Unrealized PnL on the known bucket only. */
  unrealizedPnlSol: number | null;
  unrealizedPnlPct: number | null;
  realizedPnlSol: number;
  knownCostSol: number;
}

export const LAMPORTS_PER_SOL = 1_000_000_000;

export function valuePosition(p: Position, decimals: number, priceSol: number | null): PositionValuation {
  const scale = 10 ** decimals;
  const knownQty = Number(p.knownQtyRaw) / scale;
  const qty = Number(totalQty(p)) / scale;
  const knownCostSol = Number(p.knownCostLamports) / LAMPORTS_PER_SOL;
  const avg = knownQty > 0 ? knownCostSol / knownQty : null;
  const price = priceSol != null && Number.isFinite(priceSol) && priceSol >= 0 ? priceSol : null;
  const mv = price != null ? qty * price : null;
  const knownMv = price != null ? knownQty * price : null;
  const upnl = knownMv != null && knownQty > 0 ? knownMv - knownCostSol : null;
  const upct = upnl != null && knownCostSol > 0 ? (upnl / knownCostSol) * 100 : null;
  return {
    costBasisStatus: costBasisStatus(p),
    quantity: qty,
    avgEntryPriceSol: avg,
    marketValueSol: mv,
    unrealizedPnlSol: upnl,
    unrealizedPnlPct: upct,
    realizedPnlSol: Number(p.realizedPnlLamports) / LAMPORTS_PER_SOL,
    knownCostSol,
  };
}

export function buildPositions(trades: LedgerTrade[]): Map<string, Position> {
  const sorted = [...trades].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  const out = new Map<string, Position>();
  for (const t of sorted) out.set(t.mint, applyTrade(out.get(t.mint) ?? emptyPosition(t.mint), t));
  return out;
}

/** Convert a UI amount (e.g. 0.25 SOL or 1234.5 tokens) to raw base units without float drift. */
export function toRaw(ui: string | number, decimals: number): bigint {
  const s = typeof ui === "number" ? ui.toFixed(Math.min(decimals, 20)) : ui.trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error("Invalid amount.");
  const [whole, frac = ""] = s.split(".");
  const fracPadded = (frac + "0".repeat(decimals)).slice(0, decimals);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fracPadded || "0");
}

export function fromRaw(raw: bigint, decimals: number): number {
  return Number(raw) / 10 ** decimals;
}

/** Raw amount for a percent of a position, rounding down. 100% returns the full amount. */
export function percentOf(raw: bigint, percent: number): bigint {
  if (!(percent > 0) || percent > 100) throw new Error("Percent must be between 0 and 100.");
  if (percent === 100) return raw;
  return (raw * BigInt(Math.round(percent * 100))) / 10_000n;
}
