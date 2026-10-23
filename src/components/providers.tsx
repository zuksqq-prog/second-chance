"use client";

import { useMemo, type ReactNode } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { SWRConfig } from "swr";
import { AppStateProvider } from "@/lib/client/store";
import { SessionProvider } from "@/lib/client/session";

/**
 * Phantom, Solflare, Backpack and other modern wallets register themselves via
 * the Wallet Standard, so no per-wallet adapters are bundled. The browser
 * never needs our private RPC: balances, quotes and submission all go through
 * the server. The public endpoint here only satisfies the adapter's context.
 */
export function Providers({ children }: { children: ReactNode }) {
  const endpoint = process.env.NEXT_PUBLIC_SOLANA_PUBLIC_RPC ?? "https://api.mainnet-beta.solana.com";
  const wallets = useMemo(() => [], []);
  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <SWRConfig value={{ shouldRetryOnError: true, errorRetryCount: 3, dedupingInterval: 2000 }}>
          <AppStateProvider>
            <SessionProvider>{children}</SessionProvider>
          </AppStateProvider>
        </SWRConfig>
      </WalletProvider>
    </ConnectionProvider>
  );
}
