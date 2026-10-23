import { z } from "zod";
import { body, HttpError, json, route, SESSION_COOKIE } from "@/lib/server/http";
import { address } from "@/lib/server/validation";
import { signSession, verifySignIn } from "@/lib/server/siws";
import { consumeNonce, upsertUser } from "@/lib/server/repo";
import { env, realTradingStatus } from "@/lib/server/env";

export const runtime = "nodejs";

const SESSION_DAYS = 7;

/** Step 2: verify the wallet's signature over the stored message; issue an httpOnly session cookie. */
export const POST = route(async ({ req }) => {
  const b = await body(req, z.object({ address, nonce: z.string().regex(/^[a-f0-9]{32}$/), signature: z.string().min(64).max(100) }));
  const message = await consumeNonce(b.nonce, b.address);
  if (!message) throw new HttpError(401, "nonce_invalid", "Sign-in request expired. Try connecting again.");
  const domain = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "localhost";
  const r = verifySignIn({ message, signatureB58: b.signature, expected: { domain, address: b.address, nonce: b.nonce }, now: new Date() });
  if (!r.ok) throw new HttpError(401, "signature_invalid", r.reason);
  await upsertUser(b.address);
  const exp = Date.now() + SESSION_DAYS * 86400_000;
  const res = json({ wallet: b.address, realTrading: realTradingStatus(b.address) });
  res.cookies.set(SESSION_COOKIE, signSession({ wallet: b.address, exp }, env().SESSION_SECRET), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: new Date(exp),
  });
  return res;
});
