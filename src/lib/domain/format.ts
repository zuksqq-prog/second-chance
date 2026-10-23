export function compactUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n < 0 ? "-" : "";
  const a = Math.abs(n);
  if (a >= 1e12) return `${sign}$${trim(a / 1e12)}T`;
  if (a >= 1e9) return `${sign}$${trim(a / 1e9)}B`;
  if (a >= 1e6) return `${sign}$${trim(a / 1e6)}M`;
  if (a >= 1e3) return `${sign}$${trim(a / 1e3)}K`;
  return `${sign}$${a.toFixed(a >= 1 ? 2 : 2)}`;
}

function trim(n: number): string {
  return n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1).replace(/\.0$/, "") : n.toFixed(2).replace(/\.?0+$/, "");
}

/** Small prices like 0.00000123 → "0.0₅123" (subscript zero count), the convention on memecoin terminals. */
export function tokenPrice(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n === 0) return "0";
  if (n >= 1) return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
  if (n >= 0.01) return n.toFixed(4);
  const s = n.toFixed(20);
  const m = /^0\.(0+)(\d{1,4})/.exec(s);
  if (!m) return n.toPrecision(3);
  const zeros = m[1].length;
  if (zeros < 4) return n.toFixed(zeros + 4).replace(/0+$/, "");
  const sub = String(zeros).split("").map((d) => "₀₁₂₃₄₅₆₇₈₉"[Number(d)]).join("");
  return `0.0${sub}${m[2].replace(/0+$/, "")}`;
}

export function pct(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n > 0 ? "+" : ""}${n.toFixed(digits)}%`;
}

export function sol(n: number | null | undefined, digits = 4): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(digits).replace(/\.?0+$/, "") || "0"} SOL`;
}

export function age(fromMs: number | null | undefined, nowMs = Date.now()): string {
  if (!fromMs) return "—";
  const s = Math.max(0, Math.floor((nowMs - fromMs) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d`;
  if (s < 86400 * 365) return `${Math.floor(s / (86400 * 30))}mo`;
  return `${Math.floor(s / (86400 * 365))}y`;
}

export function shortAddr(a: string, n = 4): string {
  return a.length <= n * 2 + 1 ? a : `${a.slice(0, n)}…${a.slice(-n)}`;
}

/** Parse "4.2m", "10M", "750k", "1.5b", "$2,000,000" into a number. */
export function parseCompact(input: string): number | null {
  const s = input.trim().replace(/[$,\s]/g, "").toLowerCase();
  const m = /^(\d+(?:\.\d+)?)([kmbt]?)$/.exec(s);
  if (!m) return null;
  const mult = { "": 1, k: 1e3, m: 1e6, b: 1e9, t: 1e12 }[m[2] as "" | "k" | "m" | "b" | "t"];
  const v = Number(m[1]) * mult;
  return Number.isFinite(v) && v > 0 ? v : null;
}
