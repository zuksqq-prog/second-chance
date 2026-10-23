"use client";

import { useApp } from "@/lib/client/store";
import { useSession } from "@/lib/client/session";

/** Always-visible statement of what kind of money is on screen. */
export function ModeBanner() {
  const { mode } = useApp();
  const { realTrading, status } = useSession();
  if (mode === "paper") {
    return (
      <div className="flex h-7 shrink-0 items-center gap-2 border-b border-signal/25 bg-signal-soft px-3 text-2xs text-signal">
        <span className="h-1.5 w-1.5 rounded-full bg-signal" />
        Paper trading. Fills are simulated at live prices; no real SOL moves.
      </div>
    );
  }
  if (status === "signed_in" && !realTrading.enabled) {
    return (
      <div className="flex h-7 shrink-0 items-center gap-2 border-b border-line bg-ink-2 px-3 text-2xs text-fg-soft">
        <span className="h-1.5 w-1.5 rounded-full bg-muted" />
        Real mode, view only. {realTrading.reason} Your on-chain holdings are shown; buying and selling are disabled.
      </div>
    );
  }
  return (
    <div className="flex h-7 shrink-0 items-center gap-2 border-b border-sell/30 bg-sell-soft px-3 text-2xs text-sell">
      <span className="h-1.5 w-1.5 rounded-full bg-sell" />
      Real money. Trades execute on Solana mainnet after you approve them in your wallet.
    </div>
  );
}
