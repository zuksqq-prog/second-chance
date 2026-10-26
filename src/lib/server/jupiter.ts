import "server-only";
import { env, platformFeeBps } from "./env";
import { upstream } from "./rate-limit";

/**
 * Jupiter Swap API v2 — Order & Execute path (api.jup.ag/swap/v2).
 *   GET  /order   → quote + assembled unsigned transaction (when `taker` is set)
 *   POST /execute → Jupiter lands the signed transaction and reports the result
 * Verified against developers.jup.ag docs (Oct 2026). The API key, when set, is
 * only ever sent from the server.
 *
 * Note: on this path Jupiter manages priority fees and landing. The user's
 * priority-fee setting is therefore advisory for real trades (see STATUS.md).
 */

export interface JupiterOrder {
  transaction: string | null;
  requestId: string;
  inAmount?: string;
  outAmount: string;
  router?: string;
  mode?: string;
  feeBps?: number;
  feeMint?: string;
  slippageBps?: number;
  priceImpactPct?: string | number;
  lastValidBlockHeight?: number | string;
  expireAt?: string | number;
  errorCode?: number;
  errorMessage?: string;
}

export interface JupiterExecuteResult {
  status: "Success" | "Failed";
  signature?: string;
  code: number;
  error?: string;
  totalInputAmount?: string;
  totalOutputAmount?: string;
  inputAmountResult?: string;
  outputAmountResult?: string;
}

function headers(): Record<string, string> {
  const h: Record<string, string> = { accept: "application/json" };
  const key = env().JUPITER_API_KEY;
  if (key) h["x-api-key"] = key;
  return h;
}

export async function getOrder(p: {
  inputMint: string;
  outputMint: string;
  amountRaw: bigint;
  taker: string;
  slippageBps: number;
}): Promise<JupiterOrder> {
  await upstream.jupiter.acquire("global", 6000);
  const qs = new URLSearchParams({
    inputMint: p.inputMint,
    outputMint: p.outputMint,
    amount: p.amountRaw.toString(),
    taker: p.taker,
    slippageBps: String(p.slippageBps),
  });
  const fee = platformFeeBps();
  if (fee > 0) {
    qs.set("referralAccount", env().JUPITER_REFERRAL_ACCOUNT!);
    qs.set("referralFee", String(fee));
  }
  const res = await fetch(`${env().JUPITER_BASE_URL}/order?${qs}`, {
    headers: headers(),
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });
  const body = (await res.json().catch(() => null)) as JupiterOrder | { error?: string } | null;
  if (!res.ok || !body) throw new Error(`Jupiter order failed (${res.status}): ${(body as { error?: string })?.error ?? "no body"}`);
  return body as JupiterOrder;
}

export async function executeOrder(p: { signedTransaction: string; requestId: string }): Promise<JupiterExecuteResult> {
  await upstream.jupiter.acquire("global", 6000);
  const res = await fetch(`${env().JUPITER_BASE_URL}/execute`, {
    method: "POST",
    headers: { ...headers(), "content-type": "application/json" },
    body: JSON.stringify({ signedTransaction: p.signedTransaction, requestId: p.requestId }),
    signal: AbortSignal.timeout(60_000),
    cache: "no-store",
  });
  const body = (await res.json().catch(() => null)) as JupiterExecuteResult | null;
  if (!body) throw new Error(`Jupiter execute returned no body (${res.status}).`);
  return body;
}

const ORDER_ERRORS: Record<number, string> = {
  1: "Not enough balance for this swap.",
  2: "Not enough SOL to pay network fees.",
  3: "Amount is below the minimum for this route.",
};

export function orderErrorMessage(o: JupiterOrder): string {
  return o.errorMessage || (o.errorCode != null ? ORDER_ERRORS[o.errorCode] : null) || "Jupiter could not build this swap.";
}

const EXEC_ERRORS: Record<number, string> = {
  [-1]: "The quote expired before submission. Get a new quote and try again.",
  [-2]: "The signed transaction was rejected as invalid.",
  [-3]: "The transaction message was invalid.",
  [-1000]: "The swap failed to land on-chain. No funds moved unless a signature is shown.",
  [-1001]: "Jupiter reported an unknown error.",
  [-1002]: "The transaction was invalid.",
  [-1003]: "The transaction wasn't fully signed.",
  [-1004]: "Invalid block height. Get a new quote.",
  [-1005]: "The quote expired before landing. Get a new quote.",
  [-2000]: "The market-maker swap failed to land.",
  [-2001]: "The market-maker swap hit an unknown error.",
  [-2002]: "The market-maker payload was invalid.",
  [-2003]: "The market-maker quote expired. Get a new quote.",
  [-2004]: "The market maker rejected the swap.",
};

export function executeErrorMessage(r: JupiterExecuteResult): string {
  return EXEC_ERRORS[r.code] ?? r.error ?? `Swap failed (code ${r.code}).`;
}
