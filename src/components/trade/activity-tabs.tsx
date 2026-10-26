"use client";

import { useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { ArrowDown, ArrowLeftRight, ExternalLink, Zap } from "lucide-react";
import { fetcher } from "@/lib/client/api";
import { useApp } from "@/lib/client/store";
import { useSession } from "@/lib/client/session";
import type { LiveTradeDTO, TokenSnapshot } from "@/lib/client/types";
import { age, compactUsd, shortAddr, tokenPrice } from "@/lib/domain/format";
import { topTraders, type LiveTrade } from "@/lib/domain/live-trades";
import { PositionsTable } from "@/components/portfolio/positions-table";
import { HistoryTable } from "@/components/portfolio/history-table";
import { TokenInfo } from "./token-info";
import { cn } from "@/lib/utils";

type Tab = "trades" | "positions" | "history" | "holders" | "top" | "info";

interface TradesResponse {
  trades: LiveTradeDTO[];
  pools: string[];
  stale: boolean;
  fetchedAt: number;
}

/**
 * Bottom panel of the trade view. Tab strip styled after pro terminals:
 * plain text tabs, active one bright, contextual controls on the right.
 */
export function ActivityTabs({ token }: { token: TokenSnapshot }) {
  const { instantOpen, setInstantOpen } = useApp();
  const [tab, setTab] = useState<Tab>("trades");
  const [mine, setMine] = useState(false);
  // One fetch shared by Trades and Top Traders; polls only while either is open.
  const live = useSWR<TradesResponse>(tab === "trades" || tab === "top" ? `/api/market/trades?mint=${token.mint}` : null, fetcher, {
    refreshInterval: 5_000,
    keepPreviousData: true,
  });

  const tabs: { id: Tab; label: string }[] = [
    { id: "trades", label: "Trades" },
    { id: "positions", label: "Positions" },
    { id: "history", label: "History" },
    { id: "holders", label: "Holders" },
    { id: "top", label: "Top Traders" },
    { id: "info", label: "Token Info" },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-1 overflow-x-auto border-b border-line px-2">
        <div role="tablist" className="flex items-center">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "h-10 whitespace-nowrap px-3 text-[13px] transition-colors",
                tab === t.id ? "font-medium text-fg" : "text-fg-soft/80 hover:text-fg",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-3 pl-3">
          {tab === "trades" && (
            <button
              type="button"
              onClick={() => setMine((m) => !m)}
              aria-pressed={mine}
              className={cn("text-[13px] transition-colors", mine ? "text-fg" : "text-muted hover:text-fg-soft")}
            >
              Mine
            </button>
          )}
          <button
            type="button"
            onClick={() => setInstantOpen((o) => !o)}
            aria-pressed={instantOpen}
            className={cn(
              "flex h-7 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition-colors",
              instantOpen ? "border-buy bg-buy/15 text-buy" : "border-buy/60 text-buy hover:bg-buy/10",
            )}
          >
            <Zap size={13} fill="currentColor" />
            Instant Trade
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {tab === "trades" && <TradesFeed token={token} data={live.data} error={live.error} mine={mine} />}
        {tab === "positions" && <PositionsTable compact />}
        {tab === "history" && <HistoryTable mint={token.mint} />}
        {tab === "holders" && <Holders token={token} />}
        {tab === "top" && <TopTraders data={live.data} error={live.error} />}
        {tab === "info" && <TokenInfo token={token} />}
      </div>
    </div>
  );
}

function TradesFeed({ token, data, error, mine }: { token: TokenSnapshot; data?: TradesResponse; error: unknown; mine: boolean }) {
  const { mode } = useApp();
  const { wallet } = useSession();
  const [timeMode, setTimeMode] = useState<"age" | "time">("age");
  const [valueMode, setValueMode] = useState<"mc" | "price">("mc");
  const seen = useRef<Set<string> | null>(null);

  const trades = useMemo(() => {
    const all = data?.trades ?? [];
    return mine ? all.filter((t) => wallet && t.trader === wallet) : all;
  }, [data, mine, wallet]);
  const maxUsd = useMemo(() => Math.max(1, ...trades.slice(0, 100).map((t) => t.volumeUsd)), [trades]);

  // Flash rows that arrived since the previous poll (not on first load). Computed once per response.
  const fresh = useMemo(() => {
    const f = new Set<string>();
    if (!data) return f;
    if (seen.current) for (const t of data.trades) if (!seen.current.has(t.id)) f.add(t.id);
    seen.current = new Set(data.trades.map((t) => t.id));
    return f;
  }, [data]);
  const now = Date.now();

  if (error && !data) return <Note>Connecting to the live trade feed… The free data provider is busy; retrying every few seconds.</Note>;
  if (!data) return <SkeletonRows />;

  return (
    <div>
      {data.stale && <p className="border-b border-line bg-signal-soft px-3 py-1 text-2xs text-signal">Showing the last trades received. The trade feed is rate limited and will resume shortly.</p>}
      <table className="w-full min-w-[760px] text-xs">
        <thead className="sticky top-0 z-10 bg-ink-0 text-2xs text-muted">
          <tr className="border-b border-line">
            <th className="py-2 pl-4 text-left font-normal">
              <button type="button" onClick={() => setTimeMode((m) => (m === "age" ? "time" : "age"))} className="flex items-center gap-1 hover:text-fg">
                <span className={timeMode === "age" ? "text-buy" : ""}>Age</span>
                {timeMode === "age" && <ArrowDown size={11} className="text-buy" />}
                <span className="text-muted/60">/</span>
                <span className={timeMode === "time" ? "text-buy" : ""}>Time</span>
              </button>
            </th>
            <th className="px-2 text-left font-normal">Type</th>
            <th className="px-2 text-left font-normal">
              <button type="button" onClick={() => setValueMode((m) => (m === "mc" ? "price" : "mc"))} className="flex items-center gap-1 hover:text-fg" title="Switch between market cap and price">
                {valueMode === "mc" ? "MC" : "Price"} <ArrowLeftRight size={11} />
              </button>
            </th>
            <th className="px-2 text-left font-normal">Amount</th>
            <th className="px-2 text-left font-normal">Total USD</th>
            <th className="pr-4 text-right font-normal">Trader</th>
          </tr>
        </thead>
        <tbody className="font-mono">
          {trades.length === 0 && (
            <tr>
              <td colSpan={6} className="px-4 py-6 text-center font-sans text-xs text-muted">
                {mine
                  ? mode === "paper"
                    ? "Paper trades are simulated, so they never appear on-chain. Switch to Real mode to see your own swaps here."
                    : "None of your swaps are among the latest trades for this token."
                  : "No trades in the last 24 hours on this token's most active pools."}
              </td>
            </tr>
          )}
          {trades.map((t) => {
            const buy = t.kind === "buy";
            const own = !!wallet && t.trader === wallet;
            return (
              <tr
                key={t.id}
                className={cn("border-b border-line/50 hover:bg-ink-1", fresh.has(t.id) && "animate-tick", own && "bg-signal-soft/40")}
                style={fresh.has(t.id) ? ({ ["--tick" as string]: buy ? "#38c98b22" : "#ee5d6622" } as React.CSSProperties) : undefined}
              >
                <td className="py-[7px] pl-4 text-muted" title={new Date(t.timestamp).toLocaleString()}>
                  {timeMode === "age" ? age(t.timestamp, now) : new Date(t.timestamp).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                </td>
                <td className={cn("px-2", buy ? "text-buy" : "text-sell")}>{buy ? "Buy" : "Sell"}</td>
                <td className="px-2 text-fg-soft">{valueMode === "mc" ? compactUsd(t.marketCap) : `$${tokenPrice(t.priceUsd)}`}</td>
                <td className="px-2 text-fg-soft">{fmtAmount(t.tokenAmount)}</td>
                <td className="relative px-2">
                  <span
                    aria-hidden
                    className={cn("absolute inset-y-1 left-0 rounded-sm", buy ? "bg-buy/10" : "bg-sell/10")}
                    style={{ width: `${Math.max(2, Math.min(100, (t.volumeUsd / maxUsd) * 100)) * 0.9}%` }}
                  />
                  <span className={cn("relative", buy ? "text-buy" : "text-sell")}>{fmtUsd(t.volumeUsd)}</span>
                </td>
                <td className="pr-4 text-right">
                  {t.trader ? (
                    <span className="inline-flex items-center gap-2">
                      <span className={cn(own ? "text-signal" : "text-fg-soft")}>{own ? "You" : shortAddr(t.trader, 3)}</span>
                      <a href={`https://solscan.io/tx/${t.txHash}`} target="_blank" rel="noreferrer" aria-label="View transaction on Solscan" className="text-muted hover:text-fg">
                        <ExternalLink size={12} />
                      </a>
                    </span>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {trades.length > 0 && (
        <p className="px-4 py-2 font-sans text-2xs text-muted">
          Swaps from every wallet and app on {data.pools.length === 1 ? "the most active pool" : `the ${data.pools.length} most active pools`} for {token.symbol}. Updates every few seconds.
        </p>
      )}
    </div>
  );
}

function TopTraders({ data, error }: { data?: TradesResponse; error: unknown }) {
  const { wallet } = useSession();
  const rows = useMemo(() => topTraders((data?.trades ?? []) as LiveTrade[]), [data]);
  if (error && !data) return <Note tone="error">Trades are unavailable right now: {(error as Error).message}</Note>;
  if (!data) return <SkeletonRows />;
  const span = data.trades.length ? data.trades[0].timestamp - data.trades[data.trades.length - 1].timestamp : 0;
  return (
    <div>
      <p className="px-4 py-2 text-2xs text-muted">
        Ranked by volume over the latest {data.trades.length} trades (about the last {humanSpan(span)}). Net is USD sold minus bought in that window, not lifetime profit.
      </p>
      <table className="w-full min-w-[640px] text-xs">
        <thead className="sticky top-0 bg-ink-0 text-2xs text-muted">
          <tr className="border-b border-line">
            <th className="py-2 pl-4 text-left font-normal">Trader</th>
            <th className="px-2 text-right font-normal">Bought</th>
            <th className="px-2 text-right font-normal">Sold</th>
            <th className="px-2 text-right font-normal">Net</th>
            <th className="pr-4 text-right font-normal">Txns</th>
          </tr>
        </thead>
        <tbody className="font-mono">
          {rows.map((r) => (
            <tr key={r.trader} className="border-b border-line/50">
              <td className="py-[7px] pl-4">
                <a href={`https://solscan.io/account/${r.trader}`} target="_blank" rel="noreferrer" className={cn("hover:underline", r.trader === wallet ? "text-signal" : "text-fg-soft")}>
                  {r.trader === wallet ? "You" : shortAddr(r.trader, 4)}
                </a>
              </td>
              <td className="px-2 text-right text-buy">{fmtUsd(r.boughtUsd)}</td>
              <td className="px-2 text-right text-sell">{fmtUsd(r.soldUsd)}</td>
              <td className={cn("px-2 text-right", r.netUsd >= 0 ? "text-buy" : "text-sell")}>
                {r.netUsd >= 0 ? "+" : "-"}
                {fmtUsd(Math.abs(r.netUsd))}
              </td>
              <td className="pr-4 text-right text-fg-soft">
                <span className="text-buy">{r.buys}</span>
                <span className="text-muted"> / </span>
                <span className="text-sell">{r.sells}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface Security {
  supplyRaw: string;
  decimals: number;
  top10Percent: number | null;
  topHolders: { address: string; percent: number }[];
}

function Holders({ token }: { token: TokenSnapshot }) {
  const { data, error } = useSWR<{ security: Security }>(`/api/market/security/${token.mint}`, fetcher, { refreshInterval: 60_000 });
  if (error) return <Note tone="error">{(error as Error).message}</Note>;
  if (!data) return <SkeletonRows />;
  const s = data.security;
  const supply = Number(s.supplyRaw) / 10 ** s.decimals;
  if (!s.topHolders.length) return <Note>Your Solana RPC doesn't return largest-holder data. Add a Helius key to enable it.</Note>;
  return (
    <div>
      <p className="px-4 py-2 text-2xs text-muted">
        Largest token accounts. Top 10 hold {s.top10Percent?.toFixed(1)}% of supply. Pool vaults are included, so the top entries are often liquidity, not people.
      </p>
      <table className="w-full min-w-[560px] text-xs">
        <thead className="sticky top-0 bg-ink-0 text-2xs text-muted">
          <tr className="border-b border-line">
            <th className="py-2 pl-4 text-left font-normal">#</th>
            <th className="px-2 text-left font-normal">Account</th>
            <th className="px-2 text-right font-normal">Amount</th>
            <th className="px-2 text-right font-normal">Value</th>
            <th className="pr-4 text-left font-normal">Share</th>
          </tr>
        </thead>
        <tbody className="font-mono">
          {s.topHolders.map((h, i) => {
            const amount = (h.percent / 100) * supply;
            return (
              <tr key={h.address} className="border-b border-line/50">
                <td className="py-[7px] pl-4 text-muted">{i + 1}</td>
                <td className="px-2">
                  <a href={`https://solscan.io/account/${h.address}`} target="_blank" rel="noreferrer" className="text-fg-soft hover:underline">
                    {shortAddr(h.address, 4)}
                  </a>
                </td>
                <td className="px-2 text-right text-fg-soft">{fmtAmount(amount)}</td>
                <td className="px-2 text-right text-fg-soft">{token.priceUsd ? compactUsd(amount * token.priceUsd) : "—"}</td>
                <td className="pr-4">
                  <div className="flex items-center gap-2">
                    <span className="h-1 w-20 rounded-full bg-ink-3">
                      <span className="block h-full rounded-full bg-fg-soft/60" style={{ width: `${Math.min(100, h.percent)}%` }} />
                    </span>
                    <span className="text-fg-soft">{h.percent.toFixed(2)}%</span>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Note({ children, tone }: { children: React.ReactNode; tone?: "error" }) {
  return <p className={cn("px-4 py-6 text-center text-xs", tone === "error" ? "text-sell" : "text-muted")}>{children}</p>;
}

function SkeletonRows() {
  return (
    <div className="flex flex-col gap-2 p-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-4 animate-pulse rounded bg-ink-2" />
      ))}
    </div>
  );
}

export function fmtUsd(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n >= 1000) return compactUsd(n);
  return `$${n.toFixed(2)}`;
}

function fmtAmount(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e4) return `${(n / 1e3).toFixed(1)}K`;
  if (n >= 100) return n.toFixed(1);
  return n.toPrecision(3).replace(/\.?0+$/, "");
}

function humanSpan(ms: number): string {
  const m = Math.round(ms / 60_000);
  if (m < 1) return "minute";
  if (m < 60) return `${m} minutes`;
  const h = Math.round(m / 60);
  return h === 1 ? "hour" : `${h} hours`;
}
