import { body, json, requireWallet, route } from "@/lib/server/http";
import { paperExecuteBody } from "@/lib/server/validation";
import { executePaper } from "@/lib/server/trading";

export const runtime = "nodejs";

/** Simulated fill at the live price. Recorded with simulated = true; never shown as a real trade. */
export const POST = route(
  async (ctx) => {
    const wallet = requireWallet(ctx);
    const b = await body(ctx.req, paperExecuteBody);
    return json(await executePaper(wallet, b.intentId, { slippageBps: b.slippageBps, priorityFeeLamports: b.priorityFeeLamports }));
  },
  { auth: true },
);
