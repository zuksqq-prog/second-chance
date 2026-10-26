import "server-only";
import { sharedCache } from "./cache";
import { upstream } from "./rate-limit";
import {
  applyFilter,
  bestPair,
  fromDexScreenerPair,
  fromGeckoPool,
  parseGeckoOhlcv,
  WSOL_MINT,
  type Candle,
  type DiscoveryFilter,
  type TokenSnapshot,
} from "@/lib/domain/market";
import { isSolanaAddress } from "@/lib/domain/sanitize";
import { mergeTrades, parseGeckoTrades, type LiveTrade } from "@/lib/domain/live-trades";

/**
 * Market data service.
 *  - DexScreener (no key): token/pair snapshots, search, SOL price.
 *  - GeckoTerminal public API (no key): trending pools, new pools, OHLCV candles.
 * Every call is cached + deduplicated and paced under the providers' public limits.
 * Failures surface as errors — nothing here invents data.
 */

const DS = "https://api.dexscreener.com";
const GT = "https://api.geckoterminal.com/api/v2";

export class UpstreamError extends Error {
  constructor(public provider: string, public status: number, message: string) {
    super(message);
  }
}

async function getJson(provider: keyof typeof upstream, url: string, headers: Record<string, string> = {}) {
  await upstream[provider].acquire("global");
  const res = await fetch(url, {
    headers: { accept: "application/json", ...headers },
    signal: AbortSignal.timeout(8000),
    cache: "no-store",
  });
  if (!res.ok) throw new UpstreamError(provider, res.status, `${provider} responded ${res.status}`);
  return res.json();
}

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Snapshots for up to 30 mints in one request (DexScreener tokens/v1). */
export async function getTokens(mints: string[]): Promise<Map<string, TokenSnapshot>> {
  const valid = [...new Set(mints.filter(isSolanaAddress))];
  const out = new Map<string, TokenSnapshot>();
  for (let i = 0; i < valid.length; i += 30) {
    const chunk = valid.slice(i, i + 30);
    const key = `ds:tokens:${chunk.join(",")}`;
    const pairs: any[] = await sharedCache.get(key, 10_000, () =>
      getJson("dexscreener", `${DS}/tokens/v1/solana/${chunk.join(",")}`),
    );
    const now = Date.now();
    const byMint = new Map<string, TokenSnapshot[]>();
    for (const p of Array.isArray(pairs) ? pairs : []) {
      const s = fromDexScreenerPair(p, now);
      if (s && chunk.includes(s.mint)) byMint.set(s.mint, [...(byMint.get(s.mint) ?? []), s]);
    }
    for (const [m, list] of byMint) {
      const b = bestPair(list);
      if (b) out.set(m, b);
    }
  }
  return out;
}

/** All Solana pools for a token (DexScreener), as snapshots. */
export async function getTokenPairs(mint: string, opts: { fresh?: boolean } = {}): Promise<TokenSnapshot[]> {
  if (!isSolanaAddress(mint)) return [];
  const key = `ds:token-pairs:${mint}`;
  const ttl = opts.fresh ? 3_000 : 10_000;
  const pairs: any[] = await sharedCache.get(key, ttl, () => getJson("dexscreener", `${DS}/token-pairs/v1/solana/${mint}`));
  const now = Date.now();
  return (Array.isArray(pairs) ? pairs : [])
    .map((p) => fromDexScreenerPair(p, now))
    .filter((s): s is TokenSnapshot => !!s && s.mint === mint);
}

export async function getToken(mint: string, opts: { fresh?: boolean } = {}): Promise<TokenSnapshot | null> {
  return bestPair(await getTokenPairs(mint, opts));
}

/**
 * Live swaps for a token across its most active pools (GeckoTerminal trades,
 * last 24h, up to 300 per pool). Each pool is cached for 6 s and shared by all
 * viewers; if a refresh fails, the last good list is served and marked stale.
 */
export async function getLiveTrades(mint: string, maxPools = 2): Promise<{ trades: LiveTrade[]; pools: string[]; stale: boolean }> {
  const pairs = await getTokenPairs(mint);
  const best = bestPair(pairs);
  const supply = best?.marketCap && best.priceUsd ? best.marketCap / best.priceUsd : null;
  const pools = [...pairs]
    .sort((a, b) => (b.volume.h1 ?? 0) - (a.volume.h1 ?? 0) || (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0))
    .slice(0, maxPools)
    .map((p) => p.pairAddress);
  let stale = false;
  const lists = await Promise.all(
    pools.map(async (pool) => {
      const key = `gt:trades:${pool}`;
      try {
        const json = await sharedCache.get(key, 6_000, () =>
          getJson("geckoterminal", `${GT}/networks/solana/pools/${pool}/trades?trade_volume_in_usd_greater_than=0`, {
            accept: "application/json;version=20230302",
          }),
        );
        return parseGeckoTrades(json, mint, pool, supply);
      } catch (e) {
        const old = sharedCache.peek<unknown>(key);
        if (old === undefined) throw e;
        stale = true;
        return parseGeckoTrades(old, mint, pool, supply);
      }
    }),
  );
  return { trades: mergeTrades(lists, 300), pools, stale };
}

export async function searchTokens(q: string): Promise<TokenSnapshot[]> {
  const query = q.trim().slice(0, 64);
  if (!query) return [];
  if (isSolanaAddress(query)) {
    const t = await getToken(query);
    return t ? [t] : [];
  }
  const data: any = await sharedCache.get(`ds:search:${query.toLowerCase()}`, 30_000, () =>
    getJson("dexscreener", `${DS}/latest/dex/search?q=${encodeURIComponent(query)}`),
  );
  const now = Date.now();
  const byMint = new Map<string, TokenSnapshot[]>();
  for (const p of data?.pairs ?? []) {
    const s = fromDexScreenerPair(p, now);
    if (s) byMint.set(s.mint, [...(byMint.get(s.mint) ?? []), s]);
  }
  return [...byMint.values()]
    .map((l) => bestPair(l)!)
    .sort((a, b) => (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0))
    .slice(0, 20);
}

async function geckoPools(path: string, cacheKey: string, ttl: number): Promise<TokenSnapshot[]> {
  const data: any = await sharedCache.get(cacheKey, ttl, () =>
    getJson("geckoterminal", `${GT}${path}`, { accept: "application/json;version=20230302" }),
  );
  const now = Date.now();
  const included: any[] = data?.included ?? [];
  const seen = new Set<string>();
  const out: TokenSnapshot[] = [];
  for (const pool of data?.data ?? []) {
    const s = fromGeckoPool(pool, included, now);
    if (s && !seen.has(s.mint) && s.mint !== WSOL_MINT) {
      seen.add(s.mint);
      out.push(s);
    }
  }
  return out;
}

export type FeedKind = "trending" | "new";

export async function getFeed(kind: FeedKind, filter: DiscoveryFilter = {}, page = 1): Promise<TokenSnapshot[]> {
  const p = Math.min(Math.max(1, Math.floor(page)), 10);
  const list =
    kind === "trending"
      ? await geckoPools(`/networks/solana/trending_pools?include=base_token,quote_token&page=${p}`, `gt:trending:${p}`, 30_000)
      : await geckoPools(`/networks/solana/new_pools?include=base_token,quote_token&page=${p}`, `gt:new:${p}`, 15_000);
  return applyFilter(list, filter, Date.now());
}

export type Timeframe = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";
const TF: Record<Timeframe, { unit: "minute" | "hour" | "day"; agg: number; ttl: number }> = {
  "1m": { unit: "minute", agg: 1, ttl: 10_000 },
  "5m": { unit: "minute", agg: 5, ttl: 20_000 },
  "15m": { unit: "minute", agg: 15, ttl: 45_000 },
  "1h": { unit: "hour", agg: 1, ttl: 60_000 },
  "4h": { unit: "hour", agg: 4, ttl: 120_000 },
  "1d": { unit: "day", agg: 1, ttl: 300_000 },
};

export async function getCandles(pairAddress: string, tf: Timeframe, beforeTs?: number): Promise<Candle[]> {
  if (!isSolanaAddress(pairAddress)) return [];
  const c = TF[tf];
  const before = beforeTs ? `&before_timestamp=${Math.floor(beforeTs)}` : "";
  const url = `${GT}/networks/solana/pools/${pairAddress}/ohlcv/${c.unit}?aggregate=${c.agg}&limit=500&currency=usd&token=base${before}`;
  const data: any = await sharedCache.get(`gt:ohlcv:${pairAddress}:${tf}:${beforeTs ?? "now"}`, c.ttl, () =>
    getJson("geckoterminal", url, { accept: "application/json;version=20230302" }),
  );
  return parseGeckoOhlcv(data?.data?.attributes?.ohlcv_list);
}

/** SOL/USD from the most liquid WSOL pair on DexScreener. */
export async function getSolUsd(): Promise<number | null> {
  return sharedCache.get("sol-usd", 15_000, async () => {
    const pairs: any[] = await getJson("dexscreener", `${DS}/token-pairs/v1/solana/${WSOL_MINT}`);
    const stable = (Array.isArray(pairs) ? pairs : [])
      .filter((p) => p?.baseToken?.address === WSOL_MINT && ["USDC", "USDT"].includes(p?.quoteToken?.symbol))
      .sort((a, b) => (b?.liquidity?.usd ?? 0) - (a?.liquidity?.usd ?? 0));
    const v = Number(stable[0]?.priceUsd);
    return Number.isFinite(v) && v > 0 ? v : null;
  });
}
/* eslint-enable @typescript-eslint/no-explicit-any */
