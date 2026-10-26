import { json, route } from "@/lib/server/http";
import { getPulse } from "@/lib/server/market-data";

export const runtime = "nodejs";

/** New Pairs / Final Stretch / Migrated board. */
export const GET = route(async () => json(await getPulse()));
