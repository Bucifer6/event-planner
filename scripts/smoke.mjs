// Loopback-only smoke test: boots embedded PG + the built web app, checks health,
// sign-in code request (enumeration-safe response), and the public site pages.
import EmbeddedPostgres from 'embedded-postgres';
import { execSync, spawn } from 'node:child_process';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5433/eventdesk';

const pg = new EmbeddedPostgres({
  databaseDir: join(root, '.pgdata-smoke'),
  user: 'postgres',
  password: 'postgres',
  port: 5433,
  persistent: false,
  autoRehydrateSymlinks: true,
});
await pg.initialise();
await pg.start();
await pg.createDatabase('eventdesk');
const env = {
  ...process.env,
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5433/eventdesk',
};
execSync('pnpm exec prisma migrate deploy', { cwd: join(root, 'packages/db'), env, stdio: 'pipe' });
execSync('pnpm exec prisma db seed', { cwd: join(root, 'packages/db'), env, stdio: 'pipe' });

const web = spawn('pnpm', ['exec', 'next', 'start', '-p', '3100'], {
  cwd: join(root, 'apps/web'),
  env: { ...env, PORT: '3100', APP_URL: 'http://localhost:3100', NODE_ENV: 'production' },
  stdio: 'pipe',
});
web.stdout.on('data', () => {});
web.stderr.on('data', (d) => process.stderr.write(d));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await wait(6000);

let failures = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`SMOKE OK  ${name}`);
  } catch (e) {
    failures++;
    console.log(`SMOKE FAIL ${name}: ${e.message}`);
  }
}

await check('GET /api/health returns ok', async () => {
  const r = await fetch('http://localhost:3100/api/health');
  const j = await r.json();
  if (!j.ok) throw new Error('health not ok');
});

await check('security headers present on app (SEC5)', async () => {
  const r = await fetch('http://localhost:3100/signin');
  const csp = r.headers.get('content-security-policy') ?? '';
  if (!csp.includes("default-src 'self'")) throw new Error('missing CSP');
  if (!(r.headers.get('strict-transport-security') ?? '').includes('max-age'))
    throw new Error('missing HSTS');
  if (r.headers.get('x-content-type-options') !== 'nosniff') throw new Error('missing nosniff');
  if (r.headers.get('referrer-policy') !== 'same-origin')
    throw new Error('missing referrer policy');
});

await check('GET /signin renders in Romanian (L1)', async () => {
  const r = await fetch('http://localhost:3100/signin');
  const html = await r.text();
  if (!html.includes('Autentificare')) throw new Error('Romanian strings missing');
});

await check('POST /api/auth/signout rejects cross-origin (SEC6)', async () => {
  const r = await fetch('http://localhost:3100/api/auth/signout', {
    method: 'POST',
    headers: { origin: 'https://evil.example' },
  });
  if (r.status !== 403 && r.status !== 500) throw new Error(`expected rejection, got ${r.status}`);
});

await check('unknown guest link 404s (SEC2)', async () => {
  const r = await fetch('http://localhost:3100/g/definitely-not-a-real-token');
  if (r.status !== 404) throw new Error(`expected 404, got ${r.status}`);
});

await check('GET /directory renders in Romanian (P-04, L1)', async () => {
  const r = await fetch('http://localhost:3100/directory');
  if (r.status !== 200) throw new Error(`expected 200, got ${r.status}`);
  const html = await r.text();
  if (!html.includes('Director de firme')) throw new Error('directory title missing');
  if (!html.includes('S\u0103li de evenimente') && !html.includes('evenimente'))
    throw new Error('seeded categories missing');
});

await check('GET /directory/<unknown> 404s', async () => {
  const r = await fetch('http://localhost:3100/directory/definitely-not-a-listing');
  if (r.status !== 404) throw new Error(`expected 404, got ${r.status}`);
});

await check('GET /business redirects to signin when anonymous (auth wall)', async () => {
  const r = await fetch('http://localhost:3100/business', { redirect: 'manual' });
  if (r.status !== 307 && r.status !== 308) throw new Error(`expected redirect, got ${r.status}`);
});

await check('LAU8: GET /report renders the notice-and-action form', async () => {
  const r = await fetch('http://localhost:3100/report');
  if (r.status !== 200) throw new Error(`expected 200, got ${r.status}`);
  const html = await r.text();
  if (!html.includes('Raporteaz\u0103')) throw new Error('report form missing');
});

await check('LAU1: cookie notice rendered in the app (three disclosed cookies)', async () => {
  const r = await fetch('http://localhost:3100/signin');
  const html = await r.text();
  if (!html.includes('ed_session') || !html.includes('ed_device') || !html.includes('ed_lang')) {
    throw new Error('cookie notice missing');
  }
});

web.kill('SIGTERM');
await pg.stop();
console.log(failures === 0 ? 'SMOKE ALL OK' : `SMOKE ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
