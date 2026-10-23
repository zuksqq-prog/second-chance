import { z } from "zod";
import { HttpError, body, json, requireWallet, route } from "@/lib/server/http";
import { reviseThesisBody } from "@/lib/server/validation";
import * as repo from "@/lib/server/repo";
import { reviseThesis } from "@/lib/domain/thesis-engine";
import { getToken } from "@/lib/server/market-data";

export const runtime = "nodejs";

const id = z.string().uuid();

export const GET = route(
  async (ctx) => {
    const wallet = requireWallet(ctx);
    const thesis = await repo.getThesis(wallet, id.parse(ctx.params.id));
    if (!thesis) throw new HttpError(404, "not_found", "Thesis not found.");
    return json({ thesis, revisions: await repo.listRevisions(thesis.id, wallet) });
  },
  { auth: true },
);

/** Edits always create a new revision. The original is immutable (also enforced by a DB trigger). */
export const PATCH = route(
  async (ctx) => {
    const wallet = requireWallet(ctx);
    const thesis = await repo.getThesis(wallet, id.parse(ctx.params.id));
    if (!thesis || thesis.status !== "active") throw new HttpError(404, "not_found", "Active thesis not found.");
    const b = await body(ctx.req, reviseThesisBody);
    let result;
    try {
      result = reviseThesis(thesis, b.patch, b.reason);
    } catch (e) {
      throw new HttpError(400, "invalid_revision", (e as Error).message);
    }
    const snap = await getToken(thesis.mint).catch(() => null);
    const updated = await repo.addRevision({
      thesisId: thesis.id,
      wallet,
      next: result.next,
      changed: result.changed,
      reason: b.reason,
      trigger: "edit",
      marketCap: snap?.marketCap ?? null,
    });
    return json({ thesis: updated });
  },
  { auth: true },
);

/** Permanent deletion, only on explicit user request. */
export const DELETE = route(
  async (ctx) => {
    const wallet = requireWallet(ctx);
    await repo.deleteThesis(wallet, id.parse(ctx.params.id));
    return json({ ok: true });
  },
  { auth: true },
);
