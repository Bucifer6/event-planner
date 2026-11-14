import { closeDb, getDb } from "../client";
import { runSeeds } from "../seed";
import { loadRootEnv } from "./_env";

// pnpm db:seed            run every seed
// pnpm db:seed -- a b     run only the named seeds
loadRootEnv();
const only = process.argv.slice(2).filter((a) => a !== "--");
try {
  const ran = await runSeeds(getDb(), only.length > 0 ? only : undefined);
  console.info(`Seeds run: ${ran.join(", ") || "(none registered)"}`);
} finally {
  await closeDb();
}
