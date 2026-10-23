import "server-only";
import { rpcUrl } from "./env";
import { sharedCache } from "./cache";
import { WSOL_MINT } from "@/lib/domain/market";

/** Minimal JSON-RPC client for the calls this app needs. Works with Helius or any Solana RPC. */

const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

let rpcId = 0;
export async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(rpcUrl(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Solana RPC responded ${res.status}`);
  const body = (await res.json()) as { result?: T; error?: { message: string } };
  if (body.error) throw new Error(`Solana RPC error: ${body.error.message}`);
  return body.result as T;
}

export async function getSolBalanceLamports(owner: string): Promise<bigint> {
  const r = await rpc<{ value: number }>("getBalance", [owner, { commitment: "confirmed" }]);
  return BigInt(r.value);
}

export interface TokenHolding {
  mint: string;
  amountRaw: bigint;
  decimals: number;
}

interface ParsedTokenAccount {
  account: { data: { parsed: { info: { mint: string; tokenAmount: { amount: string; decimals: number } } } } };
}

/** All SPL + Token-2022 balances for a wallet, merged per mint, zero balances dropped. */
export async function getTokenHoldings(owner: string): Promise<TokenHolding[]> {
  const fetchProgram = (programId: string) =>
    rpc<{ value: ParsedTokenAccount[] }>("getTokenAccountsByOwner", [
      owner,
      { programId },
      { encoding: "jsonParsed", commitment: "confirmed" },
    ]);
  const [a, b] = await Promise.all([fetchProgram(TOKEN_PROGRAM), fetchProgram(TOKEN_2022_PROGRAM)]);
  const merged = new Map<string, TokenHolding>();
  for (const acc of [...a.value, ...b.value]) {
    const info = acc.account.data.parsed.info;
    if (info.mint === WSOL_MINT) continue;
    const amt = BigInt(info.tokenAmount.amount);
    if (amt === 0n) continue;
    const prev = merged.get(info.mint);
    merged.set(info.mint, { mint: info.mint, amountRaw: (prev?.amountRaw ?? 0n) + amt, decimals: info.tokenAmount.decimals });
  }
  return [...merged.values()];
}

/** Token decimals, cached for the life of the instance (immutable on-chain). */
export async function getDecimals(mint: string): Promise<number> {
  if (mint === WSOL_MINT) return 9;
  return sharedCache.get(`decimals:${mint}`, 24 * 3600_000, async () => {
    const r = await rpc<{ value: { decimals: number } }>("getTokenSupply", [mint]);
    if (typeof r?.value?.decimals !== "number") throw new Error("Could not read token decimals.");
    return r.value.decimals;
  });
}

export type ConfirmationStatus = "processed" | "confirmed" | "finalized";

export async function getSignatureStatus(
  sig: string,
): Promise<{ status: ConfirmationStatus | null; err: unknown | null } | null> {
  const r = await rpc<{ value: ({ confirmationStatus: ConfirmationStatus | null; err: unknown } | null)[] }>(
    "getSignatureStatuses",
    [[sig], { searchTransactionHistory: true }],
  );
  const v = r.value[0];
  return v ? { status: v.confirmationStatus, err: v.err } : null;
}

export interface TxEffects {
  feeLamports: bigint;
  solDeltaLamports: bigint; // owner's SOL change, excluding fee
  tokenDeltaRaw: bigint; // owner's change in `mint`
  err: unknown | null;
}

interface TokenBal {
  mint: string;
  owner?: string;
  uiTokenAmount: { amount: string };
}

/**
 * Read a confirmed transaction and compute what actually happened to the
 * wallet: real fee, SOL change and token change. Used to reconcile trades
 * with the chain instead of trusting quoted amounts.
 */
export async function getTxEffects(sig: string, owner: string, mint: string): Promise<TxEffects | null> {
  const tx = await rpc<{
    meta: { fee: number; err: unknown; preBalances: number[]; postBalances: number[]; preTokenBalances: TokenBal[]; postTokenBalances: TokenBal[] };
    transaction: { message: { accountKeys: { pubkey: string }[] } };
  } | null>("getTransaction", [sig, { encoding: "jsonParsed", commitment: "confirmed", maxSupportedTransactionVersion: 0 }]);
  if (!tx) return null;
  const keys = tx.transaction.message.accountKeys.map((k) => k.pubkey);
  const idx = keys.indexOf(owner);
  const fee = BigInt(tx.meta.fee);
  const solDelta = idx >= 0 ? BigInt(tx.meta.postBalances[idx]) - BigInt(tx.meta.preBalances[idx]) + (idx === 0 ? fee : 0n) : 0n;
  const sum = (list: TokenBal[]) =>
    list.filter((b) => b.mint === mint && b.owner === owner).reduce((s, b) => s + BigInt(b.uiTokenAmount.amount), 0n);
  return {
    feeLamports: fee,
    solDeltaLamports: solDelta,
    tokenDeltaRaw: sum(tx.meta.postTokenBalances) - sum(tx.meta.preTokenBalances),
    err: tx.meta.err,
  };
}

export interface TokenSecurity {
  mint: string;
  decimals: number;
  supplyRaw: string;
  program: "spl-token" | "token-2022" | "unknown";
  /** null = renounced. A live mint authority can print more supply. */
  mintAuthority: string | null;
  /** null = none. A live freeze authority can freeze holders' tokens. */
  freezeAuthority: string | null;
  /** Share of supply held by the largest accounts (0..100). Includes pool/vault accounts. */
  top10Percent: number | null;
  topHolders: { address: string; percent: number }[];
}

/** On-chain token checks: authorities and holder concentration. Cached 60s. */
export async function getTokenSecurity(mint: string): Promise<TokenSecurity> {
  return sharedCache.get(`security:${mint}`, 60_000, async () => {
    const acct = await rpc<{
      value: { owner: string; data: { parsed?: { info: { decimals: number; supply: string; mintAuthority: string | null; freezeAuthority: string | null } } } } | null;
    }>("getAccountInfo", [mint, { encoding: "jsonParsed", commitment: "confirmed" }]);
    const info = acct.value?.data?.parsed?.info;
    if (!info) throw new Error("Not a token mint.");
    let holders: { address: string; amount: string }[] = [];
    try {
      const largest = await rpc<{ value: { address: string; amount: string }[] }>("getTokenLargestAccounts", [mint, { commitment: "confirmed" }]);
      holders = largest.value;
    } catch {
      /* some RPCs restrict this call; leave distribution unknown */
    }
    const supply = BigInt(info.supply);
    const share = (amt: string) => (supply > 0n ? Number((BigInt(amt) * 1_000_000n) / supply) / 10_000 : 0);
    const top = holders.slice(0, 10).map((h) => ({ address: h.address, percent: share(h.amount) }));
    return {
      mint,
      decimals: info.decimals,
      supplyRaw: info.supply,
      program: acct.value!.owner === TOKEN_PROGRAM ? "spl-token" : acct.value!.owner === TOKEN_2022_PROGRAM ? "token-2022" : "unknown",
      mintAuthority: info.mintAuthority ?? null,
      freezeAuthority: info.freezeAuthority ?? null,
      top10Percent: holders.length ? top.reduce((s, h) => s + h.percent, 0) : null,
      topHolders: top,
    };
  });
}

/** Recent prioritization fees, used to suggest a priority fee. Returns micro-lamports per CU percentiles. */
export async function getPriorityFeeEstimate(): Promise<{ low: number; medium: number; high: number }> {
  return sharedCache.get("prio-fees", 15_000, async () => {
    const r = await rpc<{ prioritizationFee: number }[]>("getRecentPrioritizationFees", [[]]);
    const fees = r.map((x) => x.prioritizationFee).filter((x) => x > 0).sort((a, b) => a - b);
    const at = (q: number) => (fees.length ? fees[Math.min(fees.length - 1, Math.floor(q * fees.length))] : 0);
    return { low: at(0.25), medium: at(0.5), high: at(0.9) };
  });
}
