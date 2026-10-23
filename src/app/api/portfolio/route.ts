import { json, requireWallet, route } from "@/lib/server/http";
import { mode } from "@/lib/server/validation";
import { getPortfolio } from "@/lib/server/portfolio-service";

export const runtime = "nodejs";

export const GET = route(
  async (ctx) => {
    const wallet = requireWallet(ctx);
    const m = mode.parse(ctx.req.nextUrl.searchParams.get("mode") ?? "paper");
    return json(await getPortfolio(wallet, m));
  },
  { auth: true },
);
