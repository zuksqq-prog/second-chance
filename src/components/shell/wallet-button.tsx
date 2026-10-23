"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletReadyState } from "@solana/wallet-adapter-base";
import { LogOut, Wallet } from "lucide-react";
import { useSession } from "@/lib/client/session";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { shortAddr } from "@/lib/domain/format";

export function WalletButton() {
  const { wallets, select, connect, connecting, connected, publicKey, wallet } = useWallet();
  const session = useSession();
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);

  if (!connected || !publicKey) {
    const installed = wallets.filter((w) => w.readyState === WalletReadyState.Installed || w.readyState === WalletReadyState.Loadable);
    return (
      <>
        <Button variant="signal" size="sm" onClick={() => setOpen(true)} disabled={connecting}>
          <Wallet size={14} />
          {connecting ? "Connecting…" : "Connect wallet"}
        </Button>
        <Dialog open={open} onClose={() => setOpen(false)} className="max-w-sm" labelledBy="wallet-title">
          <div className="p-5">
            <h2 id="wallet-title" className="text-sm font-semibold">Connect a wallet</h2>
            <p className="mt-1 text-xs text-muted">We never ask for your seed phrase. Every trade needs your approval in the wallet.</p>
            <div className="mt-4 flex flex-col gap-1.5">
              {installed.length === 0 && (
                <p className="rounded border border-line p-3 text-xs text-fg-soft">
                  No Solana wallet found in this browser. Install{" "}
                  <a className="text-signal underline" href="https://phantom.com/download" target="_blank" rel="noreferrer">Phantom</a> or{" "}
                  <a className="text-signal underline" href="https://solflare.com/download" target="_blank" rel="noreferrer">Solflare</a>, then reload.
                </p>
              )}
              {installed.map((w) => (
                <button
                  key={w.adapter.name}
                  type="button"
                  data-autofocus
                  onClick={async () => {
                    select(w.adapter.name);
                    setOpen(false);
                    // select() schedules the adapter; connect on next tick.
                    setTimeout(() => connect().catch(() => null), 0);
                  }}
                  className="flex items-center gap-3 rounded border border-line px-3 py-2.5 text-left hover:border-line-strong hover:bg-ink-2"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={w.adapter.icon} alt="" width={22} height={22} />
                  <span className="text-[13px] font-medium">{w.adapter.name}</span>
                </button>
              ))}
            </div>
          </div>
        </Dialog>
      </>
    );
  }

  const addr = publicKey.toBase58();
  if (session.status !== "signed_in") {
    return (
      <div className="flex items-center gap-2">
        {session.error && <span className="hidden max-w-[220px] truncate text-2xs text-sell lg:block" title={session.error}>{session.error}</span>}
        <Button variant="signal" size="sm" onClick={session.signIn} disabled={session.status === "signing"}>
          {session.status === "signing" ? "Check your wallet…" : "Sign in"}
        </Button>
      </div>
    );
  }

  return (
    <div className="relative">
      <Button variant="outline" size="sm" onClick={() => setMenu((m) => !m)} aria-expanded={menu}>
        {wallet && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={wallet.adapter.icon} alt="" width={14} height={14} />
        )}
        <span className="num">{shortAddr(addr)}</span>
      </Button>
      {menu && (
        <div className="absolute right-0 top-9 z-50 w-56 rounded-md border border-line bg-ink-2 p-1 shadow-2xl shadow-black/50" onMouseLeave={() => setMenu(false)}>
          <a href={`https://solscan.io/account/${addr}`} target="_blank" rel="noreferrer" className="block rounded px-2.5 py-2 text-xs text-fg-soft hover:bg-ink-3">
            View wallet on Solscan
          </a>
          <button type="button" onClick={() => navigator.clipboard?.writeText(addr).catch(() => null)} className="block w-full rounded px-2.5 py-2 text-left text-xs text-fg-soft hover:bg-ink-3">
            Copy address
          </button>
          <button type="button" onClick={session.signOut} className="flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-xs text-sell hover:bg-ink-3">
            <LogOut size={13} /> Disconnect
          </button>
        </div>
      )}
    </div>
  );
}
