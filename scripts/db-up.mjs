// Starts a local embedded PostgreSQL (dev only; production is hosted in the EU per INF9)
// and writes .env with the resulting DATABASE_URL. Run once: `pnpm db:up`.
import EmbeddedPostgres from 'embedded-postgres';
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const dataDir = join(root, '.pgdata');
const port = 5432;

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: 'postgres',
  password: 'postgres',
  port,
  persistent: true,
  autoRehydrateSymlinks: true,
});

if (!existsSync(join(dataDir, 'PG_VERSION'))) {
  mkdirSync(dataDir, { recursive: true });
  await pg.initialise();
}
await pg.start();
await pg.createDatabase('eventdesk').catch(() => {});

const url = `postgresql://postgres:postgres@localhost:${port}/eventdesk`;
const envPath = join(root, '.env');
let env = '';
if (existsSync(envPath))
  env = await import('node:fs').then((fs) => fs.readFileSync(envPath, 'utf8'));
const lines = env.split('\n').filter((l) => !l.startsWith('DATABASE_URL='));
lines.push(`DATABASE_URL="${url}"`);
writeFileSync(envPath, lines.join('\n'));

console.log(`PostgreSQL running at ${url}`);
console.log(
  'DATABASE_URL written to .env — press Ctrl+C to stop; the cluster persists in .pgdata/.'
);

process.on('SIGINT', async () => {
  await pg.stop();
  process.exit(0);
});
