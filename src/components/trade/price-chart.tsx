"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import type { IChartApi, IPriceLine, ISeriesApi, UTCTimestamp } from "lightweight-charts";
import { fetcher } from "@/lib/client/api";
import type { LiveTradeDTO, ThesisDTO, TokenSnapshot, TradeDTO } from "@/lib/client/types";
import type { Candle } from "@/lib/domain/market";
import { candlesFromTrades, mergeCandles } from "@/lib/domain/live-trades";
import { compactUsd, tokenPrice } from "@/lib/domain/format";
import { Segmented } from "@/components/ui/segmented";
import { cn } from "@/lib/utils";

type Tf = "1s" | "15s" | "30s" | "1m" | "5m" | "15m" | "1h" | "4h" | "1d";
const TF_SECONDS: Record<Tf, number> = { "1s": 1, "15s": 15, "30s": 30, "1m": 60, "5m": 300, "15m": 900, "1h": 3600, "4h": 14400, "1d": 86400 };
/** Sub-minute timeframes are built entirely from live swaps (providers don't serve them). */
const TRADES_ONLY: Tf[] = ["1s", "15s", "30s"];
const REFRESH_MS: Partial<Record<Tf, number>> = { "1m": 15_000, "5m": 20_000, "15m": 45_000, "1h": 60_000, "4h": 120_000, "1d": 300_000 };

const C = { bg: "#0c0f13", grid: "#151a21", text: "#7f8a99", line: "#242b36", buy: "#38c98b", sell: "#ee5d66", signal: "#e9a23b", fg: "#b9c1cc" };

interface Bubble {
  key: string;
  label: "B" | "S" | "DB" | "DS";
  time: number; // unix seconds (exact)
  priceUsd: number;
  title: string;
}

/**
 * Candles: GeckoTerminal OHLCV, refreshed and extended by live swaps so brand-new
 * tokens get a full chart from their first trade. Bubbles mark your buys (B) and
 * sells (S), and the creator's buys (DB) and sells (DS).
 */
export function PriceChart({ token, thesis, trades }: { token: TokenSnapshot; thesis: ThesisDTO | null; trades: TradeDTO[] }) {
  const wrap = useRef<HTMLDivElement>(null);
  const el = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const linesRef = useRef<IPriceLine[]>([]);
  const baseRef = useRef<Candle[]>([]); // provider OHLCV
  const shownRef = useRef<Candle[]>([]); // what's on screen
  const firstPaint = useRef(true);
  const loadingMore = useRef(false);
  const [tf, setTf] = useState<Tf>("1m");
  const [unit, setUnit] = useState<"price" | "mcap">("mcap");
  const [status, setStatus] = useState<"loading" | "ready" | "empty" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [ready, setReady] = useState(false);
  const [positions, setPositions] = useState<{ key: string; x: number; y: number; b: Bubble }[]>([]);

  // Live swaps (shared with the Trades tab via the same SWR key) and the dev wallet.
  const { data: live } = useSWR<{ trades: LiveTradeDTO[] }>(`/api/market/trades?mint=${token.mint}`, fetcher, { refreshInterval: 5_000, keepPreviousData: true });
  const { data: dev } = useSWR<{ creator: string | null }>(`/api/market/dev/${token.mint}`, fetcher, { revalidateOnFocus: false });
  const liveRef = useRef(live);
  liveRef.current = live;

  const factor = useMemo(() => {
    if (unit === "price") return 1;
    if (token.marketCap && token.priceUsd && token.priceUsd > 0) return token.marketCap / token.priceUsd;
    return 1;
  }, [unit, token.marketCap, token.priceUsd]);
  const factorRef = useRef(factor);
  factorRef.current = factor;
  const effectiveUnit = factor === 1 ? "price" : unit;

  // ---------------------------------------------------------------- chart setup
  useEffect(() => {
    let disposed = false;
    (async () => {
      const lc = await import("lightweight-charts");
      if (disposed || !el.current) return;
      const fmt = (p: number) => (factorRef.current === 1 ? tokenPrice(p) : compactUsd(p));
      const chart = lc.createChart(el.current, {
        autoSize: true,
        layout: { background: { type: lc.ColorType.Solid, color: C.bg }, textColor: C.text, fontFamily: "'IBM Plex Sans', system-ui, sans-serif", fontSize: 11 },
        grid: { vertLines: { color: C.grid }, horzLines: { color: C.grid } },
        crosshair: { mode: lc.CrosshairMode.Normal, vertLine: { color: C.line, labelBackgroundColor: "#1d232d" }, horzLine: { color: C.line, labelBackgroundColor: "#1d232d" } },
        rightPriceScale: { borderColor: C.line },
        timeScale: { borderColor: C.line, timeVisible: true, secondsVisible: false, rightOffset: 8, barSpacing: 7, minBarSpacing: 1 },
        localization: { priceFormatter: fmt },
      });
      const candle = chart.addCandlestickSeries({
        upColor: C.buy,
        downColor: C.sell,
        wickUpColor: C.buy,
        wickDownColor: C.sell,
        borderVisible: false,
        priceFormat: { type: "custom", minMove: 1e-12, formatter: fmt },
      });
      candle.priceScale().applyOptions({ scaleMargins: { top: 0.1, bottom: 0.22 } });
      // Volume lives on its own hidden scale and never shows a label on the price axis.
      const vol = chart.addHistogramSeries({ priceFormat: { type: "volume" }, priceScaleId: "vol", lastValueVisible: false, priceLineVisible: false });
      vol.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 }, visible: false });
      chartRef.current = chart;
      candleRef.current = candle;
      volRef.current = vol;
      setReady(true);
    })();
    return () => {
      disposed = true;
      chartRef.current?.remove();
      chartRef.current = null;
      candleRef.current = null;
      volRef.current = null;
      linesRef.current = [];
    };
  }, []);

  const paint = useCallback((candles: Candle[]) => {
    const f = factorRef.current;
    shownRef.current = candles;
    candleRef.current?.setData(candles.map((c) => ({ time: c.time as UTCTimestamp, open: c.open * f, high: c.high * f, low: c.low * f, close: c.close * f })));
    volRef.current?.setData(candles.map((c) => ({ time: c.time as UTCTimestamp, value: c.volume, color: c.close >= c.open ? "#38c98b55" : "#ee5d6655" })));
    if (firstPaint.current && candles.length) {
      firstPaint.current = false;
      const ts = chartRef.current?.timeScale();
      // Few candles: keep normal candle width and pin to the right edge instead of stretching.
      if (candles.length < 90) {
        ts?.applyOptions({ barSpacing: 8 });
        ts?.scrollToRealTime();
      } else ts?.fitContent();
    }
  }, []);

  // Recompose provider candles + trade candles whenever either changes.
  const recompose = useCallback(() => {
    const step = TF_SECONDS[tf];
    const l = liveRef.current;
    const fromTrades = candlesFromTrades(l?.trades ?? [], step);
    const merged = TRADES_ONLY.includes(tf) ? fromTrades : mergeCandles(baseRef.current, fromTrades);
    paint(merged);
    setStatus(merged.length ? "ready" : l ? "empty" : "loading");
  }, [tf, paint]);

  // ---------------------------------------------------------------- provider OHLCV
  useEffect(() => {
    if (!ready) return;
    chartRef.current?.timeScale().applyOptions({ secondsVisible: TF_SECONDS[tf] < 60 });
    firstPaint.current = true;
    baseRef.current = [];
    if (TRADES_ONLY.includes(tf)) {
      recompose();
      return;
    }
    let cancelled = false;
    setStatus("loading");
    const load = async () => {
      try {
        const { candles } = await fetcher<{ candles: Candle[] }>(`/api/market/candles?pair=${token.pairAddress}&tf=${tf}`);
        if (cancelled) return;
        // Keep older history the user panned into.
        const byTime = new Map(baseRef.current.map((c) => [c.time, c]));
        for (const c of candles) byTime.set(c.time, c);
        baseRef.current = [...byTime.values()].sort((a, b) => a.time - b.time);
        recompose();
      } catch (e) {
        if (cancelled) return;
        if (!shownRef.current.length) {
          // No provider history yet: trade candles alone are still useful.
          recompose();
          if (!liveRef.current?.trades?.length) {
            setStatus("error");
            setErrorMsg((e as Error).message);
          }
        }
      }
    };
    void load();
    const id = setInterval(load, REFRESH_MS[tf] ?? 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, token.pairAddress, tf]);

  // New swaps → refresh the candles immediately.
  useEffect(() => {
    if (ready) recompose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, live]);

  // Price ↔ market cap.
  useEffect(() => {
    if (ready && shownRef.current.length) paint(shownRef.current);
  }, [factor, ready, paint]);

  // Older provider history when panning left.
  useEffect(() => {
    if (!ready || !chartRef.current || TRADES_ONLY.includes(tf)) return;
    const ts = chartRef.current.timeScale();
    const handler = async (range: { from: number; to: number } | null) => {
      if (!range || range.from > 10 || loadingMore.current || !baseRef.current.length) return;
      loadingMore.current = true;
      try {
        const first = baseRef.current[0].time;
        const { candles } = await fetcher<{ candles: Candle[] }>(`/api/market/candles?pair=${token.pairAddress}&tf=${tf}&before=${first}`);
        const older = candles.filter((c) => c.time < first);
        if (older.length) {
          baseRef.current = [...older, ...baseRef.current];
          recompose();
        }
      } catch {
        /* keep current view */
      } finally {
        setTimeout(() => (loadingMore.current = false), 1500);
      }
    };
    ts.subscribeVisibleLogicalRangeChange(handler);
    return () => ts.unsubscribeVisibleLogicalRangeChange(handler);
  }, [ready, token.pairAddress, tf, recompose]);

  // ---------------------------------------------------------------- thesis lines
  useEffect(() => {
    const candle = candleRef.current;
    if (!ready || !candle) return;
    for (const l of linesRef.current) candle.removePriceLine(l);
    linesRef.current = [];
    const toUnit = (mc: number) => (factor === 1 ? (token.priceUsd && token.marketCap ? (mc / token.marketCap) * token.priceUsd : null) : mc);
    if (!thesis) return;
    const target = toUnit(thesis.targetMarketCap);
    if (target) linesRef.current.push(candle.createPriceLine({ price: target, color: C.signal, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: `Target ${compactUsd(thesis.targetMarketCap)}` }));
    if (thesis.entryMarketCap) {
      const entry = toUnit(thesis.entryMarketCap);
      if (entry) linesRef.current.push(candle.createPriceLine({ price: entry, color: C.fg, lineWidth: 1, lineStyle: 1, axisLabelVisible: true, title: "Entry" }));
    }
    for (const ex of thesis.plannedExits) {
      const p = toUnit(ex.atMarketCap);
      if (p) linesRef.current.push(candle.createPriceLine({ price: p, color: "#e9a23b88", lineWidth: 1, lineStyle: 3, axisLabelVisible: false, title: `Exit ${ex.sellPercent}%` }));
    }
  }, [ready, thesis, factor, token.priceUsd, token.marketCap]);

  // ---------------------------------------------------------------- bubbles
  const bubbles = useMemo<Bubble[]>(() => {
    const out: Bubble[] = [];
    for (const t of trades) {
      if (t.status !== "confirmed" || !t.priceUsd) continue;
      const time = Math.floor(Date.parse(t.confirmedAt ?? t.createdAt) / 1000);
      const tokens = Number(t.tokenAmountRaw) / 10 ** t.tokenDecimals;
      out.push({
        key: `u:${t.id}`,
        label: t.side === "buy" ? "B" : "S",
        time,
        priceUsd: t.priceUsd,
        title: `You ${t.side === "buy" ? "bought" : "sold"} ${tokens.toLocaleString(undefined, { maximumFractionDigits: 2 })}${t.simulated ? " (paper)" : ""} · MC ${compactUsd(t.marketCap)}`,
      });
    }
    const creator = dev?.creator;
    if (creator) {
      for (const t of live?.trades ?? []) {
        if (t.trader !== creator) continue;
        out.push({
          key: `d:${t.id}`,
          label: t.kind === "buy" ? "DB" : "DS",
          time: Math.floor(t.timestamp / 1000),
          priceUsd: t.priceUsd,
          title: `Dev ${t.kind === "buy" ? "bought" : "sold"} $${t.volumeUsd.toFixed(2)} · MC ${compactUsd(t.marketCap)}`,
        });
      }
    }
    return out;
  }, [trades, live, dev]);

  const layoutBubbles = useCallback(() => {
    const chart = chartRef.current;
    const series = candleRef.current;
    if (!chart || !series || !shownRef.current.length) return setPositions([]);
    const step = TF_SECONDS[tf];
    const first = shownRef.current[0].time;
    const ts = chart.timeScale();
    const f = factorRef.current;
    const next: { key: string; x: number; y: number; b: Bubble }[] = [];
    const stack = new Map<string, number>();
    for (const b of bubbles) {
      const bucket = Math.floor(b.time / step) * step;
      if (bucket < first) continue;
      const x = ts.timeToCoordinate(bucket as UTCTimestamp);
      const y = series.priceToCoordinate(b.priceUsd * f);
      if (x == null || y == null) continue;
      // Nudge overlapping bubbles in the same candle so each stays readable.
      const k = `${bucket}:${Math.round(y / 12)}`;
      const n = stack.get(k) ?? 0;
      stack.set(k, n + 1);
      next.push({ key: b.key, x, y: y + (b.label === "B" || b.label === "DB" ? n * 14 : -n * 14), b });
    }
    setPositions(next);
  }, [bubbles, tf]);

  useEffect(() => {
    if (!ready || !chartRef.current) return;
    const ts = chartRef.current.timeScale();
    const h = () => requestAnimationFrame(layoutBubbles);
    ts.subscribeVisibleLogicalRangeChange(h);
    h();
    // Vertical autoscale and price↔mcap changes don't emit range events; poll lightly.
    const id = setInterval(h, 400);
    return () => {
      ts.unsubscribeVisibleLogicalRangeChange(h);
      clearInterval(id);
    };
  }, [ready, layoutBubbles]);

  return (
    <div className="relative flex h-full min-h-[320px] flex-col lg:min-h-0">
      <div className="flex flex-wrap items-center gap-2 px-3 py-1.5">
        <Segmented size="xs" value={tf} onChange={setTf} options={(Object.keys(TF_SECONDS) as Tf[]).map((t) => ({ value: t, label: t }))} />
        <Segmented
          size="xs"
          value={effectiveUnit}
          onChange={setUnit}
          options={[
            { value: "mcap", label: "Market cap" },
            { value: "price", label: "Price" },
          ]}
        />
        <span className="ml-auto flex items-center gap-3 text-2xs text-muted">
          <Legend label="B" tone="buy" text="Your buy" />
          <Legend label="S" tone="sell" text="Your sell" />
          {dev?.creator && (
            <>
              <Legend label="DB" tone="buy" text="Dev buy" />
              <Legend label="DS" tone="sell" text="Dev sell" />
            </>
          )}
          {thesis && (
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-px w-4 border-t border-dashed border-signal" /> Target
            </span>
          )}
        </span>
      </div>
      <div ref={wrap} className="relative min-h-0 flex-1 overflow-hidden">
        <div ref={el} className="absolute inset-0" />
        {/* bubble overlay */}
        <div className="pointer-events-none absolute inset-0">
          {positions.map(({ key, x, y, b }) => (
            <span
              key={key}
              title={b.title}
              className={cn(
                "pointer-events-auto absolute flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-[#0c0f13] font-semibold text-white shadow-md shadow-black/50",
                b.label.length === 1 ? "h-[22px] w-[22px] text-[11px]" : "h-[26px] w-[26px] text-[10px]",
                b.label === "B" || b.label === "DB" ? "bg-[#1f9d6a]" : "bg-[#d64550]",
              )}
              style={{ left: x, top: y }}
            >
              {b.label}
            </span>
          ))}
        </div>
        {status !== "ready" && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-muted">
            {status === "loading" && "Loading candles…"}
            {status === "empty" && "No trades yet for this token."}
            {status === "error" && <span className="text-sell">Chart data unavailable: {errorMsg}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

function Legend({ label, tone, text }: { label: string; tone: "buy" | "sell"; text: string }) {
  return (
    <span className="flex items-center gap-1" title={text}>
      <span className={cn("flex h-4 min-w-4 items-center justify-center rounded-full px-0.5 text-[8px] font-semibold text-white", tone === "buy" ? "bg-[#1f9d6a]" : "bg-[#d64550]")}>{label}</span>
      <span className="max-xl:hidden">{text}</span>
    </span>
  );
}
