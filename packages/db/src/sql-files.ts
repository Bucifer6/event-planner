import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type pg from "pg";

export const SQL_DIR = join(dirname(fileURLToPath(import.meta.url)), "sql");
export const SCHEMA_DIR = join(dirname(fileURLToPath(import.meta.url)), "schema");

/** src/sql/*.sql in file-name order. */
export function listSqlFiles(): { name: string; sql: string }[] {
  return readdirSync(SQL_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(SQL_DIR, name), "utf8") }));
}

/** Apply every guard file. Each file is idempotent, so this is safe to repeat. */
export async function applySqlFiles(
  client: pg.Pool | pg.Client | pg.PoolClient,
): Promise<string[]> {
  const applied: string[] = [];
  for (const file of listSqlFiles()) {
    try {
      await client.query(file.sql);
    } catch (e) {
      throw new Error(`Failed to apply sql/${file.name}: ${(e as Error).message}`, { cause: e });
    }
    applied.push(file.name);
  }
  return applied;
}
