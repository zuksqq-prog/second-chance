/**
 * Rewards: SOL cashback on platform fees, plus points quests.
 * Cashback is a share of the platform (referral) fee actually charged on
 * confirmed real trades. With no platform fee there is no cashback.
 */

export const VOLUME_TIERS: { sol: number; points: number }[] = [
  { sol: 1, points: 1_000 },
  { sol: 10, points: 5_000 },
  { sol: 50, points: 10_000 },
  { sol: 100, points: 20_000 },
  { sol: 250, points: 40_000 },
  { sol: 500, points: 80_000 },
  { sol: 1_000, points: 150_000 },
];

export const TX_TIERS: { count: number; points: number }[] = [
  { count: 10, points: 500 },
  { count: 50, points: 2_000 },
  { count: 100, points: 5_000 },
  { count: 500, points: 10_000 },
  { count: 1_000, points: 20_000 },
  { count: 5_000, points: 50_000 },
];

export interface Quest {
  kind: "volume" | "tx";
  /** Progress within the current tier, 0..1. */
  progress: number;
  /** How much more is needed for the next tier (SOL or transactions); 0 when all done. */
  remaining: number;
  nextPoints: number;
  completedTiers: number;
  totalTiers: number;
  label: string;
}

function questFor(kind: "volume" | "tx", value: number): Quest {
  const tiers = kind === "volume" ? VOLUME_TIERS.map((t) => ({ goal: t.sol, points: t.points })) : TX_TIERS.map((t) => ({ goal: t.count, points: t.points }));
  const idx = tiers.findIndex((t) => value < t.goal);
  if (idx === -1) {
    return { kind, progress: 1, remaining: 0, nextPoints: 0, completedTiers: tiers.length, totalTiers: tiers.length, label: kind === "volume" ? "All volume quests complete" : "All transaction quests complete" };
  }
  const prev = idx === 0 ? 0 : tiers[idx - 1].goal;
  const next = tiers[idx];
  const remaining = next.goal - value;
  const shown = kind === "volume" ? (remaining >= 10 ? Math.ceil(remaining) : Math.ceil(remaining * 100) / 100) : Math.ceil(remaining);
  return {
    kind,
    progress: Math.max(0, Math.min(1, (value - prev) / (next.goal - prev))),
    remaining,
    nextPoints: next.points,
    completedTiers: idx,
    totalTiers: tiers.length,
    label: kind === "volume" ? `Trade ${shown.toLocaleString()} more SOL in Volume` : `Make ${shown.toLocaleString()} more transactions`,
  };
}

export function quests(volumeSol: number, txCount: number): { volume: Quest; tx: Quest; points: number } {
  const points =
    VOLUME_TIERS.filter((t) => volumeSol >= t.sol).reduce((s, t) => s + t.points, 0) +
    TX_TIERS.filter((t) => txCount >= t.count).reduce((s, t) => s + t.points, 0);
  return { volume: questFor("volume", volumeSol), tx: questFor("tx", txCount), points };
}

/** Cashback owed from platform fees, in lamports (rounded down). */
export function cashbackLamports(platformFeeLamports: bigint, cashbackPct: number): bigint {
  if (platformFeeLamports <= 0n || !(cashbackPct > 0)) return 0n;
  const pct = BigInt(Math.round(Math.min(100, cashbackPct) * 100));
  return (platformFeeLamports * pct) / 10_000n;
}

export const MIN_CLAIM_LAMPORTS = 1_000_000n; // 0.001 SOL

export function claimable(earnedLamports: bigint, claimedOrPendingLamports: bigint): bigint {
  const v = earnedLamports - claimedOrPendingLamports;
  return v > 0n ? v : 0n;
}

/** Platform fee for a trade, in lamports: bps of the SOL leg (input for buys, output for sells). */
export function platformFeeFor(solLegLamports: bigint, feeBps: number): bigint {
  if (!(feeBps > 0) || solLegLamports <= 0n) return 0n;
  return (solLegLamports * BigInt(Math.round(feeBps))) / 10_000n;
}

/** Cumulative daily series for the last `days` days, oldest first. */
export function dailyCumulative(rows: { day: string; lamports: bigint }[], days: number, today: Date): { day: string; sol: number }[] {
  const byDay = new Map(rows.map((r) => [r.day, r.lamports]));
  const out: { day: string; sol: number }[] = [];
  // Everything before the window counts toward the starting total.
  const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - (days - 1)));
  let running = 0n;
  for (const r of rows) if (r.day < start.toISOString().slice(0, 10)) running += r.lamports;
  for (let i = 0; i < days; i++) {
    const d = new Date(start.getTime() + i * 86400_000).toISOString().slice(0, 10);
    running += byDay.get(d) ?? 0n;
    out.push({ day: d, sol: Number(running) / 1e9 });
  }
  return out;
}
