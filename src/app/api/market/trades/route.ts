import { HttpError, json, route } from "@/lib/server/http";
import { getLiveTrades } from "@/lib/server/market-data";
import { isSolanaAddress } from "@/lib/domain/sanitize";

export const runtime = "nodejs";

/** Live buys and sells for a token across its most active pools (all wallets, all apps). */
export const GET = route(async ({ req }) => {
  const mint = req.nextUrl.searchParams.get("mint") ?? "";
  if (!isSolanaAddress(mint)) throw new HttpError(400, "invalid_mint", "Invalid token address.");
  const r = await getLiveTrades(mint);
  return json({ ...r, source: "geckoterminal", fetchedAt: Date.now() });
});
