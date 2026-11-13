import { createHash, randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import pg from "pg";
import { createDb, type DbClient } from "./client";
import * as schema from "./schema";
import { applySqlFiles, SCHEMA_DIR, SQL_DIR } from "./sql-files";

// Test harness: one private, fully-migrated Postgres database per call.
//
//   const t = await setupTestDb();   // in beforeAll
//   ... t.db ...
//   await t.close();                 // in afterAll (drops the database)
//
// How it stays fast and parallel-safe:
// - The CURRENT schema (src/schema/*.ts via drizzle-kit's in-memory diff, then src/sql/*.sql)
//   is applied once to a template database named after a hash of those files.
// - Each call clones the template with CREATE DATABASE … TEMPLATE (tens of milliseconds).
// - Template creation is serialised across processes with a Postgres advisory lock.
// - Stale templates (other hashes) and leaked test databases older than an hour are dropped.

const ADMIN_URL_DEFAULT = "postgresql://ed:ed@127.0.0.1:5432/postgres";
const LOCK_KEY = 0x65644442; // "edDB"
const STALE_SECONDS = 60 * 60;

export type TestDb = {
  db: DbClient;
  url: string;
  name: string;
  /** Closes the pool and drops the database. */
  close: () => Promise<void>;
};

function adminUrl(): string {
  return process.env.TEST_DATABASE_ADMIN_URL ?? ADMIN_URL_DEFAULT;
}

function urlFor(database: string): string {
  const u = new URL(adminUrl());
  u.pathname = `/${database}`;
  return u.toString();
}

function schemaHash(): string {
  const h = createHash("sha256");
  for (const dir of [SCHEMA_DIR, SQL_DIR]) {
    for (const f of readdirSync(dir, { recursive: true, encoding: "utf8" }).sort()) {
      if (!/\.(ts|sql)$/.test(f)) continue;
      h.update(f)
        .update("\0")
        .update(readFileSync(join(dir, f)))
        .update("\0");
    }
  }
  return h.digest("hex").slice(0, 16);
}

type KitApi = {
  generateDrizzleJson: (imports: Record<string, unknown>, prevId?: string) => unknown;
  generateMigration: (prev: unknown, cur: unknown) => Promise<string[]>;
};

async function schemaStatements(): Promise<string[]> {
  // drizzle-kit/api is CommonJS; require() keeps it out of the bundler/transform path.
  const kit = createRequire(import.meta.url)("drizzle-kit/api") as KitApi;
  return kit.generateMigration(kit.generateDrizzleJson({}), kit.generateDrizzleJson(schema));
}

async function withAdmin<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: adminUrl(), application_name: "ed-test-harness" });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

async function dropDatabase(admin: pg.Client, name: string): Promise<void> {
  await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
}

async function buildTemplate(admin: pg.Client, template: string): Promise<void> {
  const building = `${template}_building`;
  await dropDatabase(admin, building);
  await admin.query(`CREATE DATABASE "${building}"`);
  const c = new pg.Client({ connectionString: urlFor(building) });
  await c.connect();
  try {
    await c.query("BEGIN");
    for (const statement of await schemaStatements()) await c.query(statement);
    await applySqlFiles(c);
    await c.query("COMMIT");
  } catch (e) {
    await c.end();
    await dropDatabase(admin, building);
    throw new Error(`Test schema could not be applied: ${(e as Error).message}`, { cause: e });
  }
  await c.end();
  await admin.query(`ALTER DATABASE "${building}" RENAME TO "${template}"`);
}

async function sweep(admin: pg.Client, keepTemplate: string): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const { rows } = await admin.query<{ datname: string }>(
    `SELECT datname FROM pg_database WHERE datname LIKE 'ed\\_test\\_%' OR datname LIKE 'ed\\_tpl\\_%'`,
  );
  for (const { datname } of rows) {
    if (datname === keepTemplate) continue;
    // ed_test_<epoch>_<rand> | ed_tpl_<epoch>_<hash>[_building]
    const epoch = Number(datname.split("_")[2]);
    if (!Number.isFinite(epoch) || now - epoch < STALE_SECONDS) continue;
    await dropDatabase(admin, datname).catch(() => {});
  }
}

/** Finds or builds the template for the current schema hash; returns its name. */
async function ensureTemplate(admin: pg.Client): Promise<string> {
  const hash = schemaHash();
  const find = async () => {
    const { rows } = await admin.query<{ datname: string }>(
      `SELECT datname FROM pg_database WHERE datname ~ $1 ORDER BY datname DESC LIMIT 1`,
      [`^ed_tpl_[0-9]+_${hash}$`],
    );
    return rows[0]?.datname;
  };
  const existing = await find();
  if (existing) return existing;

  await admin.query("SELECT pg_advisory_lock($1)", [LOCK_KEY]);
  try {
    const again = await find();
    if (again) return again;
    const template = `ed_tpl_${Math.floor(Date.now() / 1000)}_${hash}`;
    await buildTemplate(admin, template);
    await sweep(admin, template).catch(() => {});
    return template;
  } finally {
    await admin.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]);
  }
}

export async function setupTestDb(): Promise<TestDb> {
  const name = `ed_test_${Math.floor(Date.now() / 1000)}_${randomBytes(6).toString("hex")}`;
  await withAdmin(async (admin) => {
    let lastError: unknown;
    for (let attempt = 0; attempt < 5; attempt++) {
      const template = await ensureTemplate(admin);
      try {
        await admin.query(`CREATE DATABASE "${name}" TEMPLATE "${template}"`);
        return;
      } catch (e) {
        // Template busy (55006) or swept by a run with a newer schema (3D000): retry.
        lastError = e;
        await new Promise((r) => setTimeout(r, 150 * (attempt + 1)));
      }
    }
    throw lastError;
  });

  const url = urlFor(name);
  const db = createDb(url, { max: 5, applicationName: "ed-test" });
  let closed = false;
  return {
    db,
    url,
    name,
    close: async () => {
      if (closed) return;
      closed = true;
      await db.$client.end();
      await withAdmin((admin) => dropDatabase(admin, name));
    },
  };
}
