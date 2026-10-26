"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { IChartApi, IPriceLine, ISeriesApi, SeriesMarker, Time, UTCTimestamp } from "lightweight-charts";
import { fetcher } from "@/lib/client/api";
import type { ThesisDTO, TokenSnapshot, TradeDTO } from "@/lib/client/types";
import type { Candle } from "@/lib/domain/market";
import { compactUsd, tokenPrice } from "@/lib/domain/format";
import { Segmented } from "@/components/ui/segmented";

type Tf = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";
const TF_SECONDS: Record<Tf, number> = { "1m": 60, "5m": 300, "15m": 900, "1h": 3600, "4h": 14400, "1d": 86400 };
const REFRESH_MS: Record<Tf, number> = { "1m": 10_000, "5m": 20_000, "15m": 45_000, "1h": 60_000, "4h": 120_000, "1d": 300_000 };

const C = { bg: "#0c0f13", grid: "#151a21", text: "#7f8a99", line: "#242b36", buy: "#38c98b", sell: "#ee5d66", signal: "#e9a23b", fg: "#b9c1cc" };

/**
 * Candles come from GeckoTerminal OHLCV for the token's most liquid pool.
 * "Market cap" view scales OHLC by circulating supply (marketCap / price),
 * which is constant for a given token, so the shape is identical.
 */
export function PriceChart({ token, thesis, trades }: { token: TokenSnapshot; thesis: ThesisDTO | null; trades: TradeDTO[] }) {
  const el = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const linesRef = useRef<IPriceLine[]>([]);
  const dataRef = useRef<Candle[]>([]);
  const loadingMore = useRef(false);
  const [tf, setTf] = useState<Tf>("5m");
  const [unit, setUnit] = useState<"price" | "mcap">("mcap");
  const [status, setStatus] = useState<"loading" | "ready" | "empty" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [ready, setReady] = useState(false);

  const factor = useMemo(() => {
    if (unit === "price") return 1;
    if (token.marketCap && token.priceUsd && token.priceUsd > 0) return token.marketCap / token.priceUsd;
    return 1;
  }, [unit, token.marketCap, token.priceUsd]);
  const factorRef = useRef(factor);
  factorRef.current = factor;
  const effectiveUnit = factor === 1 ? "price" : unit;

  // Create the chart once.
  useEffect(() => {
    let disposed = false;
    let ro: ResizeObserver | null = null;
    (async () => {
      const lc = await import("lightweight-charts");
      if (disposed || !el.current) return;
      const chart = lc.createChart(el.current, {
        autoSize: true,
        layout: { background: { type: lc.ColorType.Solid, color: C.bg }, textColor: C.text, fontFamily: "'IBM Plex Sans', system-ui, sans-serif", fontSize: 11 },
        grid: { vertLines: { color: C.grid }, horzLines: { color: C.grid } },
        crosshair: { mode: lc.CrosshairMode.Normal, vertLine: { color: C.line, labelBackgroundColor: "#1d232d" }, horzLine: { color: C.line, labelBackgroundColor: "#1d232d" } },
        rightPriceScale: { borderColor: C.line },
        timeScale: { borderColor: C.line, timeVisible: true, secondsVisible: false, rightOffset: 6 },
        localization: { priceFormatter: (p: number) => (factorRef.current === 1 ? tokenPrice(p) : compactUsd(p)) },
      });
      const candle = chart.addCandlestickSeries({
        upColor: C.buy,
        downColor: C.sell,
        wickUpColor: C.buy,
        wickDownColor: C.sell,
        borderVisible: false,
        priceFormat: { type: "custom", minMove: 1e-12, formatter: (p: number) => (factorRef.current === 1 ? tokenPrice(p) : compactUsd(p)) },
      });
      candle.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: 0.24 } });
      const vol = chart.addHistogramSeries({ priceFormat: { type: "volume" }, priceScaleId: "vol" });
      vol.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
      chartRef.current = chart;
      candleRef.current = candle;
      volRef.current = vol;
      setReady(true);
      ro = new ResizeObserver(() => chart.timeScale().applyOptions({}));
      ro.observe(el.current);
    })();
    return () => {
      disposed = true;
      ro?.disconnect();
      chartRef.current?.remove();
      chartRef.current = null;
      candleRef.current = null;
      volRef.current = null;
      linesRef.current = [];
    };
  }, []);

  const paint = (candles: Candle[]) => {
    const f = factorRef.current;
    candleRef.current?.setData(candles.map((c) => ({ time: c.time as UTCTimestamp, open: c.open * f, high: c.high * f, low: c.low * f, close: c.close * f })));
    volRef.current?.setData(candles.map((c) => ({ time: c.time as UTCTimestamp, value: c.volume, color: c.close >= c.open ? "#38c98b55" : "#ee5d6655" })));
  };

  // Load candles for pair + timeframe; refresh on an interval.
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    setStatus("loading");
    const load = async (initial: boolean) => {
      try {
        const { candles } = await fetcher<{ candles: Candle[] }>(`/api/market/candles?pair=${token.pairAddress}&tf=${tf}`);
        if (cancelled) return;
        if (initial) {
          dataRef.current = candles;
          paint(candles);
          chartRef.current?.timeScale().fitContent();
          setStatus(candles.length ? "ready" : "empty");
        } else if (candles.length) {
          // Merge newest candles into what we have (keeps any older history the user scrolled in).
          const byTime = new Map(dataRef.current.map((c) => [c.time, c]));
          for (const c of candles) byTime.set(c.time, c);
          dataRef.current = [...byTime.values()].sort((a, b) => a.time - b.time);
          const f = factorRef.current;
          for (const c of candles.slice(-2)) {
            candleRef.current?.update({ time: c.time as UTCTimestamp, open: c.open * f, high: c.high * f, low: c.low * f, close: c.close * f });
            volRef.current?.update({ time: c.time as UTCTimestamp, value: c.volume, color: c.close >= c.open ? "#38c98b55" : "#ee5d6655" });
          }
        }
      } catch (e) {
        if (cancelled) return;
        if (initial) {
          setStatus("error");
          setErrorMsg((e as Error).message);
        }
      }
    };
    void load(true);
    const id = setInterval(() => load(false), REFRESH_MS[tf]);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [ready, token.pairAddress, tf]);

  // Repaint when switching price ↔ market cap.
  useEffect(() => {
    if (ready && dataRef.current.length) paint(dataRef.current);
  }, [factor, ready]);

  // Older history when panning left.
  useEffect(() => {
    if (!ready || !chartRef.current) return;
    const ts = chartRef.current.timeScale();
    const handler = async (range: { from: number; to: number } | null) => {
      if (!range || range.from > 10 || loadingMore.current || !dataRef.current.length) return;
      loadingMore.current = true;
      try {
        const first = dataRef.current[0].time;
        const { candles } = await fetcher<{ candles: Candle[] }>(`/api/market/candles?pair=${token.pairAddress}&tf=${tf}&before=${first}`);
        const older = candles.filter((c) => c.time < first);
        if (older.length) {
          dataRef.current = [...older, ...dataRef.current];
          paint(dataRef.current);
        }
      } catch {
        /* keep current view */
      } finally {
        setTimeout(() => (loadingMore.current = false), 1500);
      }
    };
    ts.subscribeVisibleLogicalRangeChange(handler);
    return () => ts.unsubscribeVisibleLogicalRangeChange(handler);
  }, [ready, token.pairAddress, tf]);

  // Thesis target / entry price lines and trade markers.
  useEffect(() => {
    const candle = candleRef.current;
    if (!ready || !candle) return;
    for (const l of linesRef.current) candle.removePriceLine(l);
    linesRef.current = [];
    // Lines are expressed in the chart's unit. Market cap → price uses the same supply factor.
    const toUnit = (mc: number) => (factor === 1 ? (token.priceUsd && token.marketCap ? (mc / token.marketCap) * token.priceUsd : null) : mc);
    if (thesis) {
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
    }
    const step = TF_SECONDS[tf];
    const first = dataRef.current[0]?.time ?? 0;
    const markers: SeriesMarker<Time>[] = trades
      .map((t) => ({ t, time: Math.floor(new Date(t.confirmedAt ?? t.createdAt).getTime() / 1000 / step) * step }))
      .filter(({ time }) => time >= first)
      .sort((a, b) => a.time - b.time)
      .map(({ t, time }) => ({
        time: time as UTCTimestamp,
        position: t.side === "buy" ? ("belowBar" as const) : ("aboveBar" as const),
        color: t.side === "buy" ? C.buy : C.sell,
        shape: t.side === "buy" ? ("arrowUp" as const) : ("arrowDown" as const),
        text: `${t.side === "buy" ? "B" : "S"}${t.simulated ? " (paper)" : ""}`,
      }));
    candle.setMarkers(markers);
  }, [ready, thesis, trades, factor, tf, token.priceUsd, token.marketCap, status]);

  return (
    <div className="relative flex h-full min-h-[320px] flex-col lg:min-h-0">
      <div className="flex items-center gap-2 px-3 py-1.5">
        <Segmented
          size="xs"
          value={tf}
          onChange={setTf}
          options={(Object.keys(TF_SECONDS) as Tf[]).map((t) => ({ value: t, label: t }))}
        />
        <Segmented
          size="xs"
          value={effectiveUnit}
          onChange={setUnit}
          options={[
            { value: "mcap", label: "Market cap" },
            { value: "price", label: "Price" },
          ]}
        />
        {thesis && (
          <span className="ml-auto flex items-center gap-1.5 text-2xs text-muted">
            <span className="inline-block h-px w-4 border-t border-dashed border-signal" /> Thesis target
          </span>
        )}
      </div>
      <div ref={el} className="min-h-0 flex-1" />
      {status !== "ready" && (
        <div className="pointer-events-none absolute inset-0 top-9 flex items-center justify-center text-xs text-muted">
          {status === "loading" && "Loading candles…"}
          {status === "empty" && "No candle history for this pool yet."}
          {status === "error" && <span className="text-sell">Chart data unavailable: {errorMsg}</span>}
        </div>
      )}
    </div>
  );
}
