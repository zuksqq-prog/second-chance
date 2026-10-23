/**
 * Apply SQL migrations in drizzle/ in filename order, once each.
 * Usage: DATABASE_URL=... npm run db:migrate
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");
  const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
  try {
    await sql`create table if not exists schema_migrations (id text primary key, applied_at timestamptz not null default now())`;
    const dir = join(process.cwd(), "drizzle");
    const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
    const done = new Set((await sql`select id from schema_migrations`).map((r) => r.id as string));
    for (const f of files) {
      if (done.has(f)) continue;
      const text = readFileSync(join(dir, f), "utf8");
      await sql.begin(async (tx) => {
        await tx.unsafe(text);
        await tx`insert into schema_migrations (id) values (${f})`;
      });
      console.log(`applied ${f}`);
    }
    console.log("migrations up to date");
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
