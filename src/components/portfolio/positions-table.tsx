"use client";

import { useApp } from "@/lib/client/store";
import { useSession } from "@/lib/client/session";
import { usePortfolio } from "@/lib/client/hooks";
import { compactUsd, pct, sol } from "@/lib/domain/format";
import { TokenAvatar } from "@/components/ui/token-avatar";
import { cn } from "@/lib/utils";

export function PositionsTable({ compact }: { compact?: boolean }) {
  const { selectToken, mode } = useApp();
  const { status } = useSession();
  const { data, error, isLoading } = usePortfolio();

  if (status !== "signed_in") return <Empty text="Sign in with your wallet to see positions." />;
  if (error) return <Empty text={(error as Error).message} tone="error" />;
  if (isLoading && !data) return <Empty text="Loading positions…" />;
  if (!data || data.rows.length === 0) return <Empty text={mode === "paper" ? "No paper positions yet. Buy something to start practicing." : "No token holdings found in this wallet."} />;

  return (
    <div>
      {data.warnings.map((w) => (
        <p key={w} className="border-b border-line bg-signal-soft px-3 py-1.5 text-2xs text-signal">{w}</p>
      ))}
      <table className="w-full min-w-[720px] text-xs">
        <thead className="sticky top-0 bg-ink-0 text-2xs text-muted">
          <tr className="border-b border-line">
            <th className="py-1.5 pl-3 text-left font-normal">Token</th>
            <th className="px-2 text-right font-normal">Value</th>
            <th className="px-2 text-right font-normal">Avg entry</th>
            <th className="px-2 text-right font-normal">Unrealized</th>
            {!compact && <th className="px-2 text-right font-normal">Realized</th>}
            <th className="px-2 text-right font-normal">Market cap</th>
            <th className="px-2 text-left font-normal">Thesis</th>
            <th className="pr-3 text-right font-normal">Basis</th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r) => (
            <tr key={r.mint} onClick={() => selectToken(r.mint)} className="cursor-pointer border-b border-line/60 hover:bg-ink-1">
              <td className="py-2 pl-3">
                <div className="flex items-center gap-2">
                  <TokenAvatar src={r.imageUrl} symbol={r.symbol} size={20} />
                  <span className="font-medium">{r.symbol}</span>
                  <span className="text-muted num">{r.quantity.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                </div>
              </td>
              <td className="px-2 text-right num">
                {sol(r.marketValueSol, 3)}
                {r.marketValueUsd != null && <span className="block text-2xs text-muted">{compactUsd(r.marketValueUsd)}</span>}
              </td>
              <td className="px-2 text-right num text-fg-soft">{r.avgEntryPriceSol != null ? r.avgEntryPriceSol.toPrecision(3) : "—"}</td>
              <td className={cn("px-2 text-right num", r.unrealizedPnlSol == null ? "text-muted" : r.unrealizedPnlSol >= 0 ? "up" : "down")}>
                {r.unrealizedPnlSol != null ? sol(r.unrealizedPnlSol, 3) : "—"}
                {r.unrealizedPnlPct != null && <span className="block text-2xs">{pct(r.unrealizedPnlPct)}</span>}
              </td>
              {!compact && <td className={cn("px-2 text-right num", r.realizedPnlSol >= 0 ? "up" : "down")}>{sol(r.realizedPnlSol, 3)}</td>}
              <td className="px-2 text-right num">{compactUsd(r.marketCap)}</td>
              <td className="px-2">
                {r.thesis ? (
                  <div className="flex items-center gap-2" title={`Target ${compactUsd(r.thesis.targetMarketCap)}`}>
                    <span className="h-1 w-14 rounded-full bg-ink-3">
                      <span className="block h-full rounded-full bg-signal" style={{ width: `${Math.round((r.thesis.progress ?? 0) * 100)}%` }} />
                    </span>
                    <span className="text-2xs text-muted num">{compactUsd(r.thesis.targetMarketCap)}</span>
                  </div>
                ) : (
                  <span className="text-2xs text-muted">None</span>
                )}
              </td>
              <td className="pr-3 text-right">
                <BasisBadge status={r.costBasisStatus} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function BasisBadge({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    verified: ["Verified", "text-fg-soft border-line"],
    partial: ["Partial", "text-signal border-signal/40"],
    unknown: ["Unknown", "text-signal border-signal/40"],
  };
  const [label, cls] = map[status] ?? ["—", "text-muted border-line"];
  return (
    <span className={cn("rounded-sm border px-1.5 py-0.5 text-2xs", cls)} title={status === "verified" ? "Every token traced to a recorded trade" : "Some tokens arrived outside this terminal; their cost is unknown and excluded from PnL"}>
      {label}
    </span>
  );
}

export function Empty({ text, tone }: { text: string; tone?: "error" }) {
  return <p className={cn("p-6 text-center text-xs", tone === "error" ? "text-sell" : "text-muted")}>{text}</p>;
}
