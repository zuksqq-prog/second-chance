import "server-only";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { env } from "@/lib/server/env";
import * as schema from "./schema";

type Sql = ReturnType<typeof postgres>;

declare global {
  // eslint-disable-next-line no-var
  var __sc_sql: Sql | undefined;
}

/**
 * One connection pool per server instance, created on first use (not at
 * import time, so `next build` never needs runtime secrets). `prepare: false`
 * keeps it compatible with transaction-mode poolers (Neon, Supabase, PgBouncer).
 */
function getSql(): Sql {
  if (!globalThis.__sc_sql) {
    globalThis.__sc_sql = postgres(env().DATABASE_URL, {
      max: process.env.VERCEL ? 3 : 10,
      prepare: false,
      idle_timeout: 20,
      // Rows come back camelCased; numeric columns stay strings (parsed to bigint by repos).
      transform: { column: { from: postgres.toCamel } },
    });
  }
  return globalThis.__sc_sql;
}

/** Lazy proxy: behaves exactly like the postgres.js `sql` tag and its methods. */
export const sql: Sql = new Proxy(function () {} as unknown as Sql, {
  apply: (_t, _this, args) => (getSql() as unknown as (...a: unknown[]) => unknown)(...args),
  get: (_t, prop) => {
    const real = getSql() as unknown as Record<string | symbol, unknown>;
    const v = real[prop];
    return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(real) : v;
  },
});

let _db: ReturnType<typeof drizzle> | null = null;
export function db() {
  return (_db ??= drizzle(getSql(), { schema }));
}
export { schema };
