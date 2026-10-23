import { z } from "zod";
import { HttpError, json, requireWallet, route } from "@/lib/server/http";
import * as repo from "@/lib/server/repo";
import { reconcileRealTrade } from "@/lib/server/trading";

export const runtime = "nodejs";

/** Poll a trade. Pending real trades are reconciled against the chain on each call. */
export const GET = route(
  async (ctx) => {
    const wallet = requireWallet(ctx);
    const id = z.string().uuid().parse(ctx.params.id);
    const t = await repo.getTrade(wallet, id);
    if (!t) throw new HttpError(404, "not_found", "Trade not found.");
    const trade = t.mode === "real" && t.status === "pending" ? await reconcileRealTrade(wallet, id) : t;
    return json({ trade });
  },
  { auth: true },
);
