import { finiteOrNull, isSolanaAddress } from "./sanitize";

/** One on-chain swap of the token, from any wallet, routed by any app (Axiom, Photon, bots, Jupiter…). */
export interface LiveTrade {
  id: string;
  txHash: string;
  pool: string;
  kind: "buy" | "sell";
  trader: string;
  tokenAmount: number; // UI units of the token
  priceUsd: number;
  volumeUsd: number;
  /** Market cap at this trade's price (priceUsd × circulating supply). Null if supply unknown. */
  marketCap: number | null;
  timestamp: number; // ms
  block: number;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Parse GeckoTerminal `/pools/{pool}/trades` (verified Oct 2026):
 * attributes.{block_number, block_timestamp, tx_hash, tx_from_address, kind,
 * from_token_address, to_token_address, from_token_amount, to_token_amount,
 * price_from_in_usd, price_to_in_usd, volume_in_usd, is_anomalous}.
 * The token side is identified by address, not by `kind`, so pools where the
 * token is the quote asset are handled correctly.
 */
export function parseGeckoTrades(json: any, mint: string, pool: string, supply: number | null): LiveTrade[] {
  const rows: any[] = Array.isArray(json?.data) ? json.data : [];
  const out: LiveTrade[] = [];
  for (const r of rows) {
    const a = r?.attributes;
    if (!a || a.is_anomalous === true) continue;
    const toIsToken = a.to_token_address === mint;
    const fromIsToken = a.from_token_address === mint;
    if (!toIsToken && !fromIsToken) continue;
    const kind: "buy" | "sell" = toIsToken ? "buy" : "sell";
    const tokenAmount = finiteOrNull(toIsToken ? a.to_token_amount : a.from_token_amount);
    const priceUsd = finiteOrNull(toIsToken ? a.price_to_in_usd : a.price_from_in_usd);
    const volumeUsd = finiteOrNull(a.volume_in_usd);
    const ts = typeof a.block_timestamp === "string" ? Date.parse(a.block_timestamp) : NaN;
    if (tokenAmount == null || tokenAmount <= 0 || priceUsd == null || priceUsd <= 0 || volumeUsd == null || !Number.isFinite(ts)) continue;
    const trader = isSolanaAddress(a.tx_from_address) ? (a.tx_from_address as string) : "";
    const txHash = typeof a.tx_hash === "string" && /^[1-9A-HJ-NP-Za-km-z]{43,90}$/.test(a.tx_hash) ? a.tx_hash : "";
    if (!txHash) continue;
    out.push({
      id: typeof r.id === "string" ? r.id.slice(0, 160) : `${txHash}:${kind}`,
      txHash,
      pool,
      kind,
      trader,
      tokenAmount,
      priceUsd,
      volumeUsd,
      marketCap: supply != null && supply > 0 ? priceUsd * supply : null,
      timestamp: ts,
      block: Number(a.block_number) || 0,
    });
  }
  return out;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Merge trades from several pools, newest first, de-duplicated. */
export function mergeTrades(lists: LiveTrade[][], limit = 300): LiveTrade[] {
  const seen = new Set<string>();
  const all: LiveTrade[] = [];
  for (const l of lists) for (const t of l) if (!seen.has(t.id)) (seen.add(t.id), all.push(t));
  all.sort((a, b) => b.timestamp - a.timestamp || b.block - a.block);
  return all.slice(0, limit);
}

export interface TraderStats {
  trader: string;
  buys: number;
  sells: number;
  boughtUsd: number;
  soldUsd: number;
  /** soldUsd − boughtUsd within the window: a rough flow figure, not true PnL. */
  netUsd: number;
}

/** Rank wallets by USD volume within the loaded window of trades. */
export function topTraders(trades: LiveTrade[], limit = 25): TraderStats[] {
  const m = new Map<string, TraderStats>();
  for (const t of trades) {
    if (!t.trader) continue;
    const s = m.get(t.trader) ?? { trader: t.trader, buys: 0, sells: 0, boughtUsd: 0, soldUsd: 0, netUsd: 0 };
    if (t.kind === "buy") {
      s.buys++;
      s.boughtUsd += t.volumeUsd;
    } else {
      s.sells++;
      s.soldUsd += t.volumeUsd;
    }
    s.netUsd = s.soldUsd - s.boughtUsd;
    m.set(t.trader, s);
  }
  return [...m.values()].sort((a, b) => b.boughtUsd + b.soldUsd - (a.boughtUsd + a.soldUsd)).slice(0, limit);
}

export interface CycleTrade {
  side: "buy" | "sell";
  tokenAmountRaw: bigint;
  /** USD spent (buy, incl. fees) or received (sell, net of fees). */
  usd: number;
  timestamp: number;
}

export interface CycleSummary {
  /** "open" while tokens are held; "closed" after the position went to zero; "none" with no trades. */
  state: "open" | "closed" | "none";
  boughtUsd: number;
  soldUsd: number;
}

/**
 * Bought / sold totals for the current position cycle. A cycle starts at the
 * first buy after the position was flat and ends when it returns to zero.
 * When flat, the last closed cycle is returned so its closed PnL stays visible.
 */
export function positionCycle(trades: CycleTrade[]): CycleSummary {
  const sorted = [...trades].sort((a, b) => a.timestamp - b.timestamp);
  let qty = 0n;
  let cur = { boughtUsd: 0, soldUsd: 0 };
  let lastClosed: { boughtUsd: number; soldUsd: number } | null = null;
  let any = false;
  for (const t of sorted) {
    any = true;
    if (t.side === "buy") {
      qty += t.tokenAmountRaw;
      cur.boughtUsd += t.usd;
    } else {
      qty -= t.tokenAmountRaw;
      cur.soldUsd += t.usd;
      if (qty <= 0n) {
        qty = 0n;
        lastClosed = cur;
        cur = { boughtUsd: 0, soldUsd: 0 };
      }
    }
  }
  if (!any) return { state: "none", boughtUsd: 0, soldUsd: 0 };
  if (qty > 0n) return { state: "open", ...cur };
  return lastClosed ? { state: "closed", ...lastClosed } : { state: "none", boughtUsd: 0, soldUsd: 0 };
}

/** Fraction of the position to sell to take the initial investment back out (Axiom's "Sell Init."). */
export function sellInitialFraction(investedUsd: number, holdingUsd: number): number | null {
  if (!(investedUsd > 0) || !(holdingUsd > 0)) return null;
  return Math.min(1, investedUsd / holdingUsd);
}

export interface TradeCandle {
  time: number; // unix seconds, bucket start
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number; // USD
}

/** Bucket swaps into OHLC candles (USD price, USD volume). Trades may be in any order. */
export function candlesFromTrades(trades: { timestamp: number; priceUsd: number; volumeUsd: number }[], stepSec: number): TradeCandle[] {
  const sorted = [...trades].filter((t) => t.priceUsd > 0 && Number.isFinite(t.priceUsd)).sort((a, b) => a.timestamp - b.timestamp);
  const out: TradeCandle[] = [];
  for (const t of sorted) {
    const time = Math.floor(t.timestamp / 1000 / stepSec) * stepSec;
    const last = out[out.length - 1];
    if (last && last.time === time) {
      last.high = Math.max(last.high, t.priceUsd);
      last.low = Math.min(last.low, t.priceUsd);
      last.close = t.priceUsd;
      last.volume += t.volumeUsd;
    } else {
      // Open at the previous close so consecutive candles connect, like exchange charts.
      const open = last ? last.close : t.priceUsd;
      out.push({ time, open, high: Math.max(open, t.priceUsd), low: Math.min(open, t.priceUsd), close: t.priceUsd, volume: t.volumeUsd });
    }
  }
  return out;
}

/**
 * Combine provider OHLCV with trade-built candles: provider history first,
 * trade candles refresh the last provider bucket and extend past it.
 */
export function mergeCandles(base: TradeCandle[], fromTrades: TradeCandle[]): TradeCandle[] {
  if (!base.length) return fromTrades;
  const out = base.map((c) => ({ ...c }));
  const lastTime = out[out.length - 1].time;
  for (const c of fromTrades) {
    if (c.time < lastTime) continue;
    if (c.time === lastTime) {
      const l = out[out.length - 1];
      l.high = Math.max(l.high, c.high);
      l.low = Math.min(l.low, c.low);
      l.close = c.close;
      l.volume = Math.max(l.volume, c.volume);
    } else out.push({ ...c });
  }
  return out;
}
