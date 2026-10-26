import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError, type ZodTypeAny, type output } from "zod";
import { IntentError } from "@/lib/domain/trade-intent";
import { apiLimiter } from "./rate-limit";
import { UpstreamError } from "./market-data";
import { env } from "./env";
import { verifySession } from "./siws";
import { log } from "./log";

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export const SESSION_COOKIE = "sc_session";

/** JSON with bigint → string. */
export function json(data: unknown, init: number | ResponseInit = 200): NextResponse {
  const body = JSON.stringify(data, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
  const i = typeof init === "number" ? { status: init } : init;
  return new NextResponse(body, { ...i, headers: { "content-type": "application/json", ...(i.headers ?? {}) } });
}

function clientIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
}

/** CSRF defence for state-changing requests: same-origin only, JSON only. */
function checkMutation(req: NextRequest) {
  if (req.method === "GET" || req.method === "HEAD") return;
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!origin || !host || new URL(origin).host !== host) throw new HttpError(403, "bad_origin", "Cross-site request blocked.");
  const ct = req.headers.get("content-type") ?? "";
  if (req.method !== "DELETE" && !ct.includes("application/json"))
    throw new HttpError(415, "bad_content_type", "Requests must be JSON.");
}

export interface Ctx {
  req: NextRequest;
  wallet: string | null;
  params: Record<string, string>;
}

type Handler = (ctx: Ctx) => Promise<Response>;

export function route(handler: Handler, opts: { auth?: boolean } = {}) {
  return async (req: NextRequest, context: { params: Promise<Record<string, string>> }) => {
    const started = Date.now();
    try {
      const rl = apiLimiter.take(`ip:${clientIp(req)}`);
      if (!rl.ok) throw new HttpError(429, "rate_limited", "Too many requests. Slow down a little.");
      checkMutation(req);
      const session = verifySession(req.cookies.get(SESSION_COOKIE)?.value, env().SESSION_SECRET, Date.now());
      if (opts.auth && !session) throw new HttpError(401, "unauthenticated", "Connect and sign in with your wallet first.");
      const params = (await context?.params) ?? {};
      return await handler({ req, wallet: session?.wallet ?? null, params });
    } catch (e) {
      return toErrorResponse(e, req, started);
    }
  };
}

export function toErrorResponse(e: unknown, req: NextRequest, started: number): NextResponse {
  if (e instanceof HttpError) return json({ error: e.message, code: e.code }, e.status);
  if (e instanceof IntentError) {
    const status = e.code === "forbidden" ? 403 : e.code === "not_found" ? 404 : 409;
    return json({ error: e.message, code: e.code }, status);
  }
  if (e instanceof ZodError) return json({ error: e.issues[0]?.message ?? "Invalid request.", code: "invalid_request" }, 400);
  if (e instanceof UpstreamError) {
    log.warn("upstream_error", { provider: e.provider, status: e.status, path: req.nextUrl.pathname });
    return json({ error: `Market data provider (${e.provider}) is unavailable right now.`, code: "upstream_unavailable" }, 502);
  }
  log.error("unhandled_error", { path: req.nextUrl.pathname, ms: Date.now() - started, err: e instanceof Error ? e.message : String(e) });
  return json({ error: "Something went wrong on our side. Try again.", code: "internal" }, 500);
}

/** Parse a JSON body; returns the schema's OUTPUT type (defaults applied, transforms run). */
export async function body<S extends ZodTypeAny>(req: NextRequest, schema: S): Promise<output<S>> {
  let data: unknown;
  try {
    data = await req.json();
  } catch {
    throw new HttpError(400, "invalid_json", "Request body must be valid JSON.");
  }
  return schema.parse(data);
}

export function requireWallet(ctx: Ctx): string {
  if (!ctx.wallet) throw new HttpError(401, "unauthenticated", "Connect and sign in with your wallet first.");
  return ctx.wallet;
}
