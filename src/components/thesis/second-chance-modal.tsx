"use client";

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import type { TradeFlow } from "@/lib/client/trade-flow";
import type { ThesisDTO } from "@/lib/client/types";
import { compactUsd, parseCompact, sol } from "@/lib/domain/format";
import { useApp } from "@/lib/client/store";
import { cn } from "@/lib/utils";

/**
 * SECOND CHANCE. Shown when the server marks a sell intent as needing
 * acknowledgement. The server will not execute the sell until one of the
 * three actions is recorded; the user can always continue.
 */
export function SecondChanceModal({ flow, estimateSol, sellLabel }: { flow: TradeFlow; estimateSol: number | null; sellLabel: string }) {
  const { state } = flow;
  const { mode } = useApp();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"reminder" | "update">("reminder");
  const [why, setWhy] = useState("");
  const [newTarget, setNewTarget] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (state.phase === "reminder") {
      setOpen(true);
      setStep("reminder");
      setWhy("");
      setNewTarget("");
    }
    if (state.phase === "idle") setOpen(false);
  }, [state.phase]);

  const ev = state.intent?.evaluation;
  const thesis = state.thesis;
  if (!open || !ev) return null;

  const close = () => {
    if (state.phase === "reminder") void flow.acknowledge("keep_holding");
    else if (["confirm", "done", "failed"].includes(state.phase)) {
      setOpen(false);
      flow.reset();
    }
  };

  const act = async (fn: () => Promise<void>) => {
    setSubmitting(true);
    try {
      await fn();
    } finally {
      setSubmitting(false);
    }
  };

  const busy = ["quoting", "signing", "submitting", "confirming"].includes(state.phase);

  return (
    <Dialog open={open} onClose={busy ? () => undefined : close} labelledBy="sc-title" className="max-w-[560px] border-signal/30">
      <div className="h-1 w-full bg-signal" />
      {state.phase === "reminder" && step === "reminder" && thesis && (
        <div className="p-6">
          <p id="sc-title" className="text-xs font-semibold tracking-wide text-signal">Second chance</p>
          <Headline ev={ev} />
          <ProgressRail entry={ev.entryMarketCap} current={ev.currentMarketCap} target={ev.targetMarketCap ?? thesis.targetMarketCap} />
          {ev.marketDataNote && (
            <p className="mt-4 flex items-start gap-2 rounded border border-signal/30 bg-signal-soft px-3 py-2 text-xs text-signal">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {ev.marketDataNote} You can still sell.
            </p>
          )}
          <OriginalWords thesis={thesis} />
          {ev.plannedAllowancePercent > 0 && ev.sellPercentOfOriginal != null && (
            <p className="mt-3 text-xs text-fg-soft">
              Your plan allows selling {ev.plannedAllowancePercent.toFixed(0)}% of your original position at this level. This sell is {ev.sellPercentOfOriginal.toFixed(0)}%.
            </p>
          )}
          <p className="mt-6 text-[15px] font-medium">Has your thesis changed, or are you reacting emotionally?</p>
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            <Button size="lg" variant="signal" data-autofocus disabled={submitting} onClick={() => act(() => flow.acknowledge("keep_holding"))}>
              Keep holding
            </Button>
            <Button size="lg" variant="default" disabled={submitting} onClick={() => setStep("update")}>
              Update thesis
            </Button>
            <Button size="lg" variant="outline" className="border-sell/40 text-sell hover:border-sell hover:text-sell" disabled={submitting} onClick={() => act(() => flow.acknowledge("sell_anyway"))}>
              Sell anyway
            </Button>
          </div>
          <p className="mt-3 text-center text-2xs text-muted">No cooldowns. You can always sell.</p>
        </div>
      )}

      {state.phase === "reminder" && step === "update" && thesis && (
        <form
          className="p-6"
          onSubmit={(e) => {
            e.preventDefault();
            const target = newTarget.trim() ? parseCompact(newTarget) : null;
            if (newTarget.trim() && !target) return;
            void act(() => flow.acknowledge("update_thesis", { patch: target ? { targetMarketCap: target } : {}, reason: why.trim() }));
          }}
        >
          <p id="sc-title" className="text-xs font-semibold tracking-wide text-signal">Update your thesis</p>
          <h2 className="mt-2 text-lg font-semibold leading-snug">What changed since you bought?</h2>
          <p className="mt-1 text-xs text-muted">This is saved as a new revision. Your original words stay exactly as you wrote them.</p>
          <Textarea id="sc-why" rows={4} value={why} onChange={(e) => setWhy(e.target.value)} placeholder="Dev wallet started selling, volume dropped 80%…" className="mt-4 font-voice text-[15px] italic" data-autofocus maxLength={1000} />
          <div className="mt-3 flex flex-col gap-1">
            <label htmlFor="sc-target" className="text-2xs text-muted">New target market cap (optional, was {compactUsd(thesis.targetMarketCap)})</label>
            <Input id="sc-target" value={newTarget} onChange={(e) => setNewTarget(e.target.value)} placeholder={compactUsd(thesis.targetMarketCap).replace("$", "")} />
            {newTarget.trim() && !parseCompact(newTarget) && <span className="text-2xs text-sell">Use a number like 6M or 750K.</span>}
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setStep("reminder")}>Back</Button>
            <Button type="submit" variant="signal" disabled={why.trim().length < 3 || submitting}>
              Save and continue
            </Button>
          </div>
        </form>
      )}

      {state.phase === "confirm" && (
        <div className="p-6">
          <p id="sc-title" className="text-xs font-semibold tracking-wide text-muted">Confirm sell</p>
          <h2 className="mt-2 text-lg font-semibold">{sellLabel}</h2>
          <p className="mt-1 text-sm text-fg-soft num">
            Estimated proceeds {estimateSol != null ? `≈ ${sol(estimateSol)}` : "unavailable"} before fees and slippage.
          </p>
          {state.intent?.acknowledgement === "update_thesis" && <p className="mt-3 text-xs text-buy">Revision saved. Your original thesis is preserved.</p>}
          <p className="mt-3 text-xs text-muted">
            {mode === "real" ? "Next, approve the transaction in your wallet. It isn't sent until you do." : "Paper trade: simulated at the live price. No real SOL moves."}
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" onClick={close}>Cancel</Button>
            <Button variant="sell" data-autofocus onClick={() => void flow.confirm()}>
              {mode === "real" ? "Sell and open wallet" : "Sell (paper)"}
            </Button>
          </div>
        </div>
      )}

      {(busy || state.phase === "done" || state.phase === "failed") && (
        <div className="p-6">
          <p id="sc-title" className="text-xs font-semibold tracking-wide text-muted">Selling {state.symbol}</p>
          <PhaseLine phase={state.phase} />
          {state.phase === "failed" && <p className="mt-3 text-sm text-sell">{state.error}</p>}
          {state.phase === "done" && state.trade?.signature && (
            <a href={`https://solscan.io/tx/${state.trade.signature}`} target="_blank" rel="noreferrer" className="mt-3 inline-block text-xs text-signal underline">
              View on Solscan
            </a>
          )}
          <div className="mt-5 flex justify-end gap-2">
            {state.phase === "failed" && state.errorCode === "quote_expired" && (
              <Button variant="signal" onClick={() => void flow.retryQuote()}>Get new quote</Button>
            )}
            {!busy && <Button variant="ghost" onClick={close}>Close</Button>}
          </div>
        </div>
      )}
    </Dialog>
  );
}

function Headline({ ev }: { ev: NonNullable<NonNullable<TradeFlow["state"]["intent"]>["evaluation"]> }) {
  return (
    <div className="mt-2">
      <h2 className="text-[22px] font-semibold leading-tight text-balance">
        {ev.currentMarketCap != null ? <>You’re about to sell at a <span className="num">{compactUsd(ev.currentMarketCap)}</span> market cap.</> : <>You’re about to sell without a live market cap.</>}
      </h2>
      {ev.targetMarketCap != null && (
        <p className="mt-1 text-[15px] text-fg-soft">
          Your target is <span className="num font-medium text-fg">{compactUsd(ev.targetMarketCap)}</span>.
        </p>
      )}
    </div>
  );
}

function ProgressRail({ entry, current, target }: { entry: number | null; current: number | null; target: number }) {
  if (current == null) return null;
  const lo = entry != null && entry < target ? Math.min(entry, current) : 0;
  const pos = (v: number) => Math.max(0, Math.min(100, ((v - lo) / (target - lo)) * 100));
  return (
    <div className="mt-5">
      <div className="relative h-1.5 rounded-full bg-ink-3">
        <div className="absolute inset-y-0 left-0 rounded-full bg-signal/60" style={{ width: `${pos(current)}%` }} />
        {entry != null && <span className="absolute top-1/2 h-3 w-px -translate-y-1/2 bg-fg-soft" style={{ left: `${pos(entry)}%` }} />}
        <span className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-ink-1 bg-signal" style={{ left: `${pos(current)}%` }} />
      </div>
      <div className="mt-1.5 flex justify-between text-2xs text-muted num">
        <span>{entry != null ? `Entry ${compactUsd(entry)}` : ""}</span>
        <span>Target {compactUsd(target)}</span>
      </div>
    </div>
  );
}

function OriginalWords({ thesis }: { thesis: ThesisDTO }) {
  const o = thesis.original;
  const when = new Date(thesis.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  return (
    <div className="mt-6">
      <p className="text-xs text-muted">Here’s what you told yourself when you bought, on {when}:</p>
      <blockquote className="mt-2 border-l-2 border-signal pl-4 font-voice text-[19px] italic leading-relaxed text-fg">“{o.reason}”</blockquote>
      {o.invalidation && (
        <p className="mt-3 text-xs text-fg-soft">
          You said you’d be wrong if: <span className="font-voice text-[14px] italic text-fg">{o.invalidation}</span>
        </p>
      )}
      {o.holdingPeriod && <p className="mt-1 text-xs text-fg-soft">Planned hold: {o.holdingPeriod}</p>}
      {thesis.revisionCount > 0 && (
        <p className={cn("mt-2 text-2xs text-muted")}>
          You’ve revised this plan {thesis.revisionCount} {thesis.revisionCount === 1 ? "time" : "times"}. Original target was {compactUsd(o.targetMarketCap)}.
        </p>
      )}
    </div>
  );
}

const PHASES: { key: string; label: string }[] = [
  { key: "quoting", label: "Getting a fresh quote" },
  { key: "signing", label: "Waiting for your wallet" },
  { key: "submitting", label: "Submitting" },
  { key: "confirming", label: "Confirming on-chain" },
];

export function PhaseLine({ phase }: { phase: string }) {
  const idx = PHASES.findIndex((p) => p.key === phase);
  if (phase === "done") return <p className="mt-2 text-lg font-semibold text-buy">Done.</p>;
  if (phase === "failed") return <p className="mt-2 text-lg font-semibold text-sell">Not completed.</p>;
  return (
    <ol className="mt-3 flex flex-col gap-1.5">
      {PHASES.map((p, i) => (
        <li key={p.key} className={cn("flex items-center gap-2 text-sm", i < idx ? "text-muted line-through" : i === idx ? "text-fg" : "text-muted/60")}>
          <span className={cn("h-1.5 w-1.5 rounded-full", i === idx ? "animate-pulse bg-signal" : i < idx ? "bg-buy" : "bg-ink-3")} />
          {p.label}
        </li>
      ))}
    </ol>
  );
}
