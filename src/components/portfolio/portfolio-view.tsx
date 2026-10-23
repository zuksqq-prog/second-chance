"use client";

import { useState } from "react";
import { useSWRConfig } from "swr";
import { usePortfolio } from "@/lib/client/hooks";
import { useApp } from "@/lib/client/store";
import { post } from "@/lib/client/api";
import { sol } from "@/lib/domain/format";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { PositionsTable } from "./positions-table";
import { HistoryTable } from "./history-table";
import { cn } from "@/lib/utils";

export function PortfolioView() {
  const { mode, toast } = useApp();
  const { data } = usePortfolio();
  const { mutate } = useSWRConfig();
  const [tab, setTab] = useState<"positions" | "history">("positions");
  const [confirmReset, setConfirmReset] = useState(false);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="grid grid-cols-2 gap-px border-b border-line bg-line sm:grid-cols-4">
        <Figure label={mode === "paper" ? "Paper SOL" : "SOL balance"} value={sol(data?.solBalance, 3)} />
        <Figure label="Positions value" value={sol(data?.positionsValueSol, 3)} />
        <Figure label="Unrealized PnL" value={sol(data?.unrealizedPnlSol, 3)} tone={data?.unrealizedPnlSol} note={data?.hasUnknownBasis ? "Excludes unknown-basis tokens" : undefined} />
        <Figure label="Realized PnL" value={sol(data?.realizedPnlSol, 3)} tone={data?.realizedPnlSol} note="Net of network and router fees" />
      </div>
      <div className="flex items-center gap-2 border-b border-line px-3 py-1.5">
        <Segmented size="xs" value={tab} onChange={setTab} options={[{ value: "positions", label: "Positions" }, { value: "history", label: "History" }]} />
        {mode === "paper" && (
          <div className="ml-auto flex items-center gap-2">
            {confirmReset ? (
              <>
                <span className="text-2xs text-muted">Delete all paper trades and restart?</span>
                <Button size="xs" variant="ghost" onClick={() => setConfirmReset(false)}>Cancel</Button>
                <Button
                  size="xs"
                  variant="sell"
                  onClick={async () => {
                    try {
                      await post("/api/paper/reset", {});
                      toast({ tone: "ok", title: "Paper account reset" });
                      void mutate((k) => typeof k === "string" && k.startsWith("/api/"));
                    } catch (e) {
                      toast({ tone: "error", title: "Reset failed", body: (e as Error).message });
                    }
                    setConfirmReset(false);
                  }}
                >
                  Reset
                </Button>
              </>
            ) : (
              <Button size="xs" variant="quiet" onClick={() => setConfirmReset(true)}>Reset paper account</Button>
            )}
          </div>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">{tab === "positions" ? <PositionsTable /> : <HistoryTable />}</div>
    </div>
  );
}

function Figure({ label, value, tone, note }: { label: string; value: string; tone?: number | null; note?: string }) {
  return (
    <div className="bg-ink-1 px-4 py-3">
      <p className="text-2xs text-muted">{label}</p>
      <p className={cn("mt-0.5 text-lg font-semibold num", tone != null && tone !== 0 && (tone > 0 ? "up" : "down"))}>{value}</p>
      {note && <p className="text-2xs text-muted/80">{note}</p>}
    </div>
  );
}
