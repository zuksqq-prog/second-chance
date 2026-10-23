"use client";

import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { Search } from "lucide-react";
import { fetcher } from "@/lib/client/api";
import { useApp } from "@/lib/client/store";
import type { TokenSnapshot } from "@/lib/client/types";
import { compactUsd, pct, shortAddr } from "@/lib/domain/format";
import { TokenAvatar } from "@/components/ui/token-avatar";
import { cn } from "@/lib/utils";

export function SearchBox() {
  const { selectToken } = useApp();
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const { data, isLoading, error } = useSWR<{ tokens: TokenSnapshot[] }>(
    debounced.length >= 2 ? `/api/market/search?q=${encodeURIComponent(debounced)}` : null,
    fetcher,
  );
  const results = data?.tokens ?? [];

  const choose = (t: TokenSnapshot) => {
    selectToken(t);
    setOpen(false);
    setQ("");
    inputRef.current?.blur();
  };

  return (
    <div className="relative w-full max-w-md">
      <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
      <input
        ref={inputRef}
        id="token-search"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") setActive((a) => Math.min(a + 1, results.length - 1));
          if (e.key === "ArrowUp") setActive((a) => Math.max(a - 1, 0));
          if (e.key === "Enter" && results[active]) choose(results[active]);
          if (e.key === "Escape") inputRef.current?.blur();
        }}
        placeholder="Search name, ticker or contract address"
        aria-label="Search tokens"
        autoComplete="off"
        spellCheck={false}
        className="h-8 w-full rounded border border-line bg-ink-0 pl-8 pr-12 text-[13px] placeholder:text-muted/70 focus:border-signal/60 focus:outline-none"
      />
      <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-line px-1 text-[10px] text-muted max-sm:hidden">⌘K</kbd>
      {open && debounced.length >= 2 && (
        <div className="absolute left-0 right-0 top-9 z-50 max-h-[60vh] overflow-y-auto rounded-md border border-line bg-ink-2 shadow-2xl shadow-black/50">
          {isLoading && <p className="px-3 py-3 text-xs text-muted">Searching DexScreener…</p>}
          {error && <p className="px-3 py-3 text-xs text-sell">{(error as Error).message}</p>}
          {!isLoading && !error && results.length === 0 && <p className="px-3 py-3 text-xs text-muted">No Solana tokens match “{debounced}”.</p>}
          {results.map((t, i) => (
            <button
              key={t.mint}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(t)}
              onMouseEnter={() => setActive(i)}
              className={cn("flex w-full items-center gap-2.5 px-3 py-2 text-left", i === active && "bg-ink-3")}
            >
              <TokenAvatar src={t.imageUrl} symbol={t.symbol} size={22} />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-1.5">
                  <span className="font-medium">{t.symbol}</span>
                  <span className="truncate text-xs text-muted">{t.name}</span>
                </span>
                <span className="text-2xs text-muted/80">{shortAddr(t.mint, 5)}</span>
              </span>
              <span className="text-right text-xs num">
                <span className="block">{compactUsd(t.marketCap)}</span>
                <span className={cn("block text-2xs", (t.priceChange.h24 ?? 0) >= 0 ? "up" : "down")}>{pct(t.priceChange.h24)}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
