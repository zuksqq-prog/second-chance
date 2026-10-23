import { body, json, requireWallet, route } from "@/lib/server/http";
import { realExecuteBody } from "@/lib/server/validation";
import { executeReal } from "@/lib/server/trading";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Submit a transaction the user signed in their wallet. The server checks it is
 * byte-identical to the quoted message, consumes the intent exactly once,
 * submits via Jupiter, then confirms on-chain before reporting success.
 */
export const POST = route(
  async (ctx) => {
    const wallet = requireWallet(ctx);
    const b = await body(ctx.req, realExecuteBody);
    return json(await executeReal(wallet, b.intentId, b.signedTransaction));
  },
  { auth: true },
);
