import { json, route } from "@/lib/server/http";
import { realTradingStatus } from "@/lib/server/env";

export const runtime = "nodejs";

export const GET = route(async ({ wallet }) => json({ wallet, realTrading: realTradingStatus(wallet) }));
