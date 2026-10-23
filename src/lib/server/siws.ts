/**
 * Sign-In With Solana + stateless session tokens.
 * Uses only node:crypto (Ed25519 verify, HMAC) — no wallet secrets ever touch
 * the server. The browser signs a human-readable message with the wallet.
 */
import { createHmac, createPublicKey, timingSafeEqual, verify as cryptoVerify, randomBytes } from "node:crypto";

import { base58Decode, base58Encode } from "../domain/base58";

export { base58Decode, base58Encode };

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export function verifyEd25519(message: Uint8Array, signature: Uint8Array, publicKey: Uint8Array): boolean {
  if (publicKey.length !== 32 || signature.length !== 64) return false;
  try {
    const key = createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(publicKey)]), format: "der", type: "spki" });
    return cryptoVerify(null, Buffer.from(message), key, Buffer.from(signature));
  } catch {
    return false;
  }
}

export interface SignInMessageFields {
  domain: string;
  address: string;
  nonce: string;
  issuedAt: string; // ISO
  expirationTime: string; // ISO
}

export function buildSignInMessage(f: SignInMessageFields): string {
  return [
    `${f.domain} wants you to sign in with your Solana account:`,
    f.address,
    "",
    "Sign in to SECOND CHANCE. This request will not trigger a blockchain transaction or cost any fees.",
    "",
    `URI: https://${f.domain}`,
    "Version: 1",
    "Chain ID: mainnet",
    `Nonce: ${f.nonce}`,
    `Issued At: ${f.issuedAt}`,
    `Expiration Time: ${f.expirationTime}`,
  ].join("\n");
}

export function newNonce(): string {
  return randomBytes(16).toString("hex");
}

export interface VerifySignInInput {
  message: string;
  signatureB58: string;
  expected: { domain: string; address: string; nonce: string };
  now: Date;
}

export function verifySignIn(input: VerifySignInInput): { ok: true } | { ok: false; reason: string } {
  const lines = input.message.split("\n");
  const get = (prefix: string) => lines.find((l) => l.startsWith(prefix))?.slice(prefix.length);
  if (lines[0] !== `${input.expected.domain} wants you to sign in with your Solana account:`)
    return { ok: false, reason: "Domain mismatch." };
  if (lines[1] !== input.expected.address) return { ok: false, reason: "Address mismatch." };
  if (get("Nonce: ") !== input.expected.nonce) return { ok: false, reason: "Nonce mismatch." };
  const exp = get("Expiration Time: ");
  if (!exp || Number.isNaN(Date.parse(exp)) || Date.parse(exp) < input.now.getTime())
    return { ok: false, reason: "Sign-in request expired." };
  let sig: Uint8Array, pk: Uint8Array;
  try {
    sig = base58Decode(input.signatureB58);
    pk = base58Decode(input.expected.address);
  } catch {
    return { ok: false, reason: "Malformed signature or address." };
  }
  if (!verifyEd25519(new TextEncoder().encode(input.message), sig, pk)) return { ok: false, reason: "Invalid signature." };
  return { ok: true };
}

// ---- Session tokens: base64url(payload).base64url(hmac) ----

export interface SessionPayload {
  wallet: string;
  exp: number; // epoch ms
}

export function signSession(payload: SessionPayload, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${mac}`;
}

export function verifySession(token: string | undefined, secret: string, nowMs: number): SessionPayload | null {
  if (!token) return null;
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  const expected = createHmac("sha256", secret).update(body).digest();
  const given = Buffer.from(mac, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString()) as SessionPayload;
    if (typeof p.wallet !== "string" || typeof p.exp !== "number" || p.exp < nowMs) return null;
    return p;
  } catch {
    return null;
  }
}
