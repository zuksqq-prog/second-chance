import { NextResponse } from "next/server";
import { sql } from "@/db";
import { env } from "@/lib/server/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Liveness + configuration check (no secrets). Point uptime monitors here. */
export async function GET() {
  const checks: Record<string, unknown> = {};
  try {
    await sql`select 1`;
    checks.database = "ok";
  } catch (e) {
    checks.database = `error: ${(e as Error).message}`;
  }
  const e = env();
  checks.rpc = e.HELIUS_API_KEY || e.SOLANA_RPC_URL ? "dedicated" : "public (rate limited)";
  checks.jupiterKey = e.JUPITER_API_KEY ? "set" : "keyless (0.5 rps)";
  checks.realTrading = e.REAL_TRADING_ENABLED === "true" ? "enabled for allowlist" : "disabled";
  const ok = checks.database === "ok";
  return NextResponse.json({ ok, checks }, { status: ok ? 200 : 503 });
}
