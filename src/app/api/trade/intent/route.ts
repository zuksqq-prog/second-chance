import { body, json, requireWallet, route } from "@/lib/server/http";
import { startTradeBody } from "@/lib/server/validation";
import { startTrade } from "@/lib/server/trading";

export const runtime = "nodejs";

/**
 * Every trade starts here. For sells, the server evaluates the active thesis
 * against live market cap and returns either a cleared intent or one that
 * needs the SECOND CHANCE acknowledgement before any execution endpoint
 * will accept it.
 */
export const POST = route(
  async (ctx) => {
    const wallet = requireWallet(ctx);
    const b = await body(ctx.req, startTradeBody);
    return json(await startTrade(wallet, b));
  },
  { auth: true },
);
