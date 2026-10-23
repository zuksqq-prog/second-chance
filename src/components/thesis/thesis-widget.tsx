"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { EyeOff, Maximize2, Minimize2, NotebookPen, Pin, PinOff } from "lucide-react";
import { useApp } from "@/lib/client/store";
import { useSession } from "@/lib/client/session";
import { useActiveThesis, useSettings, useToken } from "@/lib/client/hooks";
import { post } from "@/lib/client/api";
import { compactUsd } from "@/lib/domain/format";
import { progressTowardTarget } from "@/lib/domain/thesis-engine";
import { cn } from "@/lib/utils";

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  minimized: boolean;
  hidden: boolean;
  pinned: boolean;
}

const KEY = "sc.thesisWidget";
const MIN_W = 260;
const MIN_H = 160;
const DEFAULT: Box = { x: -1, y: -1, w: 340, h: 400, minimized: false, hidden: false, pinned: false };

function clamp(b: Box): Box {
  if (typeof window === "undefined") return b;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = Math.min(Math.max(b.w, MIN_W), vw - 16);
  const h = Math.min(Math.max(b.h, MIN_H), vh - 16);
  const x = b.x < 0 ? vw - w - 372 : Math.min(Math.max(8, b.x), vw - (b.minimized ? 56 : w) - 8);
  const y = b.y < 0 ? 140 : Math.min(Math.max(8, b.y), vh - (b.minimized ? 56 : h) - 8);
  return { ...b, w, h, x: Math.max(8, x), y };
}

/**
 * Floating SECOND CHANCE widget. Follows the selected token. Drag by the
 * header, resize from any edge or corner, minimise to an icon, pin in place,
 * hide. Layout is stored locally right away and synced to the account.
 */
export function ThesisWidget() {
  const { selectedMint, selected, view } = useApp();
  const { status } = useSession();
  const { settings } = useSettings();
  const { data: thesisData, isLoading } = useActiveThesis(selectedMint);
  const { data: tokenData } = useToken(selectedMint, selected);
  const [box, setBox] = useState<Box>(DEFAULT);
  const [loaded, setLoaded] = useState(false);
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Restore: local first (instant), then account settings if local is empty.
  useEffect(() => {
    let local: Box | null = null;
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) local = { ...DEFAULT, ...JSON.parse(raw) };
    } catch {
      /* ignore */
    }
    setBox(clamp(local ?? DEFAULT));
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (!loaded || !settings.widget) return;
    try {
      if (localStorage.getItem(KEY)) return;
    } catch {
      /* ignore */
    }
    setBox(clamp({ ...DEFAULT, ...settings.widget }));
  }, [loaded, settings.widget]);

  useEffect(() => {
    const onResize = () => setBox((b) => clamp(b));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const persist = useCallback(
    (b: Box) => {
      try {
        localStorage.setItem(KEY, JSON.stringify(b));
      } catch {
        /* ignore */
      }
      if (status !== "signed_in") return;
      if (syncTimer.current) clearTimeout(syncTimer.current);
      syncTimer.current = setTimeout(() => {
        void post("/api/settings", { widget: { ...b, w: Math.round(b.w), h: Math.round(b.h), x: Math.round(b.x), y: Math.round(b.y) } }, "PUT").catch(() => null);
      }, 800);
    },
    [status],
  );

  const update = useCallback(
    (patch: Partial<Box>) =>
      setBox((b) => {
        const next = clamp({ ...b, ...patch });
        persist(next);
        return next;
      }),
    [persist],
  );

  // Drag and resize with pointer capture so the page underneath never receives the gesture.
  const gesture = useRef<{ kind: string; sx: number; sy: number; start: Box } | null>(null);
  const dragged = useRef(false);
  const begin = (kind: string) => (e: React.PointerEvent) => {
    if (box.pinned && kind === "move") return;
    // Header buttons (pin, minimise, hide) shouldn't start a drag; the minimised icon itself should.
    const btn = (e.target as HTMLElement).closest("button");
    if (btn && btn !== e.currentTarget && kind === "move") return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    gesture.current = { kind, sx: e.clientX, sy: e.clientY, start: box };
    dragged.current = false;
  };
  const move = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (!g) return;
    const dx = e.clientX - g.sx;
    const dy = e.clientY - g.sy;
    if (Math.abs(dx) + Math.abs(dy) > 3) dragged.current = true;
    const s = g.start;
    let { x, y, w, h } = s;
    if (g.kind === "move") {
      x = s.x + dx;
      y = s.y + dy;
    } else {
      if (g.kind.includes("e")) w = s.w + dx;
      if (g.kind.includes("s")) h = s.h + dy;
      if (g.kind.includes("w")) {
        w = Math.max(MIN_W, s.w - dx);
        x = s.x + (s.w - w);
      }
      if (g.kind.includes("n")) {
        h = Math.max(MIN_H, s.h - dy);
        y = s.y + (s.h - h);
      }
    }
    setBox(clamp({ ...s, x, y, w, h }));
  };
  const end = (e: React.PointerEvent) => {
    if (!gesture.current) return;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    gesture.current = null;
    setBox((b) => {
      persist(b);
      return b;
    });
  };

  if (!loaded || status !== "signed_in" || !selectedMint || view === "theses") return null;

  if (box.hidden) {
    return (
      <button
        type="button"
        onClick={() => update({ hidden: false })}
        className="fixed bottom-[max(72px,calc(env(safe-area-inset-bottom)+72px))] left-0 z-40 flex items-center gap-1 rounded-r border border-l-0 border-signal/40 bg-ink-2 px-2 py-1.5 text-2xs text-signal shadow-lg md:bottom-4 md:left-16"
        aria-label="Show thesis widget"
      >
        <NotebookPen size={12} /> Thesis
      </button>
    );
  }

  const thesis = thesisData?.thesis ?? null;
  const token = tokenData?.token ?? null;
  const mc = token?.marketCap ?? null;
  const progress = thesis ? progressTowardTarget(thesis.entryMarketCap, mc, thesis.targetMarketCap) : null;
  const symbol = token?.symbol ?? thesis?.tokenSymbol ?? "token";

  if (box.minimized) {
    return (
      <div className="fixed z-40" style={{ left: box.x, top: box.y }}>
        <button
          type="button"
          onPointerDown={begin("move")}
          onPointerMove={move}
          onPointerUp={end}
          onClick={() => {
            if (!dragged.current) update({ minimized: false });
            dragged.current = false;
          }}
          className="relative flex h-12 w-12 items-center justify-center rounded-full border border-signal/50 bg-ink-2 shadow-xl shadow-black/50"
          aria-label={`Expand thesis for ${symbol}`}
          title={thesis ? `${symbol}: ${Math.round((progress ?? 0) * 100)}% to target` : `No thesis for ${symbol}`}
        >
          <ProgressRing value={progress} />
          <NotebookPen size={15} className="text-signal" />
        </button>
      </div>
    );
  }

  return (
    <div
      className="fixed z-40 flex flex-col overflow-hidden rounded-lg border border-line-strong bg-ink-1/95 shadow-2xl shadow-black/60 backdrop-blur"
      style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
      role="complementary"
      aria-label={`Thesis for ${symbol}`}
    >
      <div
        onPointerDown={begin("move")}
        onPointerMove={move}
        onPointerUp={end}
        className={cn("flex h-9 shrink-0 select-none items-center gap-2 border-b border-line px-3", box.pinned ? "cursor-default" : "cursor-grab active:cursor-grabbing")}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-signal" />
        <span className="flex-1 truncate text-xs font-medium">Thesis · {symbol}</span>
        <IconBtn label={box.pinned ? "Unpin" : "Pin in place"} onClick={() => update({ pinned: !box.pinned })}>
          {box.pinned ? <PinOff size={12} /> : <Pin size={12} />}
        </IconBtn>
        <IconBtn label="Minimise" onClick={() => update({ minimized: true })}>
          <Minimize2 size={12} />
        </IconBtn>
        <IconBtn label="Hide" onClick={() => update({ hidden: true })}>
          <EyeOff size={12} />
        </IconBtn>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {isLoading && !thesisData && <p className="text-xs text-muted">Loading…</p>}
        {thesisData && !thesis && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <p className="text-xs text-fg-soft">No thesis for {symbol} yet.</p>
            <p className="text-2xs text-muted">Write one in the buy panel, or from Theses if you already hold it.</p>
          </div>
        )}
        {thesis && (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-3 gap-2 text-xs">
              <Fig k="Entry" v={compactUsd(thesis.entryMarketCap)} />
              <Fig k="Now" v={compactUsd(mc)} strong />
              <Fig k="Target" v={compactUsd(thesis.targetMarketCap)} accent />
            </div>
            <div>
              <div className="h-1.5 rounded-full bg-ink-3">
                <div className="h-full rounded-full bg-signal transition-[width] duration-500" style={{ width: `${Math.round((progress ?? 0) * 100)}%` }} />
              </div>
              <p className="mt-1 text-2xs text-muted num">
                {progress == null ? "Market cap unavailable" : progress >= 1 ? "Target reached" : `${Math.round(progress * 100)}% of the way from entry to target`}
                {mc && progress != null && progress < 1 ? ` · ${(thesis.targetMarketCap / mc).toFixed(1)}× to go` : ""}
              </p>
            </div>
            <blockquote className="border-l-2 border-signal pl-3 font-voice text-[15px] italic leading-relaxed text-fg">“{thesis.original.reason}”</blockquote>
            {thesis.original.invalidation && (
              <div>
                <p className="text-2xs text-muted">Wrong if</p>
                <p className="text-xs text-fg-soft">{thesis.original.invalidation}</p>
              </div>
            )}
            {thesis.plannedExits.length > 0 && (
              <div>
                <p className="text-2xs text-muted">Planned exits</p>
                <ul className="mt-1 flex flex-col gap-0.5">
                  {thesis.plannedExits.map((e) => (
                    <li key={e.id} className={cn("flex justify-between text-xs num", mc && mc >= e.atMarketCap ? "text-signal" : "text-fg-soft")}>
                      <span>{e.sellPercent}%</span>
                      <span>at {compactUsd(e.atMarketCap)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {thesis.revisionCount > 0 && (
              <p className="text-2xs text-muted">
                Revised {thesis.revisionCount}×. Original target {compactUsd(thesis.original.targetMarketCap)}.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Resize handles */}
      {(["n", "s", "e", "w", "ne", "nw", "se", "sw"] as const).map((d) => (
        <span
          key={d}
          onPointerDown={begin(d)}
          onPointerMove={move}
          onPointerUp={end}
          aria-hidden
          className={cn(
            "absolute z-10",
            d === "n" && "inset-x-2 top-0 h-1.5 cursor-ns-resize",
            d === "s" && "inset-x-2 bottom-0 h-1.5 cursor-ns-resize",
            d === "e" && "inset-y-2 right-0 w-1.5 cursor-ew-resize",
            d === "w" && "inset-y-2 left-0 w-1.5 cursor-ew-resize",
            d === "ne" && "right-0 top-0 h-3 w-3 cursor-nesw-resize",
            d === "sw" && "bottom-0 left-0 h-3 w-3 cursor-nesw-resize",
            d === "nw" && "left-0 top-0 h-3 w-3 cursor-nwse-resize",
            d === "se" && "bottom-0 right-0 h-3 w-3 cursor-nwse-resize",
          )}
        />
      ))}
      <Maximize2 size={9} className="pointer-events-none absolute bottom-1 right-1 rotate-90 text-muted/50" aria-hidden />
    </div>
  );
}

function IconBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className="rounded p-1 text-muted hover:bg-ink-3 hover:text-fg">
      {children}
    </button>
  );
}

function Fig({ k, v, strong, accent }: { k: string; v: string; strong?: boolean; accent?: boolean }) {
  return (
    <div>
      <p className="text-2xs text-muted">{k}</p>
      <p className={cn("num", strong && "font-semibold", accent && "text-signal")}>{v}</p>
    </div>
  );
}

function ProgressRing({ value }: { value: number | null }) {
  const r = 21;
  const c = 2 * Math.PI * r;
  return (
    <svg className="absolute inset-0" viewBox="0 0 48 48" aria-hidden>
      <circle cx="24" cy="24" r={r} fill="none" stroke="#1d232d" strokeWidth="2.5" />
      {value != null && <circle cx="24" cy="24" r={r} fill="none" stroke="#e9a23b" strokeWidth="2.5" strokeDasharray={`${c * value} ${c}`} strokeLinecap="round" transform="rotate(-90 24 24)" />}
    </svg>
  );
}
