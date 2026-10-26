import { HttpError, json, requireWallet, route } from "@/lib/server/http";
import { env } from "@/lib/server/env";
import * as repo from "@/lib/server/repo";
import { cashbackLamports, claimable, MIN_CLAIM_LAMPORTS } from "@/lib/domain/rewards";

export const runtime = "nodejs";

/**
 * Request payout of all claimable cashback to the signed-in wallet. Creates a
 * pending claim the operator pays from the rewards wallet (see DEPLOY.md).
 * One pending claim per wallet at a time.
 */
export const POST = route(
  async (ctx) => {
    const wallet = requireWallet(ctx);
    const a = await repo.rewardsActivity(wallet);
    const amount = claimable(cashbackLamports(a.feeLamports, env().REWARDS_CASHBACK_PCT), a.reservedLamports);
    if (amount < MIN_CLAIM_LAMPORTS) throw new HttpError(409, "below_minimum", "You need at least 0.001 SOL of cashback to claim.");
    const id = await repo.createClaim(wallet, amount, wallet);
    if (!id) throw new HttpError(409, "claim_pending", "You already have a claim being paid out.");
    return json({ id, amountLamports: amount, status: "pending" }, 201);
  },
  { auth: true },
);
