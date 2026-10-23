import { z } from "zod";
import { body, json, route } from "@/lib/server/http";
import { address } from "@/lib/server/validation";
import { buildSignInMessage, newNonce } from "@/lib/server/siws";
import { storeNonce } from "@/lib/server/repo";

export const runtime = "nodejs";

/** Step 1 of sign-in: server issues the exact message the wallet will sign. */
export const POST = route(async ({ req }) => {
  const { address: wallet } = await body(req, z.object({ address }));
  const domain = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "localhost";
  const nonce = newNonce();
  const now = new Date();
  const expires = new Date(now.getTime() + 10 * 60_000);
  const message = buildSignInMessage({ domain, address: wallet, nonce, issuedAt: now.toISOString(), expirationTime: expires.toISOString() });
  await storeNonce(nonce, wallet, message, expires);
  return json({ nonce, message });
});
