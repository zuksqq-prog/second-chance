"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { Check, Fuel, GripHorizontal, Mountain, SquarePen, X } from "lucide-react";
import { fetcher, post } from "@/lib/client/api";
import { useApp } from "@/lib/client/store";
import { useSession } from "@/lib/client/session";
import { usePortfolio, useSettings, useToken, useTrades } from "@/lib/client/hooks";
import { useTradeFlow } from "@/lib/client/trade-flow";
import type { SettingsDTO } from "@/lib/client/types";
import { percentOf, toRaw } from "@/lib/domain/portfolio";
import { positionCycle, sellInitialFraction, type CycleTrade } from "@/lib/domain/live-trades";
import { SecondChanceModal } from "@/components/thesis/second-chance-modal";
import { cn } from "@/lib/utils";

const POS_KEY = "sc.instantPos";
const W = 412;
/** Approximate unscaled panel height, used to keep the top edge anchored when resizing from it. */
const H = 360;
const MIN_SCALE = 0.75;
const MAX_SCALE = 1.6;

type Instant = SettingsDTO["instant"];

/**
 * Floating quick-trade panel. One click buys a preset SOL amount or sells a
 * preset percent. Sells still go through the server's SECOND CHANCE check.
 * The pencil toggles edit mode for every value; saving writes to the account.
 */
export function InstantTrade() {
  const { selectedMint, selected, view, instantOpen, setInstantOpen, mode, toast } = useApp();
  const session = useSession();
  const { settings, limits, mutate: mutateSettings } = useSettings();
  const { data: tokenData } = useToken(selectedMint, selected);
  const { data: portfolio } = usePortfolio();
  const { data: tradesData } = useTrades();
  const { data: solData } = useSWR<{ solUsd: number | null }>("/api/market/sol-price", fetcher, { refreshInterval: 30_000 });
  const flow = useTradeFlow();

  // ----- position + scale (drag from anywhere, resize from edges/corners) -----
  // Resizing scales the whole panel uniformly, like pro terminals' quick-trade widgets.
  const [box, setBox] = useState<{ x: number; y: number; scale: number } | null>(null);
  useEffect(() => {
    let p: { x: number; y: number; scale?: number } | null = null;
    try {
      const raw = localStorage.getItem(POS_KEY);
      if (raw) p = JSON.parse(raw);
    } catch {
      /* ignore */
    }
    setBox(clampBox({ x: p?.x ?? window.innerWidth - W - 24, y: p?.y ?? window.innerHeight - 380, scale: p?.scale ?? 1 }));
    const onResize = () => setBox((q) => (q ? clampBox(q) : q));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const gesture = useRef<{ kind: "move" | "e" | "w" | "ne" | "nw" | "se" | "sw"; sx: number; sy: number; start: { x: number; y: number; scale: number } } | null>(null);
  const persist = (b: { x: number; y: number; scale: number }) => {
    try {
      localStorage.setItem(POS_KEY, JSON.stringify(b));
    } catch {
      /* ignore */
    }
  };
  const begin = (kind: NonNullable<typeof gesture.current>["kind"]) => (e: React.PointerEvent) => {
    if (!box) return;
    // Anything interactive keeps working; everything else drags the panel.
    if (kind === "move" && (e.target as HTMLElement).closest("button,input,select,textarea,label,a")) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    gesture.current = { kind, sx: e.clientX, sy: e.clientY, start: box };
  };
  const onMove = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (!g) return;
    const dx = e.clientX - g.sx;
    const dy = e.clientY - g.sy;
    const s = g.start;
    if (g.kind === "move") return setBox(clampBox({ ...s, x: s.x + dx, y: s.y + dy }));
    const w0 = W * s.scale;
    const grow = g.kind.includes("e") ? dx : -dx;
    const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, (w0 + grow) / W));
    const w1 = W * scale;
    const h0 = H * s.scale;
    const h1 = H * scale;
    setBox(
      clampBox({
        scale,
        x: g.kind.includes("w") ? s.x + (w0 - w1) : s.x,
        y: g.kind.startsWith("n") ? s.y + (h0 - h1) : s.y,
      }),
    );
  };
  const onUp = (e: React.PointerEvent) => {
    if (!gesture.current) return;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    gesture.current = null;
    setBox((b) => {
      if (b) persist(b);
      return b;
    });
  };
  const pos = box;

  // ----- editable values -----
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => toDraft(settings));
  useEffect(() => {
    if (!editing) setDraft(toDraft(settings));
  }, [settings, editing]);
  const [adv, setAdv] = useState(false);
  const [customBuy, setCustomBuy] = useState("");
  const [customSell, setCustomSell] = useState("");

  const saveEdits = useCallback(async () => {
    const parsed = fromDraft(draft, limits?.maxSlippageBps ?? 5000);
    if (!parsed.ok) {
      toast({ tone: "error", title: "Can't save", body: parsed.error });
      return;
    }
    try {
      await post("/api/settings", parsed.value, "PUT");
      await mutateSettings();
      setEditing(false);
      toast({ tone: "ok", title: "Instant Trade saved" });
    } catch (e) {
      toast({ tone: "error", title: "Couldn't save", body: (e as Error).message });
    }
  }, [draft, limits, mutateSettings, toast]);

  // ----- derived figures -----
  const token = tokenData?.token ?? null;
  const row = portfolio?.rows.find((r) => r.mint === selectedMint) ?? null;
  const solUsd = portfolio?.solUsd ?? solData?.solUsd ?? null;
  const qtyRaw = row ? BigInt(row.quantityRaw) : 0n;
  const holdingUsd = row?.marketValueUsd ?? (row && token?.priceUsd ? row.quantity * token.priceUsd : 0);

  const cycle = useMemo(() => {
    const list: CycleTrade[] = (tradesData?.trades ?? [])
      .filter((t) => t.mint === selectedMint && t.status === "confirmed")
      .map((t) => {
        const atSolUsd = t.priceUsd && t.priceSol ? t.priceUsd / t.priceSol : (solUsd ?? 0);
        const fees = Number(t.networkFeeLamports) + Number(t.platformFeeLamports);
        const sol = (t.side === "buy" ? Number(t.solAmountLamports) + fees : Number(t.solAmountLamports) - fees) / 1e9;
        return { side: t.side, tokenAmountRaw: BigInt(t.tokenAmountRaw), usd: Math.max(0, sol) * atSolUsd, timestamp: Date.parse(t.confirmedAt ?? t.createdAt) };
      });
    return positionCycle(list);
  }, [tradesData, selectedMint, solUsd]);

  const basisKnown = !row || row.costBasisStatus === "verified";
  const pnl = cycle.state === "open" ? cycle.soldUsd + holdingUsd - cycle.boughtUsd : cycle.state === "closed" ? cycle.soldUsd - cycle.boughtUsd : 0;
  const pnlPct = cycle.boughtUsd > 0 ? (pnl / cycle.boughtUsd) * 100 : 0;
  const stillInvested = Math.max(0, cycle.boughtUsd - cycle.soldUsd);
  const initFraction = cycle.state === "open" ? sellInitialFraction(stillInvested, holdingUsd) : null;

  // ----- guards -----
  const disabledReason =
    session.status !== "signed_in"
      ? "Connect and sign in to trade."
      : mode === "real" && !session.realTrading.enabled
        ? session.realTrading.reason
        : mode === "paper" && token && token.priceSol == null
          ? "No SOL pool for this token, so paper fills can't be priced."
          : null;
  const busy = !["idle", "done", "failed"].includes(flow.state.phase);

  const buy = (amount: string) => {
    if (disabledReason || busy || !token) return;
    let raw: bigint;
    try {
      raw = toRaw(amount, 9);
    } catch {
      return toast({ tone: "error", title: "Enter a SOL amount like 0.25" });
    }
    if (raw <= 0n) return;
    if (mode === "real" && limits && Number(amount) > limits.maxRealTradeSol) {
      return toast({ tone: "error", title: `Beta limit is ${limits.maxRealTradeSol} SOL per buy` });
    }
    void flow.start({
      side: "buy",
      mint: token.mint,
      symbol: token.symbol,
      amountRaw: raw.toString(),
      opts: { slippageBps: settings.instant.buySlippageBps, priorityFeeLamports: settings.instant.buyPriorityLamports },
      thesisDraft: null,
      marketCap: token.marketCap,
    });
  };

  const sellPct = (pct: number) => {
    if (disabledReason || busy || !token) return;
    if (qtyRaw <= 0n) return toast({ tone: "info", title: `You don't hold ${token.symbol}` });
    const p = Math.min(100, Math.max(0.01, Math.round(pct * 100) / 100));
    const raw = percentOf(qtyRaw, p);
    if (raw <= 0n) return;
    void flow.start({
      side: "sell",
      mint: token.mint,
      symbol: token.symbol,
      amountRaw: raw.toString(),
      opts: { slippageBps: settings.instant.sellSlippageBps, priorityFeeLamports: settings.instant.sellPriorityLamports },
    });
  };

  // Toast is enough feedback for completed instant trades; clear the flow so the next click works.
  useEffect(() => {
    if (flow.state.phase === "done") {
      const t = setTimeout(flow.reset, 400);
      return () => clearTimeout(t);
    }
  }, [flow.state.phase, flow.reset]);

  if (!instantOpen || view !== "trade" || !selectedMint || !pos) return null;

  const symbol = token?.symbol ?? "…";
  const sellEstimateSol = row && token?.priceSol ? (Number(qtyRaw) / 10 ** row.decimals) * token.priceSol : null;
  const s = settings.instant;

  return (
    <>
    <div
      className="fixed z-40 select-none"
      style={{ left: pos.x / pos.scale, top: pos.y / pos.scale, width: W, zoom: pos.scale }}
      role="dialog"
      aria-label="Instant Trade"
      onPointerDown={begin("move")}
      onPointerMove={onMove}
      onPointerUp={onUp}
    >
      {/* resize handles: left/right edges and all four corners */}
      {(["w", "e", "nw", "ne", "sw", "se"] as const).map((k) => (
        <span
          key={k}
          aria-hidden
          onPointerDown={begin(k)}
          onPointerMove={onMove}
          onPointerUp={onUp}
          className={cn(
            "absolute z-10",
            k === "w" && "inset-y-5 -left-1.5 w-3 cursor-ew-resize",
            k === "e" && "inset-y-5 -right-1.5 w-3 cursor-ew-resize",
            k === "nw" && "-left-1.5 -top-1.5 h-5 w-5 cursor-nwse-resize",
            k === "se" && "-bottom-1.5 -right-1.5 h-5 w-5 cursor-nwse-resize",
            k === "ne" && "-right-1.5 -top-1.5 h-5 w-5 cursor-nesw-resize",
            k === "sw" && "-bottom-1.5 -left-1.5 h-5 w-5 cursor-nesw-resize",
          )}
        />
      ))}
      <div className="cursor-grab overflow-hidden rounded-xl border border-line-strong bg-ink-1 text-[13px] shadow-2xl shadow-black/60 active:cursor-grabbing">
      {/* title row */}
      <div className="flex h-6 items-center justify-between px-2">
        <span className="flex items-center gap-1.5 text-2xs text-muted">
          <GripHorizontal size={12} /> {symbol} · {mode === "paper" ? "Paper" : "Real"}
        </span>
        <button type="button" aria-label="Close Instant Trade" onClick={() => setInstantOpen(false)} className="rounded p-0.5 text-muted hover:bg-ink-3 hover:text-fg">
          <X size={12} />
        </button>
      </div>

      <div className="flex flex-col gap-3 px-3 pb-3">
        {/* BUY header */}
        <div className="flex items-center gap-2">
          <span className="text-[15px] text-fg-soft">Buy</span>
          <span className="flex items-center gap-1.5 rounded-full border border-line-strong bg-ink-2 py-0.5 pl-1 pr-2.5 text-xs">
            <SolGlyph /> SOL
          </span>
          <span className="ml-auto flex items-center gap-1.5 text-xs text-fg-soft" title={mode === "paper" ? "Paper SOL balance" : "Wallet SOL balance"}>
            <SolGlyph small /> <span className="num">{portfolio?.solBalance != null ? trimNum(portfolio.solBalance, 3) : "0"}</span>
          </span>
          <button
            type="button"
            aria-label={editing ? "Save Instant Trade values" : "Edit Instant Trade values"}
            title={editing ? "Save" : "Edit values"}
            onClick={() => (editing ? void saveEdits() : setEditing(true))}
            className={cn("rounded p-1 hover:bg-ink-3", editing ? "text-buy" : "text-muted hover:text-fg")}
          >
            {editing ? <Check size={15} /> : <SquarePen size={15} />}
          </button>
        </div>

        {/* buy presets */}
        <div className="grid grid-cols-4 gap-2">
          {draft.buy.map((v, i) =>
            editing ? (
              <input
                key={i}
                aria-label={`Buy preset ${i + 1} (SOL)`}
                value={v}
                inputMode="decimal"
                onChange={(e) => setDraft({ ...draft, buy: draft.buy.map((x, j) => (j === i ? e.target.value.replace(/[^\d.]/g, "") : x)) })}
                className="h-9 w-full rounded-full border border-buy/60 bg-ink-0 text-center text-[15px] text-buy num focus:outline-none focus:ring-1 focus:ring-buy"
              />
            ) : (
              <button
                key={i}
                type="button"
                onClick={() => buy(v)}
                disabled={!!disabledReason || busy}
                className="h-9 rounded-full border border-buy/50 text-[15px] text-buy num transition-colors hover:bg-buy/10 disabled:opacity-40"
              >
                {v}
              </button>
            ),
          )}
        </div>

        {/* buy settings */}
        <SettingsRow
          editing={editing}
          slippage={draft.buySlip}
          priority={draft.buyPrio}
          onSlippage={(v) => setDraft({ ...draft, buySlip: v })}
          onPriority={(v) => setDraft({ ...draft, buyPrio: v })}
          right={
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-fg-soft">
              <input type="checkbox" checked={adv} onChange={(e) => setAdv(e.target.checked)} className="h-3.5 w-3.5 accent-[#e9a23b]" />
              Adv.
            </label>
          }
          idPrefix="ib"
        />
        {adv && !editing && (
          <form className="flex gap-2" onSubmit={(e) => (e.preventDefault(), buy(customBuy))}>
            <input id="instant-custom-buy" value={customBuy} onChange={(e) => setCustomBuy(e.target.value.replace(/[^\d.]/g, ""))} placeholder="Custom SOL" inputMode="decimal" className="h-8 flex-1 rounded-full border border-line bg-ink-0 px-3 text-xs num focus:border-buy/60 focus:outline-none" />
            <button type="submit" disabled={!!disabledReason || busy || !(Number(customBuy) > 0)} className="h-8 rounded-full bg-buy px-4 text-xs font-medium text-ink-0 disabled:opacity-40">
              Buy
            </button>
          </form>
        )}

        <div className="h-px bg-line" />

        {/* SELL header */}
        <div className="flex items-center gap-2">
          <span className="text-[15px] text-fg-soft">Sell</span>
          <span className="text-xs text-muted">%</span>
          <span className="ml-auto flex items-center gap-1.5 text-xs text-fg-soft num">
            {row ? trimNum(row.quantity, 2) : "0"} {symbol}
            <span className="text-muted">·</span>${trimNum(holdingUsd, 2)}
            <span className="text-muted">·</span>
            <SolGlyph small /> {sellEstimateSol != null ? trimNum(sellEstimateSol, 3) : "0"}
          </span>
        </div>

        {/* sell presets */}
        <div className="grid grid-cols-4 gap-2">
          {draft.sell.map((v, i) =>
            editing ? (
              <input
                key={i}
                aria-label={`Sell preset ${i + 1} (%)`}
                value={v}
                inputMode="decimal"
                onChange={(e) => setDraft({ ...draft, sell: draft.sell.map((x, j) => (j === i ? e.target.value.replace(/[^\d.]/g, "") : x)) })}
                className="h-9 w-full rounded-full border border-sell/60 bg-ink-0 text-center text-[15px] text-sell num focus:outline-none focus:ring-1 focus:ring-sell"
              />
            ) : (
              <button
                key={i}
                type="button"
                onClick={() => sellPct(Number(v))}
                disabled={!!disabledReason || busy || qtyRaw <= 0n}
                className="h-9 rounded-full border border-sell/50 text-[15px] text-sell num transition-colors hover:bg-sell/10 disabled:opacity-40"
              >
                {v}%
              </button>
            ),
          )}
        </div>

        {/* sell settings */}
        <SettingsRow
          editing={editing}
          slippage={draft.sellSlip}
          priority={draft.sellPrio}
          onSlippage={(v) => setDraft({ ...draft, sellSlip: v })}
          onPriority={(v) => setDraft({ ...draft, sellPrio: v })}
          right={
            <button
              type="button"
              onClick={() => initFraction != null && sellPct(initFraction * 100)}
              disabled={!!disabledReason || busy || initFraction == null}
              title={
                initFraction == null
                  ? stillInvested <= 0 && cycle.state === "open"
                    ? "Your initial investment is already out"
                    : "Buy first to use Sell Init."
                  : `Sell ${(initFraction * 100).toFixed(1)}% to take back your initial investment`
              }
              className="text-xs text-sell hover:brightness-125 disabled:opacity-40"
            >
              Sell Init.
            </button>
          }
          idPrefix="is"
        />
        {adv && !editing && (
          <form className="flex gap-2" onSubmit={(e) => (e.preventDefault(), sellPct(Number(customSell)))}>
            <input id="instant-custom-sell" value={customSell} onChange={(e) => setCustomSell(e.target.value.replace(/[^\d.]/g, ""))} placeholder="Custom %" inputMode="decimal" className="h-8 flex-1 rounded-full border border-line bg-ink-0 px-3 text-xs num focus:border-sell/60 focus:outline-none" />
            <button type="submit" disabled={!!disabledReason || busy || qtyRaw <= 0n || !(Number(customSell) > 0)} className="h-8 rounded-full bg-sell px-4 text-xs font-medium text-ink-0 disabled:opacity-40">
              Sell
            </button>
          </form>
        )}

        {editing && (
          <p className="text-2xs text-muted">
            Edit any value, then press the check to save. Slippage up to {(limits?.maxSlippageBps ?? 2000) / 100}% on this server.
          </p>
        )}
        {disabledReason && !editing && <p className="text-2xs text-muted">{disabledReason}</p>}
        {(busy || flow.state.phase === "failed") && !flow.state.intent?.acknowledgement && flow.state.phase !== "reminder" && (
          <p className={cn("text-2xs", flow.state.phase === "failed" ? "text-sell" : "text-signal")}>
            {flow.state.phase === "failed" ? flow.state.error : phaseText(flow.state.phase)}
            {flow.state.phase === "failed" && (
              <button type="button" onClick={flow.reset} className="ml-2 text-muted underline">
                Dismiss
              </button>
            )}
          </p>
        )}
      </div>

      {/* footer: bought | sold | holding | pnl */}
      <div className="grid grid-cols-4 border-t border-line text-center text-[13px] num">
        <Cell title="Bought (USD, incl. fees)" className="text-buy">${trimNum(cycle.boughtUsd, 2)}</Cell>
        <Cell title="Sold (USD, net of fees)" className="text-sell">${trimNum(cycle.soldUsd, 2)}</Cell>
        <Cell title="Holding now (USD)" className="text-fg">${trimNum(cycle.state === "closed" ? 0 : holdingUsd, 2)}</Cell>
        <Cell
          title={!basisKnown ? "Some tokens came from outside this terminal, so PnL can't be computed" : cycle.state === "closed" ? "Closed PnL for your last position" : "Live PnL: sold + holding − bought"}
          className={cn(!basisKnown || cycle.state === "none" ? "text-fg-soft" : pnl >= 0 ? "text-buy" : "text-sell")}
          last
        >
          {!basisKnown ? (
            "—"
          ) : (
            <>
              {cycle.state === "closed" && <span className="mr-1 text-2xs text-muted">Closed</span>}
              {pnl >= 0 ? "+" : "-"}${trimNum(Math.abs(pnl), 3)}
              <span className="text-xs">({pnl >= 0 ? "+" : ""}{pnlPct.toFixed(0)}%)</span>
            </>
          )}
        </Cell>
      </div>
      </div>
    </div>
    <SecondChanceModal flow={flow} estimateSol={null} sellLabel={`Sell ${symbol}`} />
    </>
  );
}

function SettingsRow({
  editing,
  slippage,
  priority,
  onSlippage,
  onPriority,
  right,
  idPrefix,
}: {
  editing: boolean;
  slippage: string;
  priority: string;
  onSlippage: (v: string) => void;
  onPriority: (v: string) => void;
  right: React.ReactNode;
  idPrefix: string;
}) {
  return (
    <div className="flex items-center gap-4 text-xs text-fg-soft">
      <span className="flex items-center gap-1.5" title="Slippage">
        <Mountain size={13} className="text-muted" />
        {editing ? (
          <>
            <input id={`${idPrefix}-slip`} aria-label="Slippage percent" value={slippage} onChange={(e) => onSlippage(e.target.value.replace(/[^\d.]/g, ""))} className="h-6 w-12 rounded border border-line bg-ink-0 px-1 text-xs num focus:border-signal/60 focus:outline-none" />%
          </>
        ) : (
          <span className="num">{slippage}%</span>
        )}
      </span>
      <span className="flex items-center gap-1.5" title="Priority fee (SOL)">
        <Fuel size={13} className="text-muted" />
        {editing ? (
          <input id={`${idPrefix}-prio`} aria-label="Priority fee in SOL" value={priority} onChange={(e) => onPriority(e.target.value.replace(/[^\d.]/g, ""))} className="h-6 w-16 rounded border border-line bg-ink-0 px-1 text-xs num focus:border-signal/60 focus:outline-none" />
        ) : (
          <span className="num">{subscriptZeros(priority)}</span>
        )}
      </span>
      <span className="ml-auto">{right}</span>
    </div>
  );
}

function Cell({ children, className, title, last }: { children: React.ReactNode; className?: string; title: string; last?: boolean }) {
  return (
    <div title={title} className={cn("flex items-center justify-center gap-0.5 whitespace-nowrap px-1 py-2.5", !last && "border-r border-line", className)}>
      {children}
    </div>
  );
}

/** Small SOL mark: three slanted bars in the token's gradient colours. */
function SolGlyph({ small }: { small?: boolean }) {
  const s = small ? 11 : 14;
  return (
    <svg width={s} height={s} viewBox="0 0 16 16" aria-hidden>
      <defs>
        <linearGradient id="solg" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#9945FF" />
          <stop offset="1" stopColor="#14F195" />
        </linearGradient>
      </defs>
      <path d="M3.5 3h10l-1.5 2h-10z M2 7h10l1.5 2h-10z M3.5 11h10l-1.5 2h-10z" fill="url(#solg)" />
    </svg>
  );
}

interface Draft {
  buy: string[];
  sell: string[];
  buySlip: string;
  buyPrio: string;
  sellSlip: string;
  sellPrio: string;
}

function toDraft(s: SettingsDTO): Draft {
  const buy = [...s.buyPresetsSol, "0.1", "0.2", "0.4", "0.5"].slice(0, 4);
  const sell = [...s.sellPresetsPct.map(String), "10", "25", "50", "100"].slice(0, 4);
  return {
    buy,
    sell,
    buySlip: String(s.instant.buySlippageBps / 100),
    buyPrio: String(Number(s.instant.buyPriorityLamports) / 1e9),
    sellSlip: String(s.instant.sellSlippageBps / 100),
    sellPrio: String(Number(s.instant.sellPriorityLamports) / 1e9),
  };
}

function fromDraft(d: Draft, maxSlipBps: number): { ok: true; value: Partial<SettingsDTO> & { instant: Instant } } | { ok: false; error: string } {
  if (!d.buy.every((v) => /^\d+(\.\d{1,9})?$/.test(v) && Number(v) > 0)) return { ok: false, error: "Buy amounts must be SOL values like 0.25." };
  const sell = d.sell.map(Number);
  if (!sell.every((v) => v > 0 && v <= 100)) return { ok: false, error: "Sell presets must be percents from 1 to 100." };
  const bs = Math.round(Number(d.buySlip) * 100);
  const ss = Math.round(Number(d.sellSlip) * 100);
  if (!(bs >= 1 && bs <= maxSlipBps) || !(ss >= 1 && ss <= maxSlipBps)) return { ok: false, error: `Slippage must be between 0.01% and ${maxSlipBps / 100}%.` };
  const bp = Math.round(Number(d.buyPrio) * 1e9);
  const sp = Math.round(Number(d.sellPrio) * 1e9);
  if (!(bp >= 0) || !(sp >= 0) || bp > 1e9 || sp > 1e9) return { ok: false, error: "Priority fee must be between 0 and 1 SOL." };
  return {
    ok: true,
    value: {
      buyPresetsSol: d.buy,
      sellPresetsPct: sell,
      instant: { buySlippageBps: bs, buyPriorityLamports: String(bp), sellSlippageBps: ss, sellPriorityLamports: String(sp) },
    },
  };
}

/** Keep at least part of the panel on screen. Coordinates are in screen pixels. */
function clampBox(b: { x: number; y: number; scale: number }) {
  if (typeof window === "undefined") return b;
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, b.scale || 1));
  const w = W * scale;
  // CSS zoom also scales left/top, so store screen px and divide when rendering.
  return {
    scale,
    x: Math.min(Math.max(8 - w + 80, b.x), window.innerWidth - 80),
    y: Math.min(Math.max(8, b.y), window.innerHeight - 60),
  };
}

function trimNum(n: number, digits: number): string {
  if (!Number.isFinite(n)) return "0";
  if (Math.abs(n) >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  return n.toFixed(digits).replace(/\.?0+$/, "") || "0";
}

/** 0.0005 → "0.0₃5", the compact notation pro terminals use for tiny fees. */
function subscriptZeros(v: string): string {
  const m = /^0\.(0{3,})(\d+)$/.exec(v);
  if (!m) return v;
  const sub = String(m[1].length).split("").map((d) => "₀₁₂₃₄₅₆₇₈₉"[Number(d)]).join("");
  return `0.0${sub}${m[2]}`;
}

function phaseText(p: string): string {
  return (
    {
      starting: "Checking your plan…",
      quoting: "Getting a quote…",
      signing: "Approve in your wallet…",
      submitting: "Submitting…",
      confirming: "Confirming on-chain…",
      confirm: "Confirm in the dialog",
    } as Record<string, string>
  )[p] ?? "Working…";
}
