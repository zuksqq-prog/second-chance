"use client";

import { useState } from "react";
import { Copy, ExternalLink, Search } from "lucide-react";
import { useApp } from "@/lib/client/store";
import { useActiveThesis, useToken, useTrades } from "@/lib/client/hooks";
import { compactUsd, pct, shortAddr, tokenPrice } from "@/lib/domain/format";
import { TokenAvatar } from "@/components/ui/token-avatar";
import { Button } from "@/components/ui/button";
import { PriceChart } from "./price-chart";
import { TradePanel } from "./trade-panel";
import { ActivityTabs } from "./activity-tabs";
import { cn } from "@/lib/utils";

export function TradeView() {
  const { selected, selectedMint, setView } = useApp();
  const { data, error } = useToken(selectedMint, selected);
  const token = data?.token ?? null;
  const { data: thesisData } = useActiveThesis(selectedMint);
  const { data: tradesData } = useTrades();

  if (!selectedMint) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <Search size={22} className="text-muted" />
        <p className="max-w-sm text-sm text-fg-soft">Pick a token to trade. Search by name or paste a contract address, or browse what’s moving.</p>
        <Button variant="outline" size="sm" onClick={() => setView("discover")}>Open Discover</Button>
      </div>
    );
  }
  if (!token) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-xs text-muted">
        {error ? <span className="text-sell">{(error as Error).message}</span> : "Loading live token data…"}
      </div>
    );
  }

  const tokenTrades = (tradesData?.trades ?? []).filter((t) => t.mint === token.mint && t.status === "confirmed");

  return (
    <div className="grid h-full min-h-0 grid-cols-1 grid-rows-[auto_minmax(320px,1fr)_auto] overflow-y-auto lg:grid-cols-[minmax(0,1fr)_340px] lg:grid-rows-[auto_minmax(240px,1fr)_minmax(200px,40%)] lg:overflow-hidden">
      <TokenHeader token={token} />
      <div className="relative min-h-0 overflow-hidden border-b border-line lg:border-r">
        <PriceChart token={token} thesis={thesisData?.thesis ?? null} trades={tokenTrades} />
      </div>
      <aside className="border-b border-line lg:row-span-2 lg:overflow-y-auto">
        <TradePanel token={token} thesis={thesisData?.thesis ?? null} />
      </aside>
      <section className="relative z-10 flex h-[340px] min-h-0 flex-col bg-ink-0 lg:h-auto lg:border-r lg:border-line">
        <ActivityTabs token={token} />
      </section>
    </div>
  );
}

function TokenHeader({ token }: { token: NonNullable<ReturnType<typeof useToken>["data"]>["token"] }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="col-span-full flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-line px-3 py-2">
      <div className="flex items-center gap-2.5">
        <TokenAvatar src={token.imageUrl} symbol={token.symbol} size={30} />
        <div>
          <div className="flex items-baseline gap-2">
            <h1 className="text-[15px] font-semibold">{token.symbol}</h1>
            <span className="max-w-[200px] truncate text-xs text-muted">{token.name}</span>
          </div>
          <button
            type="button"
            onClick={() => {
              navigator.clipboard?.writeText(token.mint).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1200);
              }).catch(() => null);
            }}
            className="flex items-center gap-1 text-2xs text-muted hover:text-fg"
            title="Copy contract address"
          >
            {shortAddr(token.mint, 5)} <Copy size={10} /> {copied && <span className="text-buy">Copied</span>}
          </button>
        </div>
      </div>
      <Stat label="Price" value={`$${tokenPrice(token.priceUsd)}`} />
      <Stat label={token.marketCapIsFdv ? "FDV" : "Market cap"} value={compactUsd(token.marketCap)} strong />
      <Stat label="Liquidity" value={compactUsd(token.liquidityUsd)} warn={(token.liquidityUsd ?? 0) < 10_000} />
      <Stat label="Vol 24h" value={compactUsd(token.volume.h24)} />
      <Stat label="1h" value={pct(token.priceChange.h1)} tone={token.priceChange.h1} />
      <Stat label="24h" value={pct(token.priceChange.h24)} tone={token.priceChange.h24} />
      <div className="ml-auto flex gap-1">
        <a className="inline-flex items-center gap-1 rounded px-2 py-1 text-2xs text-muted hover:bg-ink-2 hover:text-fg" href={`https://solscan.io/token/${token.mint}`} target="_blank" rel="noreferrer">
          Solscan <ExternalLink size={10} />
        </a>
        <a className="inline-flex items-center gap-1 rounded px-2 py-1 text-2xs text-muted hover:bg-ink-2 hover:text-fg" href={`https://dexscreener.com/solana/${token.pairAddress}`} target="_blank" rel="noreferrer">
          DexScreener <ExternalLink size={10} />
        </a>
      </div>
    </div>
  );
}

function Stat({ label, value, strong, warn, tone }: { label: string; value: string; strong?: boolean; warn?: boolean; tone?: number | null }) {
  return (
    <div className="flex flex-col">
      <span className="text-2xs text-muted">{label}</span>
      <span className={cn("num", strong ? "text-[14px] font-semibold" : "text-[13px]", warn && "text-sell", tone != null && (tone >= 0 ? "up" : "down"))}>{value}</span>
    </div>
  );
}
