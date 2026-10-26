import { json, requireWallet, route } from "@/lib/server/http";
import { env, platformFeeBps } from "@/lib/server/env";
import * as repo from "@/lib/server/repo";
import { cashbackLamports, claimable, dailyCumulative, MIN_CLAIM_LAMPORTS, quests } from "@/lib/domain/rewards";

export const runtime = "nodejs";

/** Cashback earned on platform fees, claimable balance, history, and quests. Real trades only. */
export const GET = route(
  async (ctx) => {
    const wallet = requireWallet(ctx);
    const pct = env().REWARDS_CASHBACK_PCT;
    const a = await repo.rewardsActivity(wallet);
    const earned = cashbackLamports(a.feeLamports, pct);
    const series = dailyCumulative(
      a.feesByDay.map((d) => ({ day: d.day, lamports: cashbackLamports(d.lamports, pct) })),
      8,
      new Date(),
    );
    const volumeSol = Number(a.volumeLamports) / 1e9;
    return json({
      program: { active: platformFeeBps() > 0, platformFeeBps: platformFeeBps(), cashbackPct: pct },
      earnedLamports: earned,
      claimableLamports: claimable(earned, a.reservedLamports),
      paidLamports: a.paidLamports,
      minClaimLamports: MIN_CLAIM_LAMPORTS,
      series,
      claims: a.claims,
      payoutAddress: wallet,
      activity: { volumeSol, txCount: a.txCount },
      quests: quests(volumeSol, a.txCount),
    });
  },
  { auth: true },
);
