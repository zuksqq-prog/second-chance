"use client";

import { useCallback, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { VersionedTransaction } from "@solana/web3.js";
import { useSWRConfig } from "swr";
import { ApiError, fetcher, post } from "./api";
import { useApp } from "./store";
import type { IntentDTO, ThesisContent, ThesisDTO, TradeDTO } from "./types";
import { uuid } from "@/lib/utils";

export type Phase =
  | "idle"
  | "starting" // creating the intent (server evaluates thesis)
  | "reminder" // SECOND CHANCE: waiting for the user's decision
  | "confirm" // after "Sell anyway": final confirmation
  | "quoting"
  | "signing" // waiting on the wallet
  | "submitting"
  | "confirming" // waiting for on-chain confirmation
  | "done"
  | "failed";

export interface FlowState {
  phase: Phase;
  side: "buy" | "sell" | null;
  symbol: string | null;
  intent: IntentDTO | null;
  thesis: ThesisDTO | null;
  trade: TradeDTO | null;
  error: string | null;
  errorCode: string | null;
}

const initial: FlowState = { phase: "idle", side: null, symbol: null, intent: null, thesis: null, trade: null, error: null, errorCode: null };

export interface ExecOpts {
  slippageBps: number;
  priorityFeeLamports: string;
}

export function useTradeFlow() {
  const { mode, toast } = useApp();
  const { signTransaction } = useWallet();
  const { mutate } = useSWRConfig();
  const [state, setState] = useState<FlowState>(initial);
  const busy = useRef(false);
  const pending = useRef<{ opts: ExecOpts; thesisDraft?: ThesisContent | null; mintMc?: number | null } | null>(null);

  const refresh = useCallback(() => {
    void mutate((k) => typeof k === "string" && (k.startsWith("/api/portfolio") || k.startsWith("/api/trades") || k.startsWith("/api/theses")));
  }, [mutate]);

  const fail = useCallback((e: unknown) => {
    const err = e instanceof ApiError ? e : null;
    const msg = (e as Error)?.message ?? "Something went wrong.";
    const rejected = /reject|declin|cancel/i.test(msg) && !err;
    setState((s) => ({ ...s, phase: "failed", error: rejected ? "You cancelled the signature in your wallet. Nothing was sent." : msg, errorCode: err?.code ?? null }));
    busy.current = false;
  }, []);

  const pollTrade = useCallback(async (id: string): Promise<TradeDTO> => {
    const deadline = Date.now() + 160_000;
    for (;;) {
      const { trade } = await fetcher<{ trade: TradeDTO }>(`/api/trade/${id}`);
      if (trade.status !== "pending" || Date.now() > deadline) return trade;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }, []);

  const finish = useCallback(
    async (trade: TradeDTO, intent: IntentDTO) => {
      setState((s) => ({ ...s, phase: trade.status === "confirmed" ? "done" : trade.status === "failed" ? "failed" : "confirming", trade, error: trade.status === "failed" ? trade.error : null }));
      if (trade.status === "confirmed") {
        const draft = pending.current?.thesisDraft;
        if (intent.side === "buy" && draft) {
          try {
            await post("/api/theses", { mint: intent.mint, mode: intent.mode, content: draft, entryMarketCap: trade.marketCap ?? pending.current?.mintMc ?? null });
            toast({ tone: "ok", title: "Thesis saved", body: "We'll show it to you before any sell below your target." });
          } catch (e) {
            toast({ tone: "error", title: "Thesis not saved", body: (e as Error).message });
          }
        }
        toast({
          tone: "ok",
          title: `${trade.simulated ? "Paper " : ""}${trade.side === "buy" ? "Bought" : "Sold"} ${trade.tokenSymbol ?? ""}`.trim(),
          body: trade.simulated ? "Simulated fill at the live price." : "Confirmed on-chain.",
          href: trade.signature ? `https://solscan.io/tx/${trade.signature}` : undefined,
        });
      }
      busy.current = false;
      refresh();
    },
    [refresh, toast],
  );

  const execute = useCallback(
    async (intent: IntentDTO) => {
      const opts = pending.current!.opts;
      try {
        if (intent.mode === "paper") {
          setState((s) => ({ ...s, phase: "submitting" }));
          const r = await post<{ trade: TradeDTO }>("/api/trade/paper/execute", { intentId: intent.id, ...opts });
          await finish(r.trade, intent);
          return;
        }
        if (!signTransaction) throw new Error("Your wallet doesn't support transaction signing.");
        setState((s) => ({ ...s, phase: "quoting" }));
        const order = await post<{ transaction: string }>("/api/trade/real/order", { intentId: intent.id, slippageBps: opts.slippageBps });
        setState((s) => ({ ...s, phase: "signing" }));
        const tx = VersionedTransaction.deserialize(b64ToBytes(order.transaction));
        const signed = await signTransaction(tx); // explicit approval in the wallet
        setState((s) => ({ ...s, phase: "submitting" }));
        const res = await post<{ trade: TradeDTO; state: string; error?: string }>("/api/trade/real/execute", {
          intentId: intent.id,
          signedTransaction: bytesToB64(signed.serialize()),
        });
        if (res.state === "pending" || res.state === "unknown") {
          setState((s) => ({ ...s, phase: "confirming", trade: res.trade }));
          await finish(await pollTrade(res.trade.id), intent);
        } else {
          await finish(res.trade, intent);
        }
      } catch (e) {
        fail(e);
      }
    },
    [signTransaction, finish, pollTrade, fail],
  );

  const start = useCallback(
    async (p: { side: "buy" | "sell"; mint: string; symbol: string; amountRaw: string; opts: ExecOpts; thesisDraft?: ThesisContent | null; marketCap?: number | null }) => {
      if (busy.current) return; // duplicate-click guard (server also dedupes by idempotency key)
      busy.current = true;
      pending.current = { opts: p.opts, thesisDraft: p.thesisDraft, mintMc: p.marketCap };
      setState({ ...initial, phase: "starting", side: p.side, symbol: p.symbol });
      try {
        const r = await post<{ intent: IntentDTO; thesis: ThesisDTO | null }>("/api/trade/intent", {
          mode,
          side: p.side,
          mint: p.mint,
          amountRaw: p.amountRaw,
          idempotencyKey: uuid(),
        });
        setState((s) => ({ ...s, intent: r.intent, thesis: r.thesis }));
        if (r.intent.status === "pending_ack") {
          setState((s) => ({ ...s, phase: "reminder" }));
          return; // wait for the user's decision; busy stays true
        }
        await execute(r.intent);
      } catch (e) {
        fail(e);
      }
    },
    [mode, execute, fail],
  );

  const acknowledge = useCallback(
    async (action: "keep_holding" | "update_thesis" | "sell_anyway", update?: { patch: Partial<ThesisContent>; reason: string }) => {
      const intent = state.intent;
      if (!intent) return;
      try {
        const r = await post<{ intent: IntentDTO; thesis: ThesisDTO | null }>(`/api/trade/intent/${intent.id}/ack`, { action, update });
        if (action === "keep_holding") {
          toast({ tone: "info", title: "Holding", body: "Sell cancelled. Your plan stands." });
          setState(initial);
          busy.current = false;
          return;
        }
        setState((s) => ({ ...s, intent: r.intent, thesis: r.thesis ?? s.thesis, phase: "confirm" }));
        if (action === "update_thesis") refresh();
      } catch (e) {
        fail(e);
      }
    },
    [state.intent, toast, refresh, fail],
  );

  const confirm = useCallback(async () => {
    if (state.intent) await execute(state.intent);
  }, [state.intent, execute]);

  /** After a quote expiry: the intent is still cleared, so get a new quote and sign again. */
  const retryQuote = useCallback(async () => {
    if (state.intent && state.errorCode === "quote_expired") {
      busy.current = true;
      await execute(state.intent);
    }
  }, [state.intent, state.errorCode, execute]);

  const reset = useCallback(() => {
    busy.current = false;
    setState(initial);
  }, []);

  return { state, start, acknowledge, confirm, retryQuote, reset };
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

export type TradeFlow = ReturnType<typeof useTradeFlow>;
