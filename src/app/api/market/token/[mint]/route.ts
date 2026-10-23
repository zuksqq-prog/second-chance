import { HttpError, json, route } from "@/lib/server/http";
import { getToken } from "@/lib/server/market-data";
import { isSolanaAddress } from "@/lib/domain/sanitize";

export const runtime = "nodejs";

export const GET = route(async ({ params }) => {
  if (!isSolanaAddress(params.mint)) throw new HttpError(400, "invalid_mint", "Invalid token address.");
  const token = await getToken(params.mint);
  if (!token) throw new HttpError(404, "not_found", "No trading pairs found for this token on Solana.");
  return json({ token });
});
