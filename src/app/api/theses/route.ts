import { HttpError, body, json, requireWallet, route } from "@/lib/server/http";
import { createThesisBody, mode as modeSchema } from "@/lib/server/validation";
import * as repo from "@/lib/server/repo";
import { getToken } from "@/lib/server/market-data";
import { paperPositionRaw, realPositionRaw } from "@/lib/server/trading";
import { validateThesisContent } from "@/lib/domain/thesis-engine";

export const runtime = "nodejs";

export const GET = route(
  async (ctx) => {
    const wallet = requireWallet(ctx);
    const mode = modeSchema.parse(ctx.req.nextUrl.searchParams.get("mode") ?? "paper");
    return json({ theses: await repo.listTheses(wallet, mode) });
  },
  { auth: true },
);

export const POST = route(
  async (ctx) => {
    const wallet = requireWallet(ctx);
    const b = await body(ctx.req, createThesisBody);
    try {
      validateThesisContent(b.content);
    } catch (e) {
      throw new HttpError(400, "invalid_thesis", (e as Error).message);
    }
    const snap = await getToken(b.mint).catch(() => null);
    const entry = b.entryMarketCap ?? snap?.marketCap ?? null;
    const held = await (b.mode === "paper" ? paperPositionRaw(wallet, b.mint) : realPositionRaw(wallet, b.mint)).catch(() => null);
    try {
      const thesis = await repo.createThesis({
        wallet,
        mint: b.mint,
        mode: b.mode,
        tokenSymbol: snap?.symbol ?? null,
        entryMarketCap: entry,
        content: b.content,
        originalPositionRaw: held && held > 0n ? held : null,
      });
      return json({ thesis }, 201);
    } catch (e) {
      if ((e as { code?: string }).code === "exists") throw new HttpError(409, "thesis_exists", (e as Error).message);
      throw e;
    }
  },
  { auth: true },
);
