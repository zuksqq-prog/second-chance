import { json, requireWallet, route } from "@/lib/server/http";
import { mode } from "@/lib/server/validation";
import * as repo from "@/lib/server/repo";

export const runtime = "nodejs";

export const GET = route(
  async (ctx) => {
    const wallet = requireWallet(ctx);
    const m = mode.parse(ctx.req.nextUrl.searchParams.get("mode") ?? "paper");
    return json({ trades: await repo.listTrades(wallet, m, 200) });
  },
  { auth: true },
);
