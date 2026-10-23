"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { TokenSnapshot, TradeMode } from "./types";

export type View = "discover" | "trade" | "portfolio" | "theses" | "watchlist" | "settings";

interface Toast {
  id: number;
  tone: "ok" | "error" | "info";
  title: string;
  body?: string;
  href?: string;
}

interface AppState {
  view: View;
  setView: (v: View) => void;
  mode: TradeMode;
  setMode: (m: TradeMode) => void;
  selected: TokenSnapshot | null;
  selectedMint: string | null;
  selectToken: (t: TokenSnapshot | string) => void;
  toasts: Toast[];
  toast: (t: Omit<Toast, "id">) => void;
  dismiss: (id: number) => void;
}

const Ctx = createContext<AppState | null>(null);
let toastId = 0;

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useState<View>("discover");
  // Always start in paper mode; a remembered "real" choice is restored after mount (no hydration mismatch).
  const [mode, setModeState] = useState<TradeMode>("paper");
  useEffect(() => {
    try {
      if (localStorage.getItem("sc.mode") === "real") setModeState("real");
    } catch {
      /* storage unavailable */
    }
  }, []);
  const [selected, setSelected] = useState<TokenSnapshot | null>(null);
  const [selectedMint, setSelectedMint] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const setMode = useCallback((m: TradeMode) => {
    setModeState(m);
    try {
      localStorage.setItem("sc.mode", m);
    } catch {
      /* storage unavailable */
    }
  }, []);

  const selectToken = useCallback((t: TokenSnapshot | string) => {
    if (typeof t === "string") {
      setSelectedMint(t);
      setSelected((cur) => (cur?.mint === t ? cur : null));
    } else {
      setSelectedMint(t.mint);
      setSelected(t);
    }
    setView("trade");
  }, []);

  const dismiss = useCallback((id: number) => setToasts((ts) => ts.filter((t) => t.id !== id)), []);
  const toast = useCallback(
    (t: Omit<Toast, "id">) => {
      const id = ++toastId;
      setToasts((ts) => [...ts.slice(-3), { ...t, id }]);
      setTimeout(() => dismiss(id), t.tone === "error" ? 9000 : 5000);
    },
    [dismiss],
  );

  const value = useMemo(
    () => ({ view, setView, mode, setMode, selected, selectedMint, selectToken, toasts, toast, dismiss }),
    [view, mode, setMode, selected, selectedMint, selectToken, toasts, toast, dismiss],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp must be used inside AppStateProvider");
  return v;
}
