// Applies schema changes: starts embedded PG, runs `prisma migrate dev --name <name>`,
// generates the client, seeds, stops. Usage: node scripts/db-migrate.mjs <name>
import EmbeddedPostgres from 'embedded-postgres';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const dbDir = join(root, 'packages/db');
const name = process.argv[2] ?? 'change';
const pg = new EmbeddedPostgres({
  databaseDir: join(root, '.pgdata'),
  user: 'postgres',
  password: 'postgres',
  port: 5432,
  persistent: true,
  autoRehydrateSymlinks: true,
});
import { existsSync } from 'node:fs';
if (!existsSync(join(root, '.pgdata', 'PG_VERSION'))) {
  await pg.initialise();
}
await pg.start();
await pg.createDatabase('eventdesk').catch(() => {});
const env = {
  ...process.env,
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/eventdesk',
};
execSync(`pnpm exec prisma migrate dev --name ${name}`, { cwd: dbDir, env, stdio: 'inherit' });
execSync('pnpm exec prisma db seed', { cwd: dbDir, env, stdio: 'pipe' });
execSync('pnpm exec prisma generate', { cwd: dbDir, env, stdio: 'pipe' });
await pg.stop();
console.log('migration applied:', name);
process.exit(0);
