"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

/** Token image with a deterministic monogram fallback (image URLs are allowlisted server-side). */
export function TokenAvatar({ src, symbol, size = 24, className }: { src: string | null; symbol: string; size?: number; className?: string }) {
  const [broken, setBroken] = useState(false);
  const hue = [...symbol].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  if (src && !broken) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
        className={cn("shrink-0 rounded-full bg-ink-3 object-cover", className)}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-ink-0", className)}
      style={{ width: size, height: size, fontSize: size * 0.42, background: `hsl(${hue} 45% 62%)` }}
    >
      {symbol.slice(0, 1).toUpperCase()}
    </span>
  );
}
