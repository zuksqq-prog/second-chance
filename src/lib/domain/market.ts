import { cleanName, cleanSymbol, finiteOrNull, isSolanaAddress, safeExternalUrl, safeImageUrl } from "./sanitize";

/** Normalised token snapshot used everywhere in the app. */
export interface TokenSnapshot {
  mint: string;
  name: string;
  symbol: string;
  imageUrl: string | null;
  pairAddress: string;
  dexId: string;
  quoteSymbol: string;
  priceUsd: number | null;
  priceSol: number | null;
  marketCap: number | null;
  /** True when marketCap is the provider's FDV fallback rather than circulating MC. */
  marketCapIsFdv: boolean;
  fdv: number | null;
  liquidityUsd: number | null;
  volume: { m5: number | null; h1: number | null; h6: number | null; h24: number | null };
  priceChange: { m5: number | null; h1: number | null; h6: number | null; h24: number | null };
  txns24h: { buys: number | null; sells: number | null };
  txns1h: { buys: number | null; sells: number | null };
  pairCreatedAt: number | null;
  links: { label: string; url: string }[];
  source: "dexscreener" | "geckoterminal";
  observedAt: number;
}

export const WSOL_MINT = "So11111111111111111111111111111111111111112";

/* eslint-disable @typescript-eslint/no-explicit-any */
export function fromDexScreenerPair(p: any, observedAt: number): TokenSnapshot | null {
  if (!p || p.chainId !== "solana") return null;
  const mint = p.baseToken?.address;
  if (!isSolanaAddress(mint) || !isSolanaAddress(p.pairAddress)) return null;
  const mc = finiteOrNull(p.marketCap);
  const fdv = finiteOrNull(p.fdv);
  const priceUsd = finiteOrNull(p.priceUsd);
  // priceNative is denominated in the quote token; only trust it as SOL when quote is SOL.
  const quoteIsSol = p.quoteToken?.address === WSOL_MINT;
  const links: { label: string; url: string }[] = [];
  for (const w of p.info?.websites ?? []) {
    const url = safeExternalUrl(w?.url);
    if (url) links.push({ label: "Website", url });
  }
  for (const s of p.info?.socials ?? []) {
    const url = safeExternalUrl(s?.url);
    if (url) links.push({ label: cleanName(s?.type ?? "Link").slice(0, 16), url });
  }
  return {
    mint,
    name: cleanName(p.baseToken?.name),
    symbol: cleanSymbol(p.baseToken?.symbol),
    imageUrl: safeImageUrl(p.info?.imageUrl),
    pairAddress: p.pairAddress,
    dexId: cleanSymbol(p.dexId),
    quoteSymbol: cleanSymbol(p.quoteToken?.symbol),
    priceUsd,
    priceSol: quoteIsSol ? finiteOrNull(p.priceNative) : null,
    marketCap: mc ?? fdv,
    marketCapIsFdv: mc == null && fdv != null,
    fdv,
    liquidityUsd: finiteOrNull(p.liquidity?.usd),
    volume: {
      m5: finiteOrNull(p.volume?.m5),
      h1: finiteOrNull(p.volume?.h1),
      h6: finiteOrNull(p.volume?.h6),
      h24: finiteOrNull(p.volume?.h24),
    },
    priceChange: {
      m5: finiteOrNull(p.priceChange?.m5),
      h1: finiteOrNull(p.priceChange?.h1),
      h6: finiteOrNull(p.priceChange?.h6),
      h24: finiteOrNull(p.priceChange?.h24),
    },
    txns24h: { buys: finiteOrNull(p.txns?.h24?.buys), sells: finiteOrNull(p.txns?.h24?.sells) },
    txns1h: { buys: finiteOrNull(p.txns?.h1?.buys), sells: finiteOrNull(p.txns?.h1?.sells) },
    pairCreatedAt: finiteOrNull(p.pairCreatedAt),
    links: links.slice(0, 6),
    source: "dexscreener",
    observedAt,
  };
}

/**
 * GeckoTerminal pool (JSON:API) → snapshot. Requires `include=base_token` so
 * the base token's mint/name/symbol can be read from `included`.
 */
export function fromGeckoPool(pool: any, included: any[], observedAt: number): TokenSnapshot | null {
  const a = pool?.attributes;
  const baseId: string | undefined = pool?.relationships?.base_token?.data?.id;
  if (!a || !baseId) return null;
  const tok = included.find((x) => x?.id === baseId)?.attributes;
  const mint = tok?.address ?? baseId.replace(/^solana_/, "");
  if (!isSolanaAddress(mint) || !isSolanaAddress(a.address)) return null;
  const mc = finiteOrNull(a.market_cap_usd);
  const fdv = finiteOrNull(a.fdv_usd);
  const created = a.pool_created_at ? Date.parse(a.pool_created_at) : NaN;
  const quoteId: string | undefined = pool?.relationships?.quote_token?.data?.id;
  const quoteIsSol = quoteId === `solana_${WSOL_MINT}`;
  return {
    mint,
    name: cleanName(tok?.name ?? a.name),
    symbol: cleanSymbol(tok?.symbol),
    imageUrl: safeImageUrl(tok?.image_url),
    pairAddress: a.address,
    dexId: cleanSymbol(pool?.relationships?.dex?.data?.id ?? "dex"),
    quoteSymbol: quoteIsSol ? "SOL" : "?",
    priceUsd: finiteOrNull(a.base_token_price_usd),
    priceSol: quoteIsSol ? finiteOrNull(a.base_token_price_quote_token) : null,
    marketCap: mc ?? fdv,
    marketCapIsFdv: mc == null && fdv != null,
    fdv,
    liquidityUsd: finiteOrNull(a.reserve_in_usd),
    volume: {
      m5: finiteOrNull(a.volume_usd?.m5),
      h1: finiteOrNull(a.volume_usd?.h1),
      h6: finiteOrNull(a.volume_usd?.h6),
      h24: finiteOrNull(a.volume_usd?.h24),
    },
    priceChange: {
      m5: finiteOrNull(a.price_change_percentage?.m5),
      h1: finiteOrNull(a.price_change_percentage?.h1),
      h6: finiteOrNull(a.price_change_percentage?.h6),
      h24: finiteOrNull(a.price_change_percentage?.h24),
    },
    txns24h: { buys: finiteOrNull(a.transactions?.h24?.buys), sells: finiteOrNull(a.transactions?.h24?.sells) },
    txns1h: { buys: finiteOrNull(a.transactions?.h1?.buys), sells: finiteOrNull(a.transactions?.h1?.sells) },
    pairCreatedAt: Number.isFinite(created) ? created : null,
    links: [],
    source: "geckoterminal",
    observedAt,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Pick the most liquid SOL-quoted pair for a mint (the one used for MC and charts). */
export function bestPair(snaps: TokenSnapshot[]): TokenSnapshot | null {
  if (snaps.length === 0) return null;
  return [...snaps].sort((a, b) => {
    const sa = a.priceSol != null ? 1 : 0;
    const sb = b.priceSol != null ? 1 : 0;
    if (sa !== sb) return sb - sa;
    return (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0);
  })[0];
}

export interface DiscoveryFilter {
  minMarketCap?: number;
  maxMarketCap?: number;
  minLiquidity?: number;
  minVolume24h?: number;
  maxAgeHours?: number;
  minAgeHours?: number;
  minChange1h?: number;
  maxChange1h?: number;
  minTxns1h?: number;
}

export function applyFilter(list: TokenSnapshot[], f: DiscoveryFilter, nowMs: number): TokenSnapshot[] {
  return list.filter((t) => {
    if (f.minMarketCap != null && (t.marketCap ?? 0) < f.minMarketCap) return false;
    if (f.maxMarketCap != null && (t.marketCap ?? Infinity) > f.maxMarketCap) return false;
    if (f.minLiquidity != null && (t.liquidityUsd ?? 0) < f.minLiquidity) return false;
    if (f.minVolume24h != null && (t.volume.h24 ?? 0) < f.minVolume24h) return false;
    const ageH = t.pairCreatedAt ? (nowMs - t.pairCreatedAt) / 3_600_000 : null;
    if (f.maxAgeHours != null && (ageH == null || ageH > f.maxAgeHours)) return false;
    if (f.minAgeHours != null && (ageH == null || ageH < f.minAgeHours)) return false;
    if (f.minChange1h != null && (t.priceChange.h1 ?? -Infinity) < f.minChange1h) return false;
    if (f.maxChange1h != null && (t.priceChange.h1 ?? Infinity) > f.maxChange1h) return false;
    const tx = (t.txns1h.buys ?? 0) + (t.txns1h.sells ?? 0);
    if (f.minTxns1h != null && tx < f.minTxns1h) return false;
    return true;
  });
}

export interface Candle {
  time: number; // unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** GeckoTerminal ohlcv_list rows are [ts, o, h, l, c, v], newest first. */
export function parseGeckoOhlcv(rows: unknown): Candle[] {
  if (!Array.isArray(rows)) return [];
  const out: Candle[] = [];
  for (const r of rows) {
    if (!Array.isArray(r) || r.length < 6) continue;
    const [t, o, h, l, c, v] = r.map(Number);
    if (![t, o, h, l, c, v].every(Number.isFinite) || o <= 0 || h <= 0 || l <= 0 || c <= 0) continue;
    out.push({ time: t, open: o, high: Math.max(h, o, c), low: Math.min(l, o, c), close: c, volume: Math.max(0, v) });
  }
  out.sort((a, b) => a.time - b.time);
  // de-duplicate timestamps (keep last)
  const dedup: Candle[] = [];
  for (const c of out) {
    if (dedup.length && dedup[dedup.length - 1].time === c.time) dedup[dedup.length - 1] = c;
    else dedup.push(c);
  }
  return dedup;
}
