import type { PulseItem } from "./pulse";

/** Protocols shown in the filter panel, keyed by GeckoTerminal dex id. Order follows the panel. */
export const PROTOCOLS: { id: string; label: string; color: string }[] = [
  { id: "pump-fun", label: "Pump", color: "#38c98b" },
  { id: "pumpswap", label: "Pump AMM", color: "#2fb37a" },
  { id: "raydium-launchlab", label: "Bonk", color: "#e98a3b" },
  { id: "letsbonk-fun", label: "LetsBonk", color: "#d97b2f" },
  { id: "bags-fm", label: "Bags", color: "#6fae4a" },
  { id: "stonkfun", label: "Stonkfun", color: "#5aa0c8" },
  { id: "printr-v2", label: "Printr", color: "#b27ad6" },
  { id: "moonshot", label: "Moonshot", color: "#c86fd6" },
  { id: "heaven", label: "Heaven", color: "#d8dde4" },
  { id: "daos-fun", label: "Daos.fun", color: "#5b8def" },
  { id: "boop-fun", label: "Boop", color: "#5bb3ef" },
  { id: "moonit", label: "Moonit", color: "#e2c84a" },
  { id: "meteora-dbc", label: "Dynamic BC", color: "#e2566a" },
  { id: "meteora-damm-v2", label: "Meteora AMM V2", color: "#e26a56" },
  { id: "meteora", label: "Meteora", color: "#e27d56" },
  { id: "raydium", label: "Raydium", color: "#8f7ae6" },
  { id: "raydium-clmm", label: "Raydium CLMM", color: "#7a6ad6" },
  { id: "orca", label: "Orca", color: "#e8b13b" },
  { id: "memefun", label: "Meme.fun", color: "#d65a9b" },
  { id: "wavebreak", label: "Wavebreak", color: "#4ac6c0" },
  { id: "token-mill", label: "Token Mill", color: "#a7b04a" },
  { id: "clanker-solana", label: "Clanker", color: "#8a8fe6" },
];

export const QUOTES = ["SOL", "USDC", "USD1", "OTHER"] as const;
export type Quote = (typeof QUOTES)[number];

export interface Range {
  min: string;
  max: string;
}
export type AgeUnit = "s" | "m" | "h" | "d";

export interface PulseFilter {
  keywords: string[];
  exclude: string[];
  /** Empty = all protocols. */
  protocols: string[];
  /** Empty = all quote tokens. */
  quotes: Quote[];
  age: { min: string; minUnit: AgeUnit; max: string; maxUnit: AgeUnit };
  liquidity: Range;
  volume: Range;
  marketCap: Range;
  bcurve: Range;
  txns: Range;
  buys: Range;
  sells: Range;
  buyers1h: Range;
  socials: { dexPaid: boolean; twitter: boolean; website: boolean; telegram: boolean; atLeastOne: boolean };
}

const R = (): Range => ({ min: "", max: "" });

export function emptyFilter(): PulseFilter {
  return {
    keywords: [],
    exclude: [],
    protocols: [],
    quotes: [],
    age: { min: "", minUnit: "m", max: "", maxUnit: "m" },
    liquidity: R(),
    volume: R(),
    marketCap: R(),
    bcurve: R(),
    txns: R(),
    buys: R(),
    sells: R(),
    buyers1h: R(),
    socials: { dexPaid: false, twitter: false, website: false, telegram: false, atLeastOne: false },
  };
}

/** Accepts plain numbers and shorthand like 6k, 1.5m. Blank → null. */
export function parseNum(s: string): number | null {
  const t = s.trim().toLowerCase().replace(/[$,\s]/g, "");
  if (!t) return null;
  const m = /^(-?\d+(?:\.\d+)?)([kmb]?)$/.exec(t);
  if (!m) return null;
  return Number(m[1]) * ({ "": 1, k: 1e3, m: 1e6, b: 1e9 } as const)[m[2] as "" | "k" | "m" | "b"];
}

const UNIT_MS: Record<AgeUnit, number> = { s: 1e3, m: 60e3, h: 3600e3, d: 86400e3 };

function inRange(v: number | null, r: Range): boolean {
  const lo = parseNum(r.min);
  const hi = parseNum(r.max);
  if (lo == null && hi == null) return true;
  if (v == null || !Number.isFinite(v)) return false;
  if (lo != null && v < lo) return false;
  if (hi != null && v > hi) return false;
  return true;
}

export function matchesFilter(t: PulseItem, f: PulseFilter, now: number): boolean {
  const hay = `${t.symbol} ${t.name}`.toLowerCase();
  if (f.keywords.length && !f.keywords.some((k) => hay.includes(k.toLowerCase()))) return false;
  if (f.exclude.some((k) => hay.includes(k.toLowerCase()))) return false;
  if (f.protocols.length && !f.protocols.includes(t.dex)) return false;
  if (f.quotes.length && !f.quotes.includes(t.quote)) return false;

  const ageMs = t.pairCreatedAt ? now - t.pairCreatedAt : null;
  const aMin = parseNum(f.age.min);
  const aMax = parseNum(f.age.max);
  if (aMin != null || aMax != null) {
    if (ageMs == null) return false;
    if (aMin != null && ageMs < aMin * UNIT_MS[f.age.minUnit]) return false;
    if (aMax != null && ageMs > aMax * UNIT_MS[f.age.maxUnit]) return false;
  }

  if (!inRange(t.liquidityUsd, f.liquidity)) return false;
  if (!inRange(t.volume.h24, f.volume)) return false;
  if (!inRange(t.marketCap, f.marketCap)) return false;
  if (!inRange(t.bondingProgress, f.bcurve)) return false;
  const tx = t.buys24h != null || t.sells24h != null ? (t.buys24h ?? 0) + (t.sells24h ?? 0) : null;
  if (!inRange(tx, f.txns)) return false;
  if (!inRange(t.buys24h, f.buys)) return false;
  if (!inRange(t.sells24h, f.sells)) return false;
  if (!inRange(t.buyers1h, f.buyers1h)) return false;

  const s = t.socials;
  if (f.socials.dexPaid && !s?.dexPaid) return false;
  if (f.socials.twitter && !s?.twitter) return false;
  if (f.socials.website && !s?.website) return false;
  if (f.socials.telegram && !s?.telegram) return false;
  if (f.socials.atLeastOne && !(s?.twitter || s?.website || s?.telegram)) return false;
  return true;
}

const rangeOn = (r: Range) => (r.min.trim() ? 1 : 0) + (r.max.trim() ? 1 : 0) > 0;

/** Active-filter counts per section, for the badges. */
export function countActive(f: PulseFilter) {
  const protocols = (f.protocols.length ? 1 : 0) + (f.quotes.length ? 1 : 0);
  const audit = f.age.min.trim() || f.age.max.trim() ? 1 : 0;
  const metrics = [f.liquidity, f.volume, f.marketCap, f.bcurve, f.txns, f.buys, f.sells, f.buyers1h].filter(rangeOn).length;
  const socials = Object.values(f.socials).filter(Boolean).length;
  const keywords = f.keywords.length + f.exclude.length;
  return { protocols, audit, metrics, socials, keywords, total: protocols + audit + metrics + socials + keywords };
}

/** Validate an imported filter object; returns a clean filter or null. */
export function sanitizeFilter(x: unknown): PulseFilter | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  const strArr = (v: unknown, max: number) => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string").map((s) => s.slice(0, 40)).slice(0, max) : []);
  const range = (v: unknown): Range => {
    const r = (v ?? {}) as Record<string, unknown>;
    const clean = (s: unknown) => (typeof s === "string" && s.length <= 16 && (s.trim() === "" || parseNum(s) != null) ? s : "");
    return { min: clean(r.min), max: clean(r.max) };
  };
  const unit = (u: unknown): AgeUnit => (u === "s" || u === "m" || u === "h" || u === "d" ? u : "m");
  const age = (o.age ?? {}) as Record<string, unknown>;
  const soc = (o.socials ?? {}) as Record<string, unknown>;
  return {
    keywords: strArr(o.keywords, 20),
    exclude: strArr(o.exclude, 20),
    protocols: strArr(o.protocols, 40).filter((p) => PROTOCOLS.some((x) => x.id === p)),
    quotes: strArr(o.quotes, 4).filter((q): q is Quote => (QUOTES as readonly string[]).includes(q)),
    age: { min: range({ min: age.min }).min, minUnit: unit(age.minUnit), max: range({ max: age.max }).max, maxUnit: unit(age.maxUnit) },
    liquidity: range(o.liquidity),
    volume: range(o.volume),
    marketCap: range(o.marketCap),
    bcurve: range(o.bcurve),
    txns: range(o.txns),
    buys: range(o.buys),
    sells: range(o.sells),
    buyers1h: range(o.buyers1h),
    socials: {
      dexPaid: soc.dexPaid === true,
      twitter: soc.twitter === true,
      website: soc.website === true,
      telegram: soc.telegram === true,
      atLeastOne: soc.atLeastOne === true,
    },
  };
}
