/**
 * Defensive handling of untrusted token metadata and user input.
 * Token names, symbols and image URLs are attacker-controlled on Solana.
 */

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]+$/;

export function isSolanaAddress(s: unknown): boolean {
  return typeof s === "string" && s.length >= 32 && s.length <= 44 && BASE58.test(s);
}

// Control chars, bidi overrides/isolates, zero-width chars, BOM.
const DANGEROUS_CHARS = /[\u0000-\u001F\u007F-\u009F​-‏‪-‮⁠-⁩﻿]/g;

export function cleanText(input: unknown, maxLen: number): string {
  if (typeof input !== "string") return "";
  const cleaned = input.normalize("NFKC").replace(DANGEROUS_CHARS, "").replace(/\s+/g, " ").trim();
  return Array.from(cleaned).slice(0, maxLen).join("");
}

export function cleanSymbol(input: unknown): string {
  const s = cleanText(input, 16);
  return s || "???";
}

export function cleanName(input: unknown): string {
  const s = cleanText(input, 48);
  return s || "Unknown token";
}

/** Allow only https image URLs on hosts we expect. Anything else is dropped. */
const IMAGE_HOSTS = [
  "dd.dexscreener.com",
  "cdn.dexscreener.com",
  "assets.geckoterminal.com",
  "coin-images.coingecko.com",
  "assets.coingecko.com",
  "ipfs.io",
  "arweave.net",
  "cf-ipfs.com",
  "pump.mypinata.cloud",
  "mypinata.cloud",
  "ipfs.dweb.link",
  "dweb.link",
  "gateway.pinata.cloud",
  "ipfs.io",
];

export function safeImageUrl(input: unknown): string | null {
  if (typeof input !== "string" || input.length > 500) return null;
  try {
    const u = new URL(input);
    if (u.protocol !== "https:") return null;
    const host = u.hostname.toLowerCase();
    if (!IMAGE_HOSTS.some((h) => host === h || host.endsWith("." + h))) return null;
    if (/missing/i.test(u.pathname)) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** Only http(s) external links; used for token socials. */
export function safeExternalUrl(input: unknown): string | null {
  if (typeof input !== "string" || input.length > 300) return null;
  try {
    const u = new URL(input);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

export function finiteOrNull(n: unknown): number | null {
  const v = typeof n === "string" ? Number(n) : n;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
