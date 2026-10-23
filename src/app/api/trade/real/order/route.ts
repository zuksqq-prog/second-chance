import { body, json, requireWallet, route } from "@/lib/server/http";
import { realOrderBody } from "@/lib/server/validation";
import { createRealOrder } from "@/lib/server/trading";

export const runtime = "nodejs";

/** Quote + unsigned transaction from Jupiter, bound to a cleared intent. Nothing is signed or sent here. */
export const POST = route(
  async (ctx) => {
    const wallet = requireWallet(ctx);
    const b = await body(ctx.req, realOrderBody);
    return json(await createRealOrder(wallet, b.intentId, { slippageBps: b.slippageBps }));
  },
  { auth: true },
);
