"use client";

import { ExternalLink } from "lucide-react";
import { useSession } from "@/lib/client/session";
import { useTrades } from "@/lib/client/hooks";
import { sol } from "@/lib/domain/format";
import { Empty } from "./positions-table";
import { cn } from "@/lib/utils";

export function HistoryTable({ mint }: { mint?: string }) {
  const { status } = useSession();
  const { data, error, isLoading } = useTrades();
  if (status !== "signed_in") return <Empty text="Sign in with your wallet to see your history." />;
  if (error) return <Empty text={(error as Error).message} tone="error" />;
  if (isLoading && !data) return <Empty text="Loading history…" />;
  const trades = (data?.trades ?? []).filter((t) => !mint || t.mint === mint);
  if (!trades.length) return <Empty text="No trades yet." />;

  return (
    <table className="w-full min-w-[720px] text-xs">
      <thead className="sticky top-0 bg-ink-0 text-2xs text-muted">
        <tr className="border-b border-line">
          <th className="py-1.5 pl-3 text-left font-normal">Time</th>
          <th className="px-2 text-left font-normal">Trade</th>
          <th className="px-2 text-right font-normal">Tokens</th>
          <th className="px-2 text-right font-normal">SOL</th>
          <th className="px-2 text-right font-normal">Fees</th>
          <th className="px-2 text-left font-normal">Status</th>
          <th className="pr-3 text-right font-normal">Tx</th>
        </tr>
      </thead>
      <tbody>
        {trades.map((t) => {
          const tokens = Number(t.tokenAmountRaw) / 10 ** t.tokenDecimals;
          const fees = (Number(t.networkFeeLamports) + Number(t.platformFeeLamports)) / 1e9;
          return (
            <tr key={t.id} className="border-b border-line/60">
              <td className="py-2 pl-3 text-fg-soft num">{new Date(t.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</td>
              <td className="px-2">
                <span className={cn("font-medium", t.side === "buy" ? "up" : "down")}>{t.side === "buy" ? "Buy" : "Sell"}</span> {t.tokenSymbol ?? "?"}
                {t.simulated && <span className="ml-1.5 rounded-sm border border-signal/40 px-1 text-[10px] text-signal">Paper</span>}
                {t.secondChanceShown && <span className="ml-1.5 rounded-sm border border-line px-1 text-[10px] text-muted" title="The SECOND CHANCE reminder was shown before this sell">Reminded</span>}
              </td>
              <td className="px-2 text-right num">{tokens.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
              <td className="px-2 text-right num">{sol(Number(t.solAmountLamports) / 1e9)}</td>
              <td className="px-2 text-right text-muted num">{fees > 0 ? sol(fees, 6) : "—"}</td>
              <td className="px-2">
                <span className={cn(t.status === "confirmed" ? "text-fg-soft" : t.status === "failed" ? "text-sell" : "text-signal")} title={t.error ?? undefined}>
                  {t.status === "confirmed" ? (t.simulated ? "Filled" : "Confirmed") : t.status === "failed" ? "Failed" : "Pending"}
                </span>
              </td>
              <td className="pr-3 text-right">
                {t.signature ? (
                  <a href={`https://solscan.io/tx/${t.signature}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-signal" aria-label="View on Solscan">
                    Solscan <ExternalLink size={10} />
                  </a>
                ) : (
                  <span className="text-muted">—</span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
