"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { Copy, Globe, Pause, Search, Send, SlidersHorizontal, Users, Zap } from "lucide-react";
import { fetcher } from "@/lib/client/api";
import { useApp } from "@/lib/client/store";
import { useSession } from "@/lib/client/session";
import { useSettings } from "@/lib/client/hooks";
import { useTradeFlow } from "@/lib/client/trade-flow";
import type { PulseItem } from "@/lib/domain/pulse";
import { age, compactUsd, shortAddr } from "@/lib/domain/format";
import { toRaw } from "@/lib/domain/portfolio";
import { TokenAvatar } from "@/components/ui/token-avatar";
import { cn } from "@/lib/utils";
import { countActive, matchesFilter } from "@/lib/domain/pulse-filters";
import { emptyFilters, PulseFiltersPanel, sanitizeFilters, type PulseFilters } from "./pulse-filters-panel";

interface PulseResponse {
  newPairs: PulseItem[];
  finalStretch: PulseItem[];
  migrated: PulseItem[];
  updatedAt: number;
  notes: string[];
}

type ColKey = "newPairs" | "finalStretch" | "migrated";
const FILTERS_KEY = "sc.pulseFilters";
const COLS: { key: ColKey; title: string; empty: string }[] = [
  { key: "newPairs", title: "New Pairs", empty: "Waiting for new launches…" },
  { key: "finalStretch", title: "Final Stretch", empty: "No pump.fun tokens are close to bonding right now." },
  { key: "migrated", title: "Migrated", empty: "No graduations in the last 24 hours on the tracked pools." },
];

/**
 * Launchpad lifecycle board: fresh launches → nearly bonded → graduated.
 * Each column has its own search, quick-buy amount, and pauses while hovered
 * so cards don't jump under the cursor.
 */
export function PulseBoard() {
  const { data, error } = useSWR<PulseResponse>("/api/market/pulse", fetcher, { refreshInterval: 6_000, keepPreviousData: true });
  const [mobileCol, setMobileCol] = useState<ColKey>("newPairs");
  const flow = useTradeFlow();
  const { mode, toast } = useApp();
  const session = useSession();
  const { settings } = useSettings();
  const [filters, setFilters] = useState<PulseFilters>(emptyFilters);
  const [panel, setPanel] = useState<{ open: boolean; col: ColKey }>({ open: false, col: "newPairs" });
  useEffect(() => {
    try {
      const raw = localStorage.getItem(FILTERS_KEY);
      const parsed = raw ? sanitizeFilters(JSON.parse(raw)) : null;
      if (parsed) setFilters(parsed);
    } catch {
      /* ignore */
    }
  }, []);
  const applyFilters = (f: PulseFilters) => {
    setFilters(f);
    try {
      localStorage.setItem(FILTERS_KEY, JSON.stringify(f));
    } catch {
      /* ignore */
    }
  };

  const quickBuy = (t: PulseItem, amount: string) => {
    if (session.status !== "signed_in") return toast({ tone: "info", title: "Connect and sign in to quick buy" });
    if (mode === "real" && !session.realTrading.enabled) return toast({ tone: "info", title: "Real trading is off", body: session.realTrading.reason ?? undefined });
    if (!["idle", "done", "failed"].includes(flow.state.phase)) return toast({ tone: "info", title: "A trade is already in progress" });
    let raw: bigint;
    try {
      raw = toRaw(amount, 9);
    } catch {
      return toast({ tone: "error", title: "Set a quick-buy amount like 0.1" });
    }
    if (raw <= 0n) return;
    void flow.start({
      side: "buy",
      mint: t.mint,
      symbol: t.symbol,
      amountRaw: raw.toString(),
      opts: { slippageBps: settings.instant.buySlippageBps, priorityFeeLamports: settings.instant.buyPriorityLamports },
      thesisDraft: null,
      marketCap: t.marketCap,
    });
  };

  useEffect(() => {
    if (flow.state.phase === "failed") {
      toast({ tone: "error", title: `Quick buy ${flow.state.symbol ?? ""} failed`, body: flow.state.error ?? undefined });
      flow.reset();
    } else if (flow.state.phase === "done") flow.reset();
  }, [flow, toast]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {data?.notes?.length ? <p className="border-b border-line bg-signal-soft px-3 py-1 text-2xs text-signal">{data.notes.join(" ")}</p> : null}
      {error && !data && <p className="border-b border-line bg-signal-soft px-3 py-1.5 text-xs text-signal">Connecting to live launch data… The free data provider is busy; retrying every few seconds.</p>}
      {/* phone: one column at a time */}
      <div className="flex border-b border-line md:hidden">
        {COLS.map((c) => (
          <button key={c.key} type="button" onClick={() => setMobileCol(c.key)} className={cn("flex-1 py-2 text-xs", mobileCol === c.key ? "text-fg" : "text-muted")}>
            {c.title}
          </button>
        ))}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 p-2 md:grid-cols-3">
        {COLS.map((c) => (
          <Column
            key={c.key}
            id={c.key}
            title={c.title}
            empty={c.empty}
            items={data?.[c.key]}
            filter={filters[c.key]}
            onOpenFilters={() => setPanel({ open: true, col: c.key })}
            onBuy={quickBuy}
            className={cn(mobileCol !== c.key && "max-md:hidden")}
            defaultAmount={c.key === "newPairs" ? "0.1" : c.key === "finalStretch" ? "0.25" : "0.5"}
          />
        ))}
      </div>
      <PulseFiltersPanel open={panel.open} initialCol={panel.col} applied={filters} onApply={applyFilters} onClose={() => setPanel((p) => ({ ...p, open: false }))} />
    </div>
  );
}

function Column({
  id,
  title,
  empty,
  items,
  filter,
  onOpenFilters,
  onBuy,
  className,
  defaultAmount,
}: {
  id: ColKey;
  title: string;
  empty: string;
  items: PulseItem[] | undefined;
  filter: PulseFilters[ColKey];
  onOpenFilters: () => void;
  onBuy: (t: PulseItem, amount: string) => void;
  className?: string;
  defaultAmount: string;
}) {
  const [q, setQ] = useState("");
  const [amount, setAmount] = useState(defaultAmount);
  const [hover, setHover] = useState(false);
  const frozen = useRef<PulseItem[] | undefined>(undefined);

  // Remember the quick-buy amount per column.
  useEffect(() => {
    try {
      const v = localStorage.getItem(`sc.qb.${id}`);
      if (v && /^\d+(\.\d+)?$/.test(v)) setAmount(v);
    } catch {
      /* ignore */
    }
  }, [id]);
  const saveAmount = (v: string) => {
    setAmount(v);
    try {
      localStorage.setItem(`sc.qb.${id}`, v);
    } catch {
      /* ignore */
    }
  };

  // Pause updates while the pointer is over the list.
  if (!hover) frozen.current = items;
  const shown = hover ? frozen.current : items;

  const active = countActive(filter).total;
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    const now = Date.now();
    return (shown ?? []).filter(
      (t) => matchesFilter(t, filter, now) && (!s || t.symbol.toLowerCase().includes(s) || t.name.toLowerCase().includes(s) || t.mint.toLowerCase() === s),
    );
  }, [shown, q, filter]);

  return (
    <section className={cn("flex min-h-0 flex-col overflow-hidden rounded-lg border border-line bg-ink-1", className)} aria-label={title}>
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-3">
        <h2 className="text-[15px] font-medium">{title}</h2>
        {hover && (
          <span className="flex items-center gap-1 text-2xs text-signal" title="Updates paused while you hover">
            <Pause size={10} fill="currentColor" /> Paused
          </span>
        )}
        <div className="relative ml-auto w-full max-w-[170px]">
          <Search size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted" />
          <input
            id={`pulse-search-${id}`}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by ticker or name"
            aria-label={`Search ${title}`}
            className="h-7 w-full rounded-full border border-line bg-ink-0 pl-6 pr-2 text-2xs placeholder:text-muted/70 focus:border-signal/60 focus:outline-none"
          />
        </div>
        <label className="flex h-7 items-center gap-1 rounded-full border border-line bg-ink-0 px-2 text-xs" title="Quick-buy amount (SOL)">
          <Zap size={12} className="text-buy" />
          <input
            id={`pulse-amount-${id}`}
            value={amount}
            onChange={(e) => saveAmount(e.target.value.replace(/[^\d.]/g, ""))}
            inputMode="decimal"
            aria-label={`${title} quick-buy amount in SOL`}
            className="w-9 bg-transparent text-xs num focus:outline-none"
          />
        </label>
        <button type="button" onClick={onOpenFilters} aria-label={`${title} filters`} title="Filters" className="relative rounded p-1 text-fg-soft hover:bg-ink-3 hover:text-fg">
          <SlidersHorizontal size={15} />
          {active > 0 && <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-buy" />}
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
        {!shown && Array.from({ length: 6 }).map((_, i) => <div key={i} className="m-3 h-[92px] animate-pulse rounded bg-ink-2" />)}
        {shown && filtered.length === 0 && (
          <p className="p-6 text-center text-xs text-muted">
            {q ? `Nothing matches “${q}”.` : active ? `No tokens match your ${active} filter${active === 1 ? "" : "s"} right now.` : empty}
            {active > 0 && (
              <button type="button" onClick={onOpenFilters} className="mt-2 block w-full text-signal underline">
                Edit filters
              </button>
            )}
          </p>
        )}
        {filtered.map((t) => (
          <Card key={t.mint} t={t} amount={amount} onBuy={onBuy} showProgress={id !== "migrated"} />
        ))}
      </div>
    </section>
  );
}

function Card({ t, amount, onBuy, showProgress }: { t: PulseItem; amount: string; onBuy: (t: PulseItem, amount: string) => void; showProgress: boolean }) {
  const { selectToken } = useApp();
  const [copied, setCopied] = useState(false);
  const buys = t.buys24h ?? 0;
  const sells = t.sells24h ?? 0;
  const tx = buys + sells;
  const progress = t.bondingProgress;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => selectToken(t)}
      onKeyDown={(e) => e.key === "Enter" && selectToken(t)}
      className="group flex cursor-pointer gap-3 border-b border-line/70 px-3 py-3 hover:bg-ink-2/60"
    >
      {/* image + progress ring */}
      <div className="flex w-[74px] shrink-0 flex-col items-center gap-1">
        <div className="relative">
          <ProgressRing value={showProgress ? progress : null} migrated={!showProgress}>
            <TokenAvatar src={t.imageUrl} symbol={t.symbol} size={64} className="rounded-md" />
          </ProgressRing>
          <span className="absolute -bottom-1 -right-1 rounded-full border border-ink-1 bg-ink-3 px-1 text-[9px] leading-4 text-fg-soft" title={t.dexLabel}>
            {t.dexLabel.slice(0, 4)}
          </span>
        </div>
        <span className="font-mono text-[10px] text-muted">{shortAddr(t.mint, 4)}</span>
      </div>

      {/* middle */}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5">
          <span className="truncate text-[15px] font-semibold">{t.symbol}</span>
          <span className="truncate text-[13px] text-muted">{t.name}</span>
          <button
            type="button"
            aria-label="Copy contract address"
            onClick={(e) => {
              e.stopPropagation();
              navigator.clipboard?.writeText(t.mint).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1000);
              }).catch(() => null);
            }}
            className={cn("shrink-0", copied ? "text-buy" : "text-muted hover:text-fg")}
          >
            <Copy size={11} />
          </button>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span className="text-buy num">{age(t.pairCreatedAt)}</span>
          <span className="flex items-center gap-1 text-fg-soft" title="Unique buyers in the last hour">
            <Users size={12} className="text-muted" />
            <span className="num">{t.buyers1h ?? "—"}</span>
          </span>
          {showProgress && progress != null && (
            <span className="text-fg-soft num" title="Bonding curve progress (on-chain)">
              {progress.toFixed(progress >= 99 ? 1 : 0)}% bonded
            </span>
          )}
        </div>
        {t.socials && (t.socials.twitter || t.socials.website || t.socials.telegram || t.socials.dexPaid) && (
          <div className="mt-1 flex items-center gap-2 text-xs">
            {t.socials.twitter && (
              <a
                href={t.socials.twitter.startsWith("http") ? t.socials.twitter : `https://x.com/${t.socials.twitter}`}
                target="_blank"
                rel="noreferrer nofollow"
                onClick={(e) => e.stopPropagation()}
                className="max-w-[120px] truncate text-[#7cc4ff] hover:underline"
              >
                {t.socials.twitter.startsWith("http") ? "X link" : `@${t.socials.twitter}`}
              </a>
            )}
            {t.socials.website && (
              <a href={t.socials.website} target="_blank" rel="noreferrer nofollow" onClick={(e) => e.stopPropagation()} aria-label="Website" className="text-muted hover:text-fg">
                <Globe size={12} />
              </a>
            )}
            {t.socials.telegram && (
              <a href={t.socials.telegram} target="_blank" rel="noreferrer nofollow" onClick={(e) => e.stopPropagation()} aria-label="Telegram" className="text-muted hover:text-fg">
                <Send size={12} />
              </a>
            )}
            {t.socials.dexPaid && <span className="rounded-sm border border-buy/40 px-1 text-[10px] text-buy" title="Paid DexScreener profile">DS</span>}
          </div>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <Chip label="5m" v={t.priceChange.m5} />
          <Chip label="1h" v={t.priceChange.h1} />
          <span className="text-muted" title="Liquidity">
            L <span className="text-fg-soft num">{compactUsd(t.liquidityUsd)}</span>
          </span>
        </div>
      </div>

      {/* right */}
      <div className="flex shrink-0 flex-col items-end justify-between">
        <div className="text-right">
          <div className="text-xs text-muted">
            V <span className="text-[14px] font-medium text-fg num">{compactUsd(t.volume.h24)}</span>
            <span className="ml-2">MC</span> <span className="text-[14px] font-semibold text-[#7cc4ff] num">{compactUsd(t.marketCap)}</span>
          </div>
          <div className="mt-1 flex items-center justify-end gap-1.5 text-xs text-muted">
            TX <span className="text-fg-soft num">{tx}</span>
            <span className="flex h-[3px] w-8 overflow-hidden rounded-full bg-sell/80" aria-hidden>
              <span className="bg-buy" style={{ width: tx ? `${(buys / tx) * 100}%` : "0%" }} />
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onBuy(t, amount);
          }}
          className="flex h-7 items-center gap-1 rounded-full bg-buy px-3 text-xs font-semibold text-ink-0 transition-[filter] hover:brightness-110"
        >
          <Zap size={12} fill="currentColor" /> {amount || "0"} SOL
        </button>
      </div>
    </div>
  );
}

function Chip({ label, v }: { label: string; v: number | null }) {
  return (
    <span className="text-muted">
      {label}{" "}
      <span className={cn("num", v == null ? "text-muted" : v >= 0 ? "text-buy" : "text-sell")}>
        {v == null ? "—" : `${v >= 0 ? "+" : ""}${Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1)}%`}
      </span>
    </span>
  );
}

/** Rounded-square ring around the token image filled by bonding progress. */
function ProgressRing({ value, migrated, children }: { value: number | null; migrated: boolean; children: React.ReactNode }) {
  const p = value == null ? 0 : Math.max(0, Math.min(100, value));
  const color = migrated ? "#e9a23b" : p >= 80 ? "#38c98b" : p >= 45 ? "#7cc4ff" : "#38c98b";
  return (
    <div
      className="rounded-[9px] p-[2px]"
      style={{ background: migrated ? color : `conic-gradient(${color} ${p * 3.6}deg, #242b36 0deg)` }}
      title={migrated ? "Migrated" : value == null ? undefined : `${p.toFixed(1)}% bonded`}
    >
      <div className="rounded-[7px] bg-ink-1 p-[2px]">{children}</div>
    </div>
  );
}
