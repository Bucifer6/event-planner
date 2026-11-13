import pg from "pg";
import { applySqlFiles } from "../sql-files";
import { loadRootEnv } from "./_env";

loadRootEnv();
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const applied = await applySqlFiles(client);
  console.info(`Applied SQL guards: ${applied.join(", ") || "(none)"}`);
} finally {
  await client.end();
}
