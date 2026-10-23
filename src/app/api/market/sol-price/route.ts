import { json, route } from "@/lib/server/http";
import { getSolUsd } from "@/lib/server/market-data";

export const runtime = "nodejs";

export const GET = route(async () => json({ solUsd: await getSolUsd() }));
