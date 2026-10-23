import { z } from "zod";
import { body, json, requireWallet, route } from "@/lib/server/http";
import { ackBody } from "@/lib/server/validation";
import { acknowledgeTrade } from "@/lib/server/trading";

export const runtime = "nodejs";

export const POST = route(
  async (ctx) => {
    const wallet = requireWallet(ctx);
    const id = z.string().uuid().parse(ctx.params.id);
    const b = await body(ctx.req, ackBody);
    return json(await acknowledgeTrade(wallet, id, b.action, b.update));
  },
  { auth: true },
);
