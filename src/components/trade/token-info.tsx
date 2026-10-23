"use client";

import useSWR from "swr";
import { fetcher } from "@/lib/client/api";
import type { TokenSnapshot } from "@/lib/client/types";
import { age, compactUsd, shortAddr } from "@/lib/domain/format";
import { cn } from "@/lib/utils";

interface Security {
  mintAuthority: string | null;
  freezeAuthority: string | null;
  top10Percent: number | null;
  topHolders: { address: string; percent: number }[];
  program: string;
  decimals: number;
}

export function TokenInfo({ token }: { token: TokenSnapshot }) {
  const { data, error, isLoading } = useSWR<{ security: Security }>(`/api/market/security/${token.mint}`, fetcher);
  const s = data?.security;
  const buys = token.txns24h.buys ?? 0;
  const sells = token.txns24h.sells ?? 0;
  return (
    <div className="grid gap-6 p-3 md:grid-cols-2">
      <section>
        <h3 className="mb-2 text-xs font-medium text-fg-soft">Market</h3>
        <dl className="grid grid-cols-2 gap-y-1.5 text-xs">
          <Row k="Pair" v={`${token.symbol}/${token.quoteSymbol} on ${token.dexId}`} />
          <Row k="Pair age" v={age(token.pairCreatedAt)} />
          <Row k="Market cap" v={compactUsd(token.marketCap)} />
          <Row k="FDV" v={compactUsd(token.fdv)} />
          <Row k="Liquidity" v={compactUsd(token.liquidityUsd)} bad={(token.liquidityUsd ?? 0) < 10_000} />
          <Row k="Liquidity / mcap" v={token.liquidityUsd && token.marketCap ? `${((token.liquidityUsd / token.marketCap) * 100).toFixed(1)}%` : "—"} />
          <Row k="24h buys / sells" v={`${buys} / ${sells}`} />
          <Row k="Data source" v={token.source === "dexscreener" ? "DexScreener" : "GeckoTerminal"} />
        </dl>
        {token.links.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {token.links.map((l) => (
              <a key={l.url} href={l.url} target="_blank" rel="noreferrer nofollow" className="rounded border border-line px-2 py-0.5 text-2xs text-fg-soft hover:border-line-strong">
                {l.label}
              </a>
            ))}
          </div>
        )}
      </section>
      <section>
        <h3 className="mb-2 text-xs font-medium text-fg-soft">On-chain checks</h3>
        {isLoading && <p className="text-xs text-muted">Reading the mint account…</p>}
        {error && <p className="text-xs text-sell">{(error as Error).message}</p>}
        {s && (
          <dl className="grid grid-cols-2 gap-y-1.5 text-xs">
            <Row k="Mint authority" v={s.mintAuthority ? `Active (${shortAddr(s.mintAuthority)})` : "Renounced"} bad={!!s.mintAuthority} good={!s.mintAuthority} />
            <Row k="Freeze authority" v={s.freezeAuthority ? `Active (${shortAddr(s.freezeAuthority)})` : "None"} bad={!!s.freezeAuthority} good={!s.freezeAuthority} />
            <Row k="Top 10 accounts" v={s.top10Percent != null ? `${s.top10Percent.toFixed(1)}% of supply` : "Unavailable from RPC"} bad={(s.top10Percent ?? 0) > 50} />
            <Row k="Token program" v={s.program} />
          </dl>
        )}
        {s && s.topHolders.length > 0 && (
          <p className="mt-2 text-2xs text-muted">Top accounts include liquidity pool vaults, so concentration can look higher than it is.</p>
        )}
      </section>
    </div>
  );
}

function Row({ k, v, bad, good }: { k: string; v: string; bad?: boolean; good?: boolean }) {
  return (
    <>
      <dt className="text-muted">{k}</dt>
      <dd className={cn("text-right num", bad && "text-sell", good && "text-buy")}>{v}</dd>
    </>
  );
}
