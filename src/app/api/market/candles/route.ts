import { z } from "zod";
import { json, route } from "@/lib/server/http";
import { getCandles } from "@/lib/server/market-data";
import { address } from "@/lib/server/validation";

export const runtime = "nodejs";

const q = z.object({
  pair: address,
  tf: z.enum(["1m", "5m", "15m", "1h", "4h", "1d"]).default("5m"),
  before: z.coerce.number().int().positive().optional(),
});

export const GET = route(async ({ req }) => {
  const { pair, tf, before } = q.parse(Object.fromEntries(req.nextUrl.searchParams));
  return json({ candles: await getCandles(pair, tf, before), source: "geckoterminal" });
});
