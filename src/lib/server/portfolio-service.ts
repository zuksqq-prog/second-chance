import "server-only";
import { buildPositions, emptyPosition, LAMPORTS_PER_SOL, reconcile, valuePosition, type Position } from "@/lib/domain/portfolio";
import { progressTowardTarget } from "@/lib/domain/thesis-engine";
import type { TradeMode } from "@/lib/domain/types";
import { env } from "./env";
import { getSolUsd, getTokens } from "./market-data";
import * as repo from "./repo";
import { getDecimals, getSolBalanceLamports, getTokenHoldings } from "./solana-rpc";
import { reconcileRealTrade } from "./trading";
import { log } from "./log";

export interface PortfolioRow {
  mint: string;
  symbol: string;
  name: string | null;
  imageUrl: string | null;
  decimals: number;
  quantityRaw: string;
  quantity: number;
  costBasisStatus: string;
  avgEntryPriceSol: number | null;
  priceSol: number | null;
  priceUsd: number | null;
  marketCap: number | null;
  marketValueSol: number | null;
  marketValueUsd: number | null;
  unrealizedPnlSol: number | null;
  unrealizedPnlPct: number | null;
  realizedPnlSol: number;
  feesSol: number;
  unknownBasisProceedsSol: number;
  thesis: { id: string; targetMarketCap: number; entryMarketCap: number | null; progress: number | null } | null;
}

export async function getPortfolio(wallet: string, mode: TradeMode) {
  const warnings: string[] = [];
  if (mode === "real") {
    // Settle any trades still pending before computing positions.
    for (const t of await repo.listPendingRealTrades(wallet)) await reconcileRealTrade(wallet, t.id).catch(() => null);
  }
  const trades = await repo.listTrades(wallet, mode, 5000);
  const positions = buildPositions(repo.toLedger(trades));
  const decimalsByMint = new Map<string, number>();
  const symbols = new Map<string, string>();
  for (const t of trades) {
    decimalsByMint.set(t.mint, t.tokenDecimals);
    if (t.tokenSymbol) symbols.set(t.mint, t.tokenSymbol);
  }

  let solBalanceLamports: bigint | null = null;
  if (mode === "paper") {
    const acct = await repo.getOrCreatePaperAccount(wallet, BigInt(Math.round(env().PAPER_STARTING_SOL * LAMPORTS_PER_SOL)));
    solBalanceLamports = acct.solBalanceLamports;
  } else {
    try {
      const [sol, holdings] = await Promise.all([getSolBalanceLamports(wallet), getTokenHoldings(wallet)]);
      solBalanceLamports = sol;
      const onChain = new Map(holdings.map((h) => [h.mint, h]));
      for (const h of holdings) {
        decimalsByMint.set(h.mint, h.decimals);
        const p = positions.get(h.mint) ?? emptyPosition(h.mint);
        positions.set(h.mint, reconcile(p, h.amountRaw).position);
      }
      // Tracked positions that are gone on-chain (sold or moved elsewhere).
      for (const [mint, p] of positions) if (!onChain.has(mint)) positions.set(mint, reconcile(p, 0n).position);
    } catch (e) {
      log.warn("portfolio_rpc_failed", { err: String(e) });
      warnings.push("Couldn't read on-chain balances. Showing positions from recorded trades only.");
    }
  }

  const openMints = [...positions.values()].filter((p) => p.knownQtyRaw + p.unknownQtyRaw > 0n).map((p) => p.mint);
  const [prices, solUsd, theses] = await Promise.all([
    getTokens(openMints).catch((e) => {
      warnings.push("Live prices are unavailable. Values and unrealized PnL are hidden until they return.");
      log.warn("portfolio_prices_failed", { err: String(e) });
      return new Map();
    }),
    getSolUsd().catch(() => null),
    repo.listTheses(wallet, mode),
  ]);
  const activeThesis = new Map(theses.filter((t) => t.status === "active").map((t) => [t.mint, t]));

  const rows: PortfolioRow[] = [];
  let realizedTotal = 0;
  for (const p of positions.values()) {
    realizedTotal += Number(p.realizedPnlLamports) / LAMPORTS_PER_SOL;
    if (p.knownQtyRaw + p.unknownQtyRaw === 0n) continue;
    const decimals = decimalsByMint.get(p.mint) ?? (await getDecimals(p.mint).catch(() => 0));
    const snap = prices.get(p.mint);
    rows.push(toRow(p, decimals, snap, solUsd, symbols.get(p.mint), activeThesis.get(p.mint)));
  }
  rows.sort((a, b) => (b.marketValueSol ?? 0) - (a.marketValueSol ?? 0));

  const solBalance = solBalanceLamports != null ? Number(solBalanceLamports) / LAMPORTS_PER_SOL : null;
  const positionsValue = rows.reduce((s, r) => s + (r.marketValueSol ?? 0), 0);
  const unrealized = rows.reduce((s, r) => s + (r.unrealizedPnlSol ?? 0), 0);
  return {
    mode,
    simulated: mode === "paper",
    solBalance,
    solUsd,
    positionsValueSol: positionsValue,
    totalValueSol: solBalance != null ? solBalance + positionsValue : null,
    realizedPnlSol: realizedTotal,
    unrealizedPnlSol: unrealized,
    hasUnknownBasis: rows.some((r) => r.costBasisStatus !== "verified"),
    rows,
    warnings,
  };
}

function toRow(
  p: Position,
  decimals: number,
  snap: { symbol: string; name: string; imageUrl: string | null; priceSol: number | null; priceUsd: number | null; marketCap: number | null } | undefined,
  solUsd: number | null,
  fallbackSymbol: string | undefined,
  thesis: repo.ThesisRecord | undefined,
): PortfolioRow {
  const priceSol = snap?.priceSol ?? (snap?.priceUsd != null && solUsd ? snap.priceUsd / solUsd : null);
  const v = valuePosition(p, decimals, priceSol);
  return {
    mint: p.mint,
    symbol: snap?.symbol ?? fallbackSymbol ?? "???",
    name: snap?.name ?? null,
    imageUrl: snap?.imageUrl ?? null,
    decimals,
    quantityRaw: (p.knownQtyRaw + p.unknownQtyRaw).toString(),
    quantity: v.quantity,
    costBasisStatus: v.costBasisStatus,
    avgEntryPriceSol: v.avgEntryPriceSol,
    priceSol,
    priceUsd: snap?.priceUsd ?? null,
    marketCap: snap?.marketCap ?? null,
    marketValueSol: v.marketValueSol,
    marketValueUsd: v.marketValueSol != null && solUsd ? v.marketValueSol * solUsd : null,
    unrealizedPnlSol: v.unrealizedPnlSol,
    unrealizedPnlPct: v.unrealizedPnlPct,
    realizedPnlSol: v.realizedPnlSol,
    feesSol: Number(p.totalFeesLamports) / LAMPORTS_PER_SOL,
    unknownBasisProceedsSol: Number(p.unknownBasisProceedsLamports) / LAMPORTS_PER_SOL,
    thesis: thesis
      ? {
          id: thesis.id,
          targetMarketCap: thesis.targetMarketCap,
          entryMarketCap: thesis.entryMarketCap,
          progress: progressTowardTarget(thesis.entryMarketCap, snap?.marketCap ?? null, thesis.targetMarketCap),
        }
      : null,
  };
}
