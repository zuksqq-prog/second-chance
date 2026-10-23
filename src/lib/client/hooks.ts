"use client";

import useSWR from "swr";
import { fetcher } from "./api";
import { useApp } from "./store";
import { useSession } from "./session";
import type { PortfolioDTO, SettingsDTO, ThesisDTO, TokenSnapshot, TradeDTO } from "./types";
import { SETTINGS_DEFAULTS } from "@/lib/settings-defaults";

export function useToken(mint: string | null, fallback?: TokenSnapshot | null) {
  return useSWR<{ token: TokenSnapshot }>(mint ? `/api/market/token/${mint}` : null, fetcher, {
    refreshInterval: 10_000,
    fallbackData: fallback ? { token: fallback } : undefined,
    keepPreviousData: false,
  });
}

export function useSettings() {
  const { status } = useSession();
  const r = useSWR<{ settings: SettingsDTO; limits: { maxSlippageBps: number; maxPriorityFeeLamports: number; maxRealTradeSol: number } }>(
    status === "signed_in" ? "/api/settings" : null,
    fetcher,
  );
  return { ...r, settings: r.data?.settings ?? (SETTINGS_DEFAULTS as SettingsDTO), limits: r.data?.limits ?? null };
}

export function usePortfolio() {
  const { mode } = useApp();
  const { status } = useSession();
  return useSWR<PortfolioDTO>(status === "signed_in" ? `/api/portfolio?mode=${mode}` : null, fetcher, { refreshInterval: 20_000 });
}

export function useActiveThesis(mint: string | null) {
  const { mode } = useApp();
  const { status } = useSession();
  return useSWR<{ thesis: ThesisDTO | null }>(status === "signed_in" && mint ? `/api/theses/by-token?mint=${mint}&mode=${mode}` : null, fetcher);
}

export function useTrades() {
  const { mode } = useApp();
  const { status } = useSession();
  return useSWR<{ trades: TradeDTO[] }>(status === "signed_in" ? `/api/trades?mode=${mode}` : null, fetcher, { refreshInterval: 30_000 });
}
