"use client";

import { X } from "lucide-react";
import { useApp } from "@/lib/client/store";
import { cn } from "@/lib/utils";

export function Toaster() {
  const { toasts, dismiss } = useApp();
  return (
    <div aria-live="polite" className="pointer-events-none fixed bottom-[max(16px,env(safe-area-inset-bottom))] right-4 z-[70] flex w-[320px] max-w-[calc(100vw-32px)] flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            "pointer-events-auto flex gap-3 rounded-md border bg-ink-2 px-3 py-2.5 shadow-xl shadow-black/40 animate-slide-in",
            t.tone === "error" ? "border-sell/40" : t.tone === "ok" ? "border-buy/40" : "border-line",
          )}
        >
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium">{t.title}</p>
            {t.body && <p className="mt-0.5 text-xs text-fg-soft">{t.body}</p>}
            {t.href && (
              <a href={t.href} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs text-signal underline underline-offset-2">
                View on Solscan
              </a>
            )}
          </div>
          <button type="button" onClick={() => dismiss(t.id)} aria-label="Dismiss" className="self-start text-muted hover:text-fg">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
