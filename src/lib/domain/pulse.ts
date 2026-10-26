import { fromGeckoPool, type TokenSnapshot } from "./market";
import { finiteOrNull } from "./sanitize";

/** Launchpads whose new pools are bonding curves (pre-migration). */
export const LAUNCHPAD_DEXES = ["pump-fun", "raydium-launchlab", "letsbonk-fun", "meteora-dbc", "boop-fun", "moonit", "bags-fm", "heaven", "moonshot", "stonkfun", "daos-fun", "printr-v2", "memefun", "wavebreak", "token-mill", "clanker-solana"] as const;
/** Where launchpad tokens land after graduating. */
export const MIGRATION_DEXES = ["pumpswap", "meteora-damm-v2", "raydium", "meteora"] as const;

const LAUNCHPAD_LABEL: Record<string, string> = {
  "pump-fun": "Pump",
  "raydium-launchlab": "Bonk",
  "meteora-dbc": "Meteora",
  "boop-fun": "Boop",
  moonit: "Moonit",
  "bags-fm": "Bags",
  heaven: "Heaven",
  moonshot: "Moonshot",
  stonkfun: "Stonk",
  "daos-fun": "Daos",
  "printr-v2": "Printr",
  "letsbonk-fun": "Bonk",
  memefun: "Meme",
  pumpswap: "PumpSwap",
  "meteora-damm-v2": "Meteora",
  raydium: "Raydium",
  meteora: "Meteora",
};

export type QuoteToken = "SOL" | "USDC" | "USD1" | "OTHER";
const QUOTE_BY_MINT: Record<string, QuoteToken> = {
  So11111111111111111111111111111111111111112: "SOL",
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: "USDC",
  USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB: "USD1",
};

export interface Socials {
  twitter: string | null;
  website: string | null;
  telegram: string | null;
  /** Token has a paid DexScreener profile. */
  dexPaid: boolean;
}

export interface PulseItem extends TokenSnapshot {
  dex: string;
  dexLabel: string;
  buyers1h: number | null;
  sellers1h: number | null;
  buys24h: number | null;
  sells24h: number | null;
  /** 0–100 for pump.fun curves read on-chain; null when unknown or not a pump.fun curve. */
  bondingProgress: number | null;
  quote: QuoteToken;
  /** From DexScreener token profiles; null until looked up / when the token isn't listed there. */
  socials: Socials | null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function pulseItemFromGecko(pool: any, included: any[], observedAt: number): PulseItem | null {
  const snap = fromGeckoPool(pool, included, observedAt);
  if (!snap) return null;
  const dex = String(pool?.relationships?.dex?.data?.id ?? "");
  if (!/^[a-z0-9-]{2,40}$/.test(dex)) return null;
  const tx = pool?.attributes?.transactions ?? {};
  const quoteMint = String(pool?.relationships?.quote_token?.data?.id ?? "").replace(/^solana_/, "");
  return {
    ...snap,
    dex,
    dexLabel: LAUNCHPAD_LABEL[dex] ?? dex,
    buyers1h: finiteOrNull(tx.h1?.buyers),
    sellers1h: finiteOrNull(tx.h1?.sellers),
    buys24h: finiteOrNull(tx.h24?.buys),
    sells24h: finiteOrNull(tx.h24?.sells),
    bondingProgress: null,
    quote: QUOTE_BY_MINT[quoteMint] ?? "OTHER",
    socials: null,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export interface PulseColumns {
  newPairs: PulseItem[];
  finalStretch: PulseItem[];
  migrated: PulseItem[];
}

export const FINAL_STRETCH_MIN_PROGRESS = 45;

/**
 * Sort candidates into the three columns.
 * - New Pairs: newest launchpad pools still bonding (below the final-stretch line).
 * - Final Stretch: pump.fun curves at or above the threshold, not complete; most bonded first.
 * - Migrated: graduation pools (PumpSwap, Meteora DAMM v2) created in the last 24h, newest first.
 */
export function classifyPulse(
  launches: PulseItem[],
  stretchCandidates: PulseItem[],
  migrations: PulseItem[],
  now: number,
  limit = 60,
): PulseColumns {
  const dedupe = (list: PulseItem[]) => {
    const seen = new Set<string>();
    return list.filter((t) => (seen.has(t.mint) ? false : (seen.add(t.mint), true)));
  };
  const byNewest = (a: PulseItem, b: PulseItem) => (b.pairCreatedAt ?? 0) - (a.pairCreatedAt ?? 0);

  const finalStretch = dedupe([...stretchCandidates, ...launches])
    .filter((t) => t.dex === "pump-fun" && t.bondingProgress != null && t.bondingProgress >= FINAL_STRETCH_MIN_PROGRESS && t.bondingProgress < 100)
    .sort((a, b) => (b.bondingProgress ?? 0) - (a.bondingProgress ?? 0))
    .slice(0, limit);
  const inStretch = new Set(finalStretch.map((t) => t.mint));

  const newPairs = dedupe(launches)
    .filter((t) => (LAUNCHPAD_DEXES as readonly string[]).includes(t.dex) && !inStretch.has(t.mint) && t.bondingProgress !== 100)
    .sort(byNewest)
    .slice(0, limit);

  const migrated = dedupe(migrations)
    .filter(
      (t) =>
        (MIGRATION_DEXES as readonly string[]).includes(t.dex) &&
        // Plain Raydium/Meteora pools count only for launchpad tokens (vanity mint suffixes).
        (t.dex === "pumpswap" || t.dex === "meteora-damm-v2" || /(pump|bonk|boop|bags|moon)$/i.test(t.mint)) &&
        t.pairCreatedAt != null &&
        now - t.pairCreatedAt < 24 * 3600_000,
    )
    .sort(byNewest)
    .slice(0, limit);

  return { newPairs, finalStretch, migrated };
}
