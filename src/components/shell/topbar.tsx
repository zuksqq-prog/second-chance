"use client";

import useSWR from "swr";
import { fetcher } from "@/lib/client/api";
import { useApp } from "@/lib/client/store";
import { Segmented } from "@/components/ui/segmented";
import { SearchBox } from "./search-box";
import { WalletButton } from "./wallet-button";

export function TopBar() {
  const { mode, setMode } = useApp();
  const { data } = useSWR<{ solUsd: number | null }>("/api/market/sol-price", fetcher, { refreshInterval: 30_000 });
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line bg-ink-1 pl-[max(12px,env(safe-area-inset-left))] pr-[max(12px,env(safe-area-inset-right))]">
      <span className="hidden whitespace-nowrap text-[13px] font-semibold tracking-tight lg:block">Second Chance</span>
      <SearchBox />
      <div className="ml-auto flex items-center gap-3">
        <span className="hidden text-xs text-muted sm:block num" title="SOL price (DexScreener)">
          SOL <span className="text-fg-soft">{data?.solUsd ? `$${data.solUsd.toFixed(2)}` : "—"}</span>
        </span>
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: "paper", label: "Paper", tone: "signal" },
            { value: "real", label: "Real" },
          ]}
        />
        <WalletButton />
      </div>
    </header>
  );
}
