import { HttpError, json, route } from "@/lib/server/http";
import { getBondingCurve } from "@/lib/server/pump";
import { isSolanaAddress } from "@/lib/domain/sanitize";

export const runtime = "nodejs";

/** The token's creator ("dev") wallet, read from its pump.fun bonding curve. Null for other launchpads. */
export const GET = route(async ({ params }) => {
  if (!isSolanaAddress(params.mint)) throw new HttpError(400, "invalid_mint", "Invalid token address.");
  const curve = await getBondingCurve(params.mint).catch(() => null);
  return json({ creator: curve?.creator ?? null, source: curve ? "pump.fun bonding curve" : null }, { headers: { "cache-control": "public, max-age=300" } });
});
