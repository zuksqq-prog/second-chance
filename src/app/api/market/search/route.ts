import { json, route } from "@/lib/server/http";
import { searchTokens } from "@/lib/server/market-data";

export const runtime = "nodejs";

export const GET = route(async ({ req }) => {
  const q = (req.nextUrl.searchParams.get("q") ?? "").slice(0, 64);
  return json({ tokens: q.trim().length < 2 ? [] : await searchTokens(q) });
});
