import type { Db } from "../client";
import { templatesSeed } from "./templates";
import { categoriesSeed } from "./categories";
import { geographySeed } from "./geography";
import { monetizationSeed } from "./monetization";

/**
 * A seed module. It MUST be idempotent: running it twice leaves the same data
 * (use onConflictDoNothing / onConflictDoUpdate or check-then-insert inside the transaction).
 */
export type Seed = {
  name: string;
  run: (db: Db) => Promise<void>;
};

// Registry. To add a seed: create src/seed/<name>.ts exporting a `Seed`, import it here and
// append it to the array (append only; seeds run in array order).
export const seeds: Seed[] = [templatesSeed, categoriesSeed, geographySeed, monetizationSeed];

/** Runs every registered seed, each in its own transaction. Returns the names that ran. */
export async function runSeeds(db: Db, only?: string[]): Promise<string[]> {
  const ran: string[] = [];
  for (const seed of seeds) {
    if (only && !only.includes(seed.name)) continue;
    await db.transaction(async (tx) => {
      await seed.run(tx);
    });
    ran.push(seed.name);
  }
  return ran;
}
