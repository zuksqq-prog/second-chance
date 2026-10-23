import { HttpError, json, route } from "@/lib/server/http";
import { getTokenSecurity } from "@/lib/server/solana-rpc";
import { isSolanaAddress } from "@/lib/domain/sanitize";

export const runtime = "nodejs";

export const GET = route(async ({ params }) => {
  if (!isSolanaAddress(params.mint)) throw new HttpError(400, "invalid_mint", "Invalid token address.");
  try {
    return json({ security: await getTokenSecurity(params.mint) });
  } catch (e) {
    throw new HttpError(502, "rpc_unavailable", `Couldn't read on-chain token data: ${(e as Error).message}`);
  }
});
