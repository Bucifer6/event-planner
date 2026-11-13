import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { systemCtx, type Ctx } from "@ed/core/context";
import { closeDb, getDb, sql } from "@ed/db";
import { assertBootEnv, EnvError } from "@ed/shared/env";

// The single worker process (Q7): no HTTP surface; drains the Postgres job queue.

/** What the job runner hands back so the worker can stop it cleanly. */
export type RunnerHandle = { stop: () => Promise<void> };

/**
 * SEAM — owned by the jobs agent.
 * Start the @ed/jobs runner here (lease loop with FOR UPDATE SKIP LOCKED + the scheduler)
 * and return a handle whose stop() resolves once in-flight jobs have finished or been
 * released. `ctx` is a system-actor Ctx on the shared pool.
 */
async function startRunner(_ctx: Ctx): Promise<RunnerHandle> {
  return { stop: async () => {} };
}

async function main(): Promise<void> {
  // Local development reads the repo-root .env; deployed environments inject real env vars.
  const rootEnv = resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env");
  if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

  try {
    assertBootEnv();
  } catch (e) {
    if (e instanceof EnvError) {
      console.error(`[worker] ${e.message}`); // names only, never values (SEC13)
      process.exit(1);
    }
    throw e;
  }

  const db = getDb();
  await db.execute(sql`select 1`);
  console.info("[worker] started, database reachable");

  const runner = await startRunner(systemCtx(db));

  let stopping = false;
  const keepAlive = setInterval(() => {}, 60_000);
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.info(`[worker] ${signal} received, shutting down`);
    const force = setTimeout(() => {
      console.error("[worker] shutdown timed out");
      process.exit(1);
    }, 30_000);
    force.unref();
    try {
      await runner.stop();
      await closeDb();
      clearInterval(keepAlive);
      console.info("[worker] stopped cleanly");
      process.exit(0);
    } catch (e) {
      console.error("[worker] error during shutdown:", (e as Error).name);
      process.exit(1);
    }
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((e) => {
  console.error("[worker] failed to start:", (e as Error).name, (e as Error).message);
  process.exit(1);
});
