import { json, route } from "@/lib/server/http";
import { getFeed } from "@/lib/server/market-data";
import { discoveryQuery } from "@/lib/server/validation";

export const runtime = "nodejs";

export const GET = route(async ({ req }) => {
  const { kind, page, ...filter } = discoveryQuery.parse(Object.fromEntries(req.nextUrl.searchParams));
  const tokens = await getFeed(kind, filter, page);
  return json({ kind, tokens, source: "geckoterminal", fetchedAt: Date.now() });
});
