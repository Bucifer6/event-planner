import type { ExtractTablesWithRelations } from "drizzle-orm";
import { drizzle, type NodePgDatabase, type NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import type { PgDatabase, PgTransaction } from "drizzle-orm/pg-core";
import pg from "pg";
import * as schema from "./schema";

export type Schema = typeof schema;

/**
 * What domain code accepts: a pooled connection OR an open transaction (both extend this).
 * Core functions take `ctx.db: Db` and therefore work inside and outside inTx().
 */
export type Db = PgDatabase<NodePgQueryResultHKT, Schema, ExtractTablesWithRelations<Schema>>;

/** An open transaction (what `db.transaction(async (tx) => …)` hands you). Assignable to Db. */
export type Tx = PgTransaction<NodePgQueryResultHKT, Schema, ExtractTablesWithRelations<Schema>>;

/** Kept for readability at call sites that want to say "either". Same as Db. */
export type DbOrTx = Db;

/** The pooled root connection; `$client` is the pg.Pool. Assignable to Db. */
export type DbClient = NodePgDatabase<Schema> & { $client: pg.Pool };

export type CreateDbOptions = {
  /** Pool size. Default 10. */
  max?: number;
  /** Shown in pg_stat_activity. */
  applicationName?: string;
};

export function createDb(url: string, opts: CreateDbOptions = {}): DbClient {
  const pool = new pg.Pool({
    connectionString: url,
    max: opts.max ?? 10,
    application_name: opts.applicationName ?? "eventdesk",
  });
  // An idle client erroring (server restart) must not crash the process.
  pool.on("error", () => {});
  return drizzle(pool, { schema });
}

// Survives Next.js dev hot reloads (module re-evaluation) without leaking pools.
const globalForDb = globalThis as unknown as { __edDb?: DbClient };

/** Process-wide singleton from DATABASE_URL. */
export function getDb(): DbClient {
  if (!globalForDb.__edDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("Missing environment variable: DATABASE_URL");
    globalForDb.__edDb = createDb(url);
  }
  return globalForDb.__edDb;
}

/** Close the singleton pool (worker shutdown, scripts). */
export async function closeDb(): Promise<void> {
  const db = globalForDb.__edDb;
  globalForDb.__edDb = undefined;
  if (db) await db.$client.end();
}
