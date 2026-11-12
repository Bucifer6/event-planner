// Integration-test database: spins up an embedded PostgreSQL on an ephemeral port,
// applies all migrations and the seed, and points DATABASE_URL at it.
// Used by vitest globalSetup (see packages/core/vitest.config.ts).
import EmbeddedPostgres from 'embedded-postgres';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

export async function setupTestDatabase(): Promise<{ url: string; stop: () => Promise<void> }> {
  const root = join(__dirname, '..');
  const dataDir = mkdtempSync(join(tmpdir(), 'eventdesk-test-pg-'));
  const port = 55_000 + Math.floor(Math.random() * 5_000);
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'postgres',
    password: 'postgres',
    port,
    persistent: false,
    autoRehydrateSymlinks: true,
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase('eventdesk_test');
  const url = `postgresql://postgres:postgres@localhost:${port}/eventdesk_test`;
  const env = { ...process.env, DATABASE_URL: url };
  execSync('pnpm exec prisma migrate deploy', { cwd: root, env, stdio: 'pipe' });
  execSync('pnpm exec prisma db seed', { cwd: root, env, stdio: 'pipe' });
  execSync('pnpm exec prisma generate', { cwd: root, env, stdio: 'pipe' });
  process.env.DATABASE_URL = url;
  return {
    url,
    stop: async () => {
      await pg.stop();
    },
  };
}
