import "server-only";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { env } from "@/lib/server/env";
import * as schema from "./schema";

declare global {
  // eslint-disable-next-line no-var
  var __sc_sql: ReturnType<typeof postgres> | undefined;
}

/**
 * One connection pool per server instance. `prepare: false` keeps it
 * compatible with transaction-mode poolers (Neon, Supabase, PgBouncer).
 */
export const sql =
  globalThis.__sc_sql ??
  postgres(env().DATABASE_URL, {
    max: process.env.VERCEL ? 3 : 10,
    prepare: false,
    idle_timeout: 20,
    // Rows come back camelCased; numeric columns stay strings (parsed to bigint by repos).
    transform: { column: { from: postgres.toCamel } },
  });
if (process.env.NODE_ENV !== "production") globalThis.__sc_sql = sql;

export const db = drizzle(sql, { schema });
export { schema };
