"use client";

import { cn } from "@/lib/utils";

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
  size = "sm",
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: React.ReactNode; tone?: "buy" | "sell" | "signal" }[];
  className?: string;
  size?: "xs" | "sm";
}) {
  return (
    <div role="tablist" className={cn("inline-flex rounded border border-line bg-ink-0 p-0.5", className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className={cn(
              "rounded-sm px-2.5 font-medium transition-colors",
              size === "xs" ? "h-5 text-2xs" : "h-6 text-xs",
              active
                ? o.tone === "buy"
                  ? "bg-buy-soft text-buy"
                  : o.tone === "sell"
                    ? "bg-sell-soft text-sell"
                    : o.tone === "signal"
                      ? "bg-signal-soft text-signal"
                      : "bg-ink-3 text-fg"
                : "text-muted hover:text-fg",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
