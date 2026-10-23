import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import * as repo from "@/lib/server/repo";
import { reconcileRealTrade } from "@/lib/server/trading";
import { log } from "@/lib/server/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Background reconciliation (Vercel Cron, or any scheduler hitting this URL
 * with `Authorization: Bearer $CRON_SECRET`). Settles pending real trades
 * against the chain and expires lapsed intents, even if the user closed the tab.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secret || given.length !== secret.length || !timingSafeEqual(Buffer.from(given), Buffer.from(secret))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const pending = await repo.listAllPendingRealTrades(50);
  let settled = 0;
  for (const p of pending) {
    try {
      const t = await reconcileRealTrade(p.walletAddress, p.id);
      if (t && t.status !== "pending") settled++;
    } catch (e) {
      log.warn("reconcile_failed", { tradeId: p.id, err: String(e) });
    }
  }
  const expired = await repo.expireStaleIntents();
  log.info("cron_reconcile", { pending: pending.length, settled, expired });
  return NextResponse.json({ pending: pending.length, settled, expiredIntents: expired });
}
