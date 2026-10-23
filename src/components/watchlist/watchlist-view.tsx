"use client";

import useSWR from "swr";
import { del, fetcher } from "@/lib/client/api";
import { useSession } from "@/lib/client/session";
import { useApp } from "@/lib/client/store";
import type { TokenSnapshot } from "@/lib/client/types";
import { TokenTable } from "@/components/discover/discover-view";
import { Empty } from "@/components/portfolio/positions-table";

export function WatchlistView() {
  const { status } = useSession();
  const { toast } = useApp();
  const { data, error, mutate } = useSWR<{ items: { mint: string; symbol: string | null; token: TokenSnapshot | null }[] }>(
    status === "signed_in" ? "/api/watchlist" : null,
    fetcher,
    { refreshInterval: 20_000 },
  );
  if (status !== "signed_in") return <Empty text="Sign in with your wallet to keep a watchlist." />;
  if (error) return <Empty text={(error as Error).message} tone="error" />;
  if (!data) return <Empty text="Loading watchlist…" />;
  const live = data.items.map((i) => i.token).filter((t): t is TokenSnapshot => !!t);
  const missing = data.items.filter((i) => !i.token);
  if (data.items.length === 0) return <Empty text="Your watchlist is empty. Star a token in Discover to add it." />;

  return (
    <div className="h-full overflow-auto">
      <TokenTable
        tokens={live}
        onRemove={async (mint) => {
          try {
            await del(`/api/watchlist?mint=${mint}`);
            void mutate();
          } catch (e) {
            toast({ tone: "error", title: "Couldn't remove", body: (e as Error).message });
          }
        }}
      />
      {missing.length > 0 && (
        <p className="px-3 py-3 text-2xs text-muted">
          No live market data right now for: {missing.map((m) => m.symbol ?? m.mint.slice(0, 6)).join(", ")}.
        </p>
      )}
    </div>
  );
}
