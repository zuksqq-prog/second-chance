"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { RefreshCw, SlidersHorizontal, Star } from "lucide-react";
import { fetcher, post } from "@/lib/client/api";
import { useApp } from "@/lib/client/store";
import { useSession } from "@/lib/client/session";
import type { TokenSnapshot } from "@/lib/client/types";
import { age, compactUsd, parseCompact, pct } from "@/lib/domain/format";
import { Segmented } from "@/components/ui/segmented";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TokenAvatar } from "@/components/ui/token-avatar";
import { cn } from "@/lib/utils";

type Kind = "trending" | "new";
interface Filters {
  minMarketCap: string;
  maxMarketCap: string;
  minLiquidity: string;
  minVolume24h: string;
  maxAgeHours: string;
  minChange1h: string;
  minTxns1h: string;
}
const EMPTY: Filters = { minMarketCap: "", maxMarketCap: "", minLiquidity: "", minVolume24h: "", maxAgeHours: "", minChange1h: "", minTxns1h: "" };

export function DiscoverView() {
  const [kind, setKind] = useState<Kind>("trending");
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [showFilters, setShowFilters] = useState(false);

  const query = useMemo(() => {
    const p = new URLSearchParams({ kind });
    const money = (k: keyof Filters) => {
      const v = parseCompact(filters[k]);
      if (v != null) p.set(k, String(v));
    };
    money("minMarketCap");
    money("maxMarketCap");
    money("minLiquidity");
    money("minVolume24h");
    for (const k of ["maxAgeHours", "minChange1h", "minTxns1h"] as const) if (filters[k].trim() && Number.isFinite(Number(filters[k]))) p.set(k, filters[k].trim());
    return p.toString();
  }, [kind, filters]);

  const { data, error, isLoading, isValidating, mutate } = useSWR<{ tokens: TokenSnapshot[]; fetchedAt: number }>(`/api/market/feed?${query}`, fetcher, {
    refreshInterval: kind === "new" ? 15_000 : 30_000,
    keepPreviousData: true,
  });
  const active = Object.values(filters).filter(Boolean).length;

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <Segmented
          value={kind}
          onChange={setKind}
          options={[
            { value: "trending", label: "Trending" },
            { value: "new", label: "New pairs" },
          ]}
        />
        <Button variant={showFilters || active ? "default" : "ghost"} size="sm" onClick={() => setShowFilters((s) => !s)} aria-expanded={showFilters}>
          <SlidersHorizontal size={13} /> Filters{active ? ` (${active})` : ""}
        </Button>
        <span className="ml-auto flex items-center gap-2 text-2xs text-muted">
          {data && <span className="num">Updated {age(data.fetchedAt)} ago · GeckoTerminal</span>}
          <Button variant="ghost" size="icon" onClick={() => mutate()} aria-label="Refresh">
            <RefreshCw size={13} className={cn(isValidating && "animate-spin")} />
          </Button>
        </span>
      </div>

      {showFilters && (
        <div className="grid grid-cols-2 gap-2 border-b border-line bg-ink-1 px-3 py-3 sm:grid-cols-4 lg:grid-cols-8">
          <FilterInput label="Min mcap" placeholder="100k" value={filters.minMarketCap} onChange={(v) => setFilters({ ...filters, minMarketCap: v })} />
          <FilterInput label="Max mcap" placeholder="10m" value={filters.maxMarketCap} onChange={(v) => setFilters({ ...filters, maxMarketCap: v })} />
          <FilterInput label="Min liquidity" placeholder="20k" value={filters.minLiquidity} onChange={(v) => setFilters({ ...filters, minLiquidity: v })} />
          <FilterInput label="Min 24h vol" placeholder="50k" value={filters.minVolume24h} onChange={(v) => setFilters({ ...filters, minVolume24h: v })} />
          <FilterInput label="Max age (h)" placeholder="24" value={filters.maxAgeHours} onChange={(v) => setFilters({ ...filters, maxAgeHours: v })} />
          <FilterInput label="Min 1h change %" placeholder="0" value={filters.minChange1h} onChange={(v) => setFilters({ ...filters, minChange1h: v })} />
          <FilterInput label="Min 1h txns" placeholder="50" value={filters.minTxns1h} onChange={(v) => setFilters({ ...filters, minTxns1h: v })} />
          <div className="flex items-end">
            <Button variant="quiet" size="sm" onClick={() => setFilters(EMPTY)} disabled={!active}>
              Clear filters
            </Button>
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        {error && !data && (
          <div className="m-4 rounded border border-sell/30 bg-sell-soft p-4 text-xs text-sell">
            {(error as Error).message} The feed retries automatically.
          </div>
        )}
        <TokenTable tokens={data?.tokens ?? []} loading={isLoading && !data} />
        {data && data.tokens.length === 0 && <p className="p-6 text-center text-xs text-muted">No tokens match these filters right now. Loosen a filter or switch feeds.</p>}
      </div>
    </div>
  );
}

function FilterInput({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder: string }) {
  const id = `f-${label.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-2xs text-muted">{label}</label>
      <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="h-7 text-xs" />
    </div>
  );
}

export function TokenTable({ tokens, loading, onRemove }: { tokens: TokenSnapshot[]; loading?: boolean; onRemove?: (mint: string) => void }) {
  const { selectToken, toast } = useApp();
  const { status } = useSession();
  const now = Date.now();
  return (
    <table className="w-full min-w-[860px] text-xs">
      <thead className="sticky top-0 z-10 bg-ink-0 text-2xs text-muted">
        <tr className="border-b border-line">
          <th className="py-2 pl-3 text-left font-normal">Token</th>
          <th className="px-2 text-right font-normal">Age</th>
          <th className="px-2 text-right font-normal">Market cap</th>
          <th className="px-2 text-right font-normal">Liquidity</th>
          <th className="px-2 text-right font-normal">Vol 24h</th>
          <th className="px-2 text-right font-normal">5m</th>
          <th className="px-2 text-right font-normal">1h</th>
          <th className="px-2 text-right font-normal">24h</th>
          <th className="px-2 text-left font-normal">Txns 1h</th>
          <th className="w-10 pr-3" />
        </tr>
      </thead>
      <tbody>
        {loading &&
          Array.from({ length: 12 }).map((_, i) => (
            <tr key={i} className="border-b border-line/60">
              <td colSpan={10} className="px-3 py-2.5">
                <div className="h-4 w-full animate-pulse rounded bg-ink-2" />
              </td>
            </tr>
          ))}
        {tokens.map((t) => {
          const buys = t.txns1h.buys ?? 0;
          const sells = t.txns1h.sells ?? 0;
          const total = buys + sells;
          return (
            <tr key={t.mint} onClick={() => selectToken(t)} className="cursor-pointer border-b border-line/60 hover:bg-ink-1">
              <td className="py-2 pl-3">
                <div className="flex items-center gap-2.5">
                  <TokenAvatar src={t.imageUrl} symbol={t.symbol} size={26} />
                  <div className="min-w-0">
                    <div className="flex items-baseline gap-1.5">
                      <span className="font-medium text-[13px]">{t.symbol}</span>
                      <span className="max-w-[160px] truncate text-muted">{t.name}</span>
                    </div>
                    <div className="text-2xs text-muted/80">{t.dexId}</div>
                  </div>
                </div>
              </td>
              <td className="px-2 text-right text-fg-soft num">{age(t.pairCreatedAt, now)}</td>
              <td className="px-2 text-right num" title={t.marketCapIsFdv ? "FDV (circulating market cap not reported)" : undefined}>
                {compactUsd(t.marketCap)}
                {t.marketCapIsFdv && <span className="text-muted">*</span>}
              </td>
              <td className={cn("px-2 text-right num", (t.liquidityUsd ?? 0) < 10_000 && "text-sell")}>{compactUsd(t.liquidityUsd)}</td>
              <td className="px-2 text-right num">{compactUsd(t.volume.h24)}</td>
              <Change v={t.priceChange.m5} />
              <Change v={t.priceChange.h1} />
              <Change v={t.priceChange.h24} />
              <td className="px-2">
                {total > 0 ? (
                  <div className="flex items-center gap-2">
                    <span className="w-9 text-right text-fg-soft num">{total}</span>
                    <span className="flex h-1.5 w-16 overflow-hidden rounded-full bg-sell/70">
                      <span className="bg-buy" style={{ width: `${(buys / total) * 100}%` }} />
                    </span>
                  </div>
                ) : (
                  <span className="text-muted">—</span>
                )}
              </td>
              <td className="pr-3 text-right">
                <button
                  type="button"
                  aria-label={onRemove ? `Remove ${t.symbol} from watchlist` : `Add ${t.symbol} to watchlist`}
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (onRemove) return onRemove(t.mint);
                    if (status !== "signed_in") return toast({ tone: "info", title: "Sign in to use watchlists" });
                    try {
                      await post("/api/watchlist", { mint: t.mint, symbol: t.symbol });
                      toast({ tone: "ok", title: `Watching ${t.symbol}` });
                    } catch (err) {
                      toast({ tone: "error", title: "Couldn't add to watchlist", body: (err as Error).message });
                    }
                  }}
                  className={cn("rounded p-1 hover:bg-ink-3", onRemove ? "text-signal" : "text-muted hover:text-signal")}
                >
                  <Star size={13} fill={onRemove ? "currentColor" : "none"} />
                </button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Change({ v }: { v: number | null }) {
  return <td className={cn("px-2 text-right num", v == null ? "text-muted" : v >= 0 ? "up" : "down")}>{pct(v)}</td>;
}
