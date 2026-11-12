// One-shot dev DB setup: starts embedded PostgreSQL, runs prisma migrate dev + seed,
// leaves the cluster in .pgdata/ (restart later with `pnpm db:up`).
import EmbeddedPostgres from 'embedded-postgres';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const dbDir = join(root, 'packages/db');
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

await pg.initialise();
await pg.start();
await pg.createDatabase('eventdesk').catch(() => {});
const url = `postgresql://postgres:postgres@localhost:${port}/eventdesk`;
console.log('DATABASE_URL=' + url);

const env = { ...process.env, DATABASE_URL: url };
execSync('pnpm exec prisma migrate dev --name init --skip-seed', {
  cwd: dbDir,
  env,
  stdio: 'inherit',
});
execSync('pnpm exec prisma db seed', { cwd: dbDir, env, stdio: 'inherit' });
execSync('pnpm exec prisma generate', { cwd: dbDir, env, stdio: 'inherit' });

await pg.stop();
console.log('DB setup complete. Cluster persists in .pgdata/');
process.exit(0);
