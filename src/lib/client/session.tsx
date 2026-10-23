"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import useSWR from "swr";
import { fetcher, post } from "./api";
import { base58Encode } from "@/lib/domain/base58";

interface Me {
  wallet: string | null;
  realTrading: { enabled: boolean; reason: string | null };
}

interface SessionState {
  /** Wallet address the server has a verified session for. */
  wallet: string | null;
  realTrading: Me["realTrading"];
  status: "loading" | "signed_out" | "signing" | "signed_in";
  error: string | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<SessionState | null>(null);

/**
 * Wallet connection ≠ authentication. After a wallet connects we ask it to
 * sign a plain-text message (no transaction, no fee); the server verifies the
 * Ed25519 signature and sets an httpOnly session cookie.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const { publicKey, signMessage, connected, disconnect } = useWallet();
  const { data, mutate, isLoading } = useSWR<Me>("/api/auth/me", fetcher, { revalidateOnFocus: true });
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attempted = useRef<string | null>(null);

  const address = publicKey?.toBase58() ?? null;

  const signIn = useCallback(async () => {
    if (!address) return;
    if (!signMessage) {
      setError("This wallet can't sign messages. Try Phantom or Solflare.");
      return;
    }
    setSigning(true);
    setError(null);
    try {
      const { nonce, message } = await post<{ nonce: string; message: string }>("/api/auth/nonce", { address });
      const sig = await signMessage(new TextEncoder().encode(message));
      await post("/api/auth/verify", { address, nonce, signature: base58Encode(sig) });
      await mutate();
    } catch (e) {
      const msg = (e as Error).message ?? "";
      setError(/reject|declin|cancel/i.test(msg) ? "Sign-in was cancelled in your wallet." : msg || "Sign-in failed.");
    } finally {
      setSigning(false);
    }
  }, [address, signMessage, mutate]);

  const signOut = useCallback(async () => {
    await post("/api/auth/logout", {}).catch(() => null);
    attempted.current = null;
    await mutate();
    if (connected) await disconnect().catch(() => null);
  }, [mutate, connected, disconnect]);

  // Prompt once per newly connected wallet. Switching wallets drops the old session.
  useEffect(() => {
    if (!data || !address || signing) return;
    if (data.wallet === address) return;
    if (data.wallet && data.wallet !== address) {
      void post("/api/auth/logout", {}).then(() => mutate());
      return;
    }
    if (attempted.current === address) return;
    attempted.current = address;
    void signIn();
  }, [data, address, signing, signIn, mutate]);

  const value = useMemo<SessionState>(() => {
    const signedIn = !!data?.wallet && data.wallet === address;
    return {
      wallet: signedIn ? data!.wallet : null,
      realTrading: data?.realTrading ?? { enabled: false, reason: null },
      status: isLoading ? "loading" : signing ? "signing" : signedIn ? "signed_in" : "signed_out",
      error,
      signIn,
      signOut,
    };
  }, [data, address, isLoading, signing, error, signIn, signOut]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSession must be used inside SessionProvider");
  return v;
}
