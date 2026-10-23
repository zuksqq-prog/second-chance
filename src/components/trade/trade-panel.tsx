"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, NotebookPen } from "lucide-react";
import { useApp } from "@/lib/client/store";
import { useSession } from "@/lib/client/session";
import { usePortfolio, useSettings } from "@/lib/client/hooks";
import { useTradeFlow } from "@/lib/client/trade-flow";
import type { ThesisDTO, TokenSnapshot } from "@/lib/client/types";
import { percentOf, toRaw } from "@/lib/domain/portfolio";
import { compactUsd, pct, sol } from "@/lib/domain/format";
import { progressTowardTarget } from "@/lib/domain/thesis-engine";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { ThesisForm, draftToContent, emptyDraft, isDraftEmpty, type ThesisDraft } from "@/components/thesis/thesis-form";
import { SecondChanceModal, PhaseLine } from "@/components/thesis/second-chance-modal";
import { cn } from "@/lib/utils";

export function TradePanel({ token, thesis }: { token: TokenSnapshot; thesis: ThesisDTO | null }) {
  const { mode } = useApp();
  const session = useSession();
  const { settings, limits } = useSettings();
  const { data: portfolio } = usePortfolio();
  const flow = useTradeFlow();
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [buyAmount, setBuyAmount] = useState(settings.buyPresetsSol[1] ?? "0.25");
  const [sellPct, setSellPct] = useState(50);
  const [slippagePct, setSlippagePct] = useState(String(settings.slippageBps / 100));
  const [prioritySol, setPrioritySol] = useState(String(Number(settings.priorityFeeLamports) / 1e9));
  const [showSettings, setShowSettings] = useState(false);
  const [thesisOpen, setThesisOpen] = useState(true);
  const [draft, setDraft] = useState<ThesisDraft>(emptyDraft);

  useEffect(() => {
    setSlippagePct(String(settings.slippageBps / 100));
    setPrioritySol(String(Number(settings.priorityFeeLamports) / 1e9));
  }, [settings.slippageBps, settings.priorityFeeLamports]);

  // New token → fresh draft.
  useEffect(() => {
    setDraft(emptyDraft());
    flow.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token.mint]);

  const position = portfolio?.rows.find((r) => r.mint === token.mint) ?? null;
  const slippageBps = Math.round(Number(slippagePct) * 100);
  const priorityLamports = Math.round(Number(prioritySol) * 1e9);
  const settingsError =
    !(slippageBps >= 1) || (limits && slippageBps > limits.maxSlippageBps)
      ? `Slippage must be between 0.01% and ${(limits?.maxSlippageBps ?? 5000) / 100}%.`
      : !(priorityLamports >= 0) || (limits && priorityLamports > limits.maxPriorityFeeLamports)
        ? "Priority fee is out of range."
        : null;
  const opts = { slippageBps, priorityFeeLamports: String(Math.max(0, priorityLamports || 0)) };

  const disabledReason =
    session.status !== "signed_in"
      ? "Connect and sign in with your wallet to trade."
      : mode === "real" && !session.realTrading.enabled
        ? session.realTrading.reason
        : mode === "paper" && token.priceSol == null
          ? "This token has no SOL-quoted pool, so paper fills can't be priced."
          : settingsError;

  const busy = !["idle", "done", "failed"].includes(flow.state.phase);
  const thesisDraftResult = useMemo(() => (isDraftEmpty(draft) ? null : draftToContent(draft)), [draft]);
  const thesisBlocking = !thesis && thesisOpen && thesisDraftResult && !thesisDraftResult.ok ? thesisDraftResult.error : null;

  const buy = () => {
    let raw: bigint;
    try {
      raw = toRaw(buyAmount, 9);
    } catch {
      return;
    }
    if (raw <= 0n) return;
    void flow.start({
      side: "buy",
      mint: token.mint,
      symbol: token.symbol,
      amountRaw: raw.toString(),
      opts,
      thesisDraft: !thesis && thesisOpen && thesisDraftResult?.ok ? thesisDraftResult.content : null,
      marketCap: token.marketCap,
    });
  };

  const sellRaw = position ? percentOf(BigInt(position.quantityRaw), Math.min(100, Math.max(0.01, sellPct))) : 0n;
  const sellEstimate = position && token.priceSol ? (Number(sellRaw) / 10 ** position.decimals) * token.priceSol : null;
  const sellLabel = `Sell ${sellPct}% of ${token.symbol}`;
  const sell = () => {
    if (!position || sellRaw <= 0n) return;
    void flow.start({ side: "sell", mint: token.mint, symbol: token.symbol, amountRaw: sellRaw.toString(), opts });
  };

  const progress = thesis ? progressTowardTarget(thesis.entryMarketCap, token.marketCap, thesis.targetMarketCap) : null;

  return (
    <div className="flex flex-col gap-4 p-3">
      <Segmented
        className="w-full [&>button]:flex-1"
        value={side}
        onChange={setSide}
        options={[
          { value: "buy", label: "Buy", tone: "buy" },
          { value: "sell", label: "Sell", tone: "sell" },
        ]}
      />

      {side === "buy" ? (
        <>
          <div className="flex flex-col gap-2">
            <div className="grid grid-cols-4 gap-1">
              {settings.buyPresetsSol.slice(0, 8).map((p) => (
                <button key={p} type="button" onClick={() => setBuyAmount(p)} className={cn("h-8 rounded border text-xs num", buyAmount === p ? "border-buy/60 bg-buy-soft text-buy" : "border-line text-fg-soft hover:border-line-strong")}>
                  {p}
                </button>
              ))}
            </div>
            <div className="relative">
              <Input id="buy-amount" aria-label="Amount in SOL" value={buyAmount} onChange={(e) => setBuyAmount(e.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal" className="pr-12" />
              <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted">SOL</span>
            </div>
            {mode === "paper" && portfolio?.solBalance != null && <p className="text-2xs text-muted num">Paper balance {sol(portfolio.solBalance, 3)}</p>}
            {mode === "real" && portfolio?.solBalance != null && <p className="text-2xs text-muted num">Wallet balance {sol(portfolio.solBalance, 4)}</p>}
            {mode === "real" && limits && Number(buyAmount) > limits.maxRealTradeSol && <p className="text-2xs text-sell">Beta limit is {limits.maxRealTradeSol} SOL per buy.</p>}
          </div>

          {thesis ? (
            <ActiveThesisNote thesis={thesis} progress={progress} />
          ) : (
            <div className="rounded-md border border-line bg-ink-1">
              <button type="button" onClick={() => setThesisOpen((o) => !o)} className="flex w-full items-center gap-2 px-3 py-2.5 text-left" aria-expanded={thesisOpen}>
                <NotebookPen size={14} className="text-signal" />
                <span className="flex-1 text-[13px] font-medium">Your thesis</span>
                <span className="text-2xs text-muted">{thesisOpen ? "Optional" : "Add"}</span>
                <ChevronDown size={14} className={cn("text-muted transition-transform", thesisOpen && "rotate-180")} />
              </button>
              {thesisOpen && (
                <div className="border-t border-line px-3 pb-3 pt-3">
                  <ThesisForm draft={draft} onChange={setDraft} currentMarketCap={token.marketCap} idPrefix="buy-thesis" compact />
                  {thesisBlocking && <p className="mt-2 text-2xs text-sell">{thesisBlocking}</p>}
                  {!thesisBlocking && thesisDraftResult?.ok && <p className="mt-2 text-2xs text-buy">Saved with your buy once it confirms.</p>}
                </div>
              )}
            </div>
          )}

          <Button size="lg" variant="buy" className="w-full" disabled={!!disabledReason || busy || !!thesisBlocking || !(Number(buyAmount) > 0)} onClick={buy}>
            {busy && flow.state.side === "buy" ? "Working…" : `Buy ${buyAmount || 0} SOL${mode === "paper" ? " (paper)" : ""}`}
          </Button>
        </>
      ) : (
        <>
          {position ? (
            <PositionSummary position={position} />
          ) : (
            <p className="rounded border border-line px-3 py-3 text-xs text-muted">{session.status === "signed_in" ? `You don't hold ${token.symbol} in ${mode} mode.` : "Sign in to see your position."}</p>
          )}
          <div className="flex flex-col gap-2">
            <div className="grid grid-cols-4 gap-1">
              {settings.sellPresetsPct.slice(0, 8).map((p) => (
                <button key={p} type="button" onClick={() => setSellPct(p)} className={cn("h-8 rounded border text-xs num", sellPct === p ? "border-sell/60 bg-sell-soft text-sell" : "border-line text-fg-soft hover:border-line-strong")}>
                  {p}%
                </button>
              ))}
            </div>
            <div className="relative">
              <Input id="sell-pct" aria-label="Percent of position" value={String(sellPct)} onChange={(e) => setSellPct(Math.min(100, Number(e.target.value.replace(/[^\d.]/g, "")) || 0))} inputMode="decimal" className="pr-8" />
              <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted">%</span>
            </div>
            {sellEstimate != null && <p className="text-2xs text-muted num">≈ {sol(sellEstimate)} before fees</p>}
          </div>
          {thesis && <ActiveThesisNote thesis={thesis} progress={progress} />}
          <Button size="lg" variant="sell" className="w-full" disabled={!!disabledReason || busy || !position || !(sellPct > 0)} onClick={sell}>
            {busy && flow.state.side === "sell" ? "Working…" : `Sell ${sellPct}%${mode === "paper" ? " (paper)" : ""}`}
          </Button>
        </>
      )}

      {disabledReason && <p className="-mt-2 text-2xs text-muted">{disabledReason}</p>}

      {/* Inline progress for trades that don't go through the reminder dialog */}
      {(busy || flow.state.phase === "failed" || flow.state.phase === "done") && !flow.state.intent?.acknowledgement && (
        <div className="rounded border border-line bg-ink-1 px-3 py-2">
          {flow.state.phase === "starting" ? <p className="text-xs text-muted">Checking your plan…</p> : <PhaseLine phase={flow.state.phase} />}
          {flow.state.phase === "failed" && <p className="mt-2 text-xs text-sell">{flow.state.error}</p>}
          {flow.state.phase === "failed" && flow.state.errorCode === "quote_expired" && (
            <Button size="sm" variant="signal" className="mt-2" onClick={() => void flow.retryQuote()}>Get new quote</Button>
          )}
          {(flow.state.phase === "done" || flow.state.phase === "failed") && (
            <Button size="xs" variant="quiet" className="mt-1 px-0" onClick={flow.reset}>Dismiss</Button>
          )}
        </div>
      )}

      <div className="rounded border border-line">
        <button type="button" onClick={() => setShowSettings((s) => !s)} className="flex w-full items-center justify-between px-3 py-2 text-2xs text-muted" aria-expanded={showSettings}>
          <span className="num">Slippage {slippagePct}% · Priority {prioritySol} SOL</span>
          <ChevronDown size={12} className={cn("transition-transform", showSettings && "rotate-180")} />
        </button>
        {showSettings && (
          <div className="grid grid-cols-2 gap-2 border-t border-line p-3">
            <div className="flex flex-col gap-1">
              <label htmlFor="slip" className="text-2xs text-muted">Slippage %</label>
              <Input id="slip" value={slippagePct} onChange={(e) => setSlippagePct(e.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal" className="h-7 text-xs" />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="prio" className="text-2xs text-muted">Priority fee (SOL)</label>
              <Input id="prio" value={prioritySol} onChange={(e) => setPrioritySol(e.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal" className="h-7 text-xs" />
            </div>
            {mode === "real" && <p className="col-span-2 text-2xs text-muted">For real trades Jupiter sets the priority fee and lands the transaction; the actual fee paid is recorded after confirmation.</p>}
            {settingsError && <p className="col-span-2 text-2xs text-sell">{settingsError}</p>}
          </div>
        )}
      </div>

      <SecondChanceModal flow={flow} estimateSol={sellEstimate} sellLabel={sellLabel} />
    </div>
  );
}

function ActiveThesisNote({ thesis, progress }: { thesis: ThesisDTO; progress: number | null }) {
  return (
    <div className="rounded-md border border-signal/25 bg-signal-soft/40 px-3 py-2.5">
      <div className="flex items-baseline justify-between text-2xs">
        <span className="text-signal">Thesis active</span>
        <span className="text-muted num">Target {compactUsd(thesis.targetMarketCap)}</span>
      </div>
      <p className="mt-1 line-clamp-2 font-voice text-[14px] italic leading-snug text-fg-soft">“{thesis.original.reason}”</p>
      {progress != null && (
        <div className="mt-2 h-1 rounded-full bg-ink-3">
          <div className="h-full rounded-full bg-signal" style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      )}
    </div>
  );
}

function PositionSummary({ position }: { position: NonNullable<ReturnType<typeof usePortfolio>["data"]>["rows"][number] }) {
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 rounded border border-line bg-ink-1 px-3 py-2.5 text-xs">
      <span className="text-muted">Holding</span>
      <span className="text-right num">{position.quantity.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
      <span className="text-muted">Value</span>
      <span className="text-right num">{sol(position.marketValueSol)}</span>
      <span className="text-muted">Unrealized</span>
      <span className={cn("text-right num", (position.unrealizedPnlSol ?? 0) >= 0 ? "up" : "down")}>
        {position.unrealizedPnlSol != null ? `${sol(position.unrealizedPnlSol)} (${pct(position.unrealizedPnlPct)})` : "—"}
      </span>
      <span className="text-muted">Cost basis</span>
      <span className={cn("text-right", position.costBasisStatus === "verified" ? "text-fg-soft" : "text-signal")}>
        {position.costBasisStatus === "verified" ? "Verified" : position.costBasisStatus === "partial" ? "Partly unknown" : "Unknown"}
      </span>
    </div>
  );
}
