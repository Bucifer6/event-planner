import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { applySqlFiles } from "../sql-files";
import { loadRootEnv } from "./_env";

// Production path ("prisma migrate deploy" in the plan): drizzle migrations, then SQL guards.
loadRootEnv();
const migrationsFolder = resolve(process.cwd(), "drizzle");
if (!existsSync(resolve(migrationsFolder, "meta/_journal.json"))) {
  console.error(
    "No migrations found in packages/db/drizzle. The integrator generates the initial migration " +
      "with `pnpm db:generate`; during feature work use `pnpm db:push`.",
  );
  process.exit(1);
}
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
try {
  await migrate(drizzle(pool), { migrationsFolder });
  const applied = await applySqlFiles(pool);
  console.info(`Migrations applied. SQL guards: ${applied.join(", ") || "(none)"}`);
} finally {
  await pool.end();
}
