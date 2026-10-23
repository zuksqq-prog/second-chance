import { json, requireWallet, route } from "@/lib/server/http";
import { env } from "@/lib/server/env";
import * as repo from "@/lib/server/repo";

export const runtime = "nodejs";

/** Wipe paper trades, close paper theses (kept for history) and restore the starting balance. */
export const POST = route(
  async (ctx) => {
    const wallet = requireWallet(ctx);
    const start = BigInt(Math.round(env().PAPER_STARTING_SOL * 1e9));
    await repo.getOrCreatePaperAccount(wallet, start);
    await repo.resetPaperAccount(wallet, start);
    return json({ ok: true, solBalance: env().PAPER_STARTING_SOL });
  },
  { auth: true },
);
