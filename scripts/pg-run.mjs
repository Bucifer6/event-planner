import EmbeddedPostgres from 'embedded-postgres';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
const root = '/workspace/github__Bucifer6__event-planner';
const pg = new EmbeddedPostgres({
  databaseDir: join(root, '.pgdata'),
  user: 'postgres',
  password: 'postgres',
  port: 5432,
  persistent: true,
  autoRehydrateSymlinks: true,
});
if (!existsSync(join(root, '.pgdata', 'PG_VERSION'))) await pg.initialise();
await pg.start();
await pg.createDatabase('eventdesk').catch(() => {});
const env = {
  ...process.env,
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/eventdesk',
};
try {
  execSync('pnpm exec prisma migrate dev --name release_b', {
    cwd: join(root, 'packages/db'),
    env,
    stdio: 'inherit',
  });
  console.log('MIGRATE_OK');
} catch (e) {
  console.log('MIGRATE_FAIL', e.status);
}
await pg.stop();
process.exit(0);
