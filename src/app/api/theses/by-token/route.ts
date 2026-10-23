import { json, requireWallet, route } from "@/lib/server/http";
import { address, mode } from "@/lib/server/validation";
import * as repo from "@/lib/server/repo";

export const runtime = "nodejs";

export const GET = route(
  async (ctx) => {
    const wallet = requireWallet(ctx);
    const mint = address.parse(ctx.req.nextUrl.searchParams.get("mint"));
    const m = mode.parse(ctx.req.nextUrl.searchParams.get("mode") ?? "paper");
    return json({ thesis: await repo.getActiveThesis(wallet, mint, m) });
  },
  { auth: true },
);
