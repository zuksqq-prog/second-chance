import { body, json, requireWallet, route } from "@/lib/server/http";
import { address, watchBody } from "@/lib/server/validation";
import * as repo from "@/lib/server/repo";
import { getTokens } from "@/lib/server/market-data";
import { cleanSymbol } from "@/lib/domain/sanitize";

export const runtime = "nodejs";

export const GET = route(
  async (ctx) => {
    const wallet = requireWallet(ctx);
    const items = await repo.listWatchlist(wallet);
    const snaps = await getTokens(items.map((i) => i.mint as string)).catch(() => new Map());
    return json({ items: items.map((i) => ({ mint: i.mint, symbol: i.symbol, addedAt: i.addedAt, token: snaps.get(i.mint) ?? null })) });
  },
  { auth: true },
);

export const POST = route(
  async (ctx) => {
    const wallet = requireWallet(ctx);
    const b = await body(ctx.req, watchBody);
    await repo.addWatch(wallet, b.mint, b.symbol ? cleanSymbol(b.symbol) : null);
    return json({ ok: true });
  },
  { auth: true },
);

export const DELETE = route(
  async (ctx) => {
    const wallet = requireWallet(ctx);
    await repo.removeWatch(wallet, address.parse(ctx.req.nextUrl.searchParams.get("mint")));
    return json({ ok: true });
  },
  { auth: true },
);
