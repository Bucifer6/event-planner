// End-to-end user test (loopback only): boots embedded PG + migrations + seed, the built
// web app on :3100 and the built public site on :3101, then drives the critical journeys
// over real HTTP: public site (D1), anonymous app surfaces, a signed-in planner journey
// (occasion pages, offline QR check-in via API + reconcile, print pack), guest link and
// QR views, and negative paths (bad tokens, cross-origin sign-out, webhook without
// signature, MCP without token, unauthenticated upload).
import EmbeddedPostgres from 'embedded-postgres';
import { execSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const PORT_APP = 3100;
const PORT_PUB = 3101;
const DB_URL = 'postgresql://postgres:postgres@localhost:5434/eventdesk';
process.env.DATABASE_URL = DB_URL;

const pg = new EmbeddedPostgres({
  databaseDir: join(root, '.pgdata-e2e'),
  user: 'postgres',
  password: 'postgres',
  port: 5434,
  persistent: false,
  autoRehydrateSymlinks: true,
});
await pg.initialise();
await pg.start();
await pg.createDatabase('eventdesk');
const env = { ...process.env, DATABASE_URL: DB_URL };
execSync('pnpm exec prisma migrate deploy', { cwd: join(root, 'packages/db'), env, stdio: 'pipe' });
execSync('pnpm exec prisma db seed', { cwd: join(root, 'packages/db'), env, stdio: 'pipe' });
execSync('node scripts/e2e-seed.mjs', { cwd: join(root, 'packages/db'), env, stdio: 'pipe' });
const data = JSON.parse(await readFile('/tmp/e2e-data.json', 'utf8'));

const web = spawn('pnpm', ['exec', 'next', 'start', '-p', String(PORT_APP)], {
  cwd: join(root, 'apps/web'),
  env: {
    ...env,
    PORT: String(PORT_APP),
    APP_URL: `http://localhost:${PORT_APP}`,
    NODE_ENV: 'production',
  },
  stdio: 'pipe',
});
web.stderr.on('data', (d) => process.stderr.write(d));

// tiny static server for the public site build output
const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};
const pub = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const body = await readFile(join(root, 'apps/public/out', p));
    res.writeHead(200, { 'content-type': MIME[extname(p)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('nf');
  }
});
await new Promise((r) => pub.listen(PORT_PUB, r));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await wait(7000);

let failures = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`E2E OK   ${name}`);
  } catch (e) {
    failures++;
    console.log(`E2E FAIL ${name}: ${e.message}`);
  }
}
const app = `http://localhost:${PORT_APP}`;
const pubBase = `http://localhost:${PORT_PUB}`;
const cookie = `ed_session=${data.sessionToken}`;
const asUser = (extra = {}) => ({ cookie, ...extra });

// ---- A. public site ----
for (const p of [
  '/',
  '/legal/terms/',
  '/legal/privacy/',
  '/legal/cookies/',
  '/legal/accessibility/',
  '/status/',
  '/for-businesses/',
]) {
  await check(`public ${p} 200, no set-cookie, no third-party script`, async () => {
    const r = await fetch(pubBase + p);
    if (r.status !== 200) throw new Error(`status ${r.status}`);
    if (r.headers.get('set-cookie')) throw new Error('set-cookie on public site (D1)');
    const html = await r.text();
    if (/<script[^>]+src="https?:\/\//i.test(html)) throw new Error('third-party script (D1)');
  });
}
await check('public landing links the DSA report route', async () => {
  const html = await (await fetch(pubBase + '/')).text();
  if (!html.includes('/report')) throw new Error('no /report link');
});

// ---- B. anonymous app surfaces + negative paths ----
await check('GET /api/health ok', async () => {
  const j = await (await fetch(`${app}/api/health`)).json();
  if (!j.ok) throw new Error('not ok');
});
await check('SEC5 headers on /', async () => {
  const r = await fetch(`${app}/`);
  if (!(r.headers.get('content-security-policy') ?? '').includes("default-src 'self'"))
    throw new Error('CSP');
  if (r.headers.get('x-content-type-options') !== 'nosniff') throw new Error('nosniff');
});
await check('GET /signin 200 Romanian', async () => {
  const html = await (await fetch(`${app}/signin`)).text();
  if (!html.includes('Autentificare')) throw new Error('ro strings missing');
});
await check('GET /g/<bad token> 404 (SEC2)', async () => {
  const r = await fetch(`${app}/g/nope-nope-nope`);
  if (r.status !== 404) throw new Error(`status ${r.status}`);
});
await check('GET /console redirects anonymous to console signin', async () => {
  const r = await fetch(`${app}/console`, { redirect: 'manual' });
  if (r.status !== 307 && r.status !== 308) throw new Error(`status ${r.status}`);
  if (!(r.headers.get('location') ?? '').includes('/console/signin'))
    throw new Error('wrong redirect');
});
await check('MCP endpoint without Bearer rejected (JSON-RPC -32001)', async () => {
  const r = await fetch(`${app}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  const j = await r.json();
  if (!String(j?.error?.message ?? '').includes('Bearer token required')) {
    throw new Error(`not rejected: ${JSON.stringify(j).slice(0, 120)}`);
  }
});
await check('uploads without session rejected', async () => {
  const r = await fetch(`${app}/api/uploads`, { method: 'POST' });
  if (r.status === 200) throw new Error('upload allowed anonymously');
});
await check('stripe webhook without signature rejected (400/401)', async () => {
  const r = await fetch(`${app}/api/webhooks/stripe`, { method: 'POST', body: '{}' });
  if (r.status !== 401 && r.status !== 400) throw new Error(`status ${r.status}`);
});
await check('cross-origin sign-out rejected (SEC6)', async () => {
  const r = await fetch(`${app}/api/auth/signout`, {
    method: 'POST',
    headers: { origin: 'https://evil.example' },
  });
  if (r.status !== 403 && r.status !== 500) throw new Error(`status ${r.status}`);
});
await check('GET /report 200 (LAU8)', async () => {
  const r = await fetch(`${app}/report`);
  if (r.status !== 200) throw new Error(`status ${r.status}`);
});
await check('offline API without session rejected', async () => {
  const r = await fetch(`${app}/api/occasions/${data.occasionId}/offline`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ clientKey: 'x', kind: 'arrival', payload: {} }),
  });
  if (r.status === 200 || r.status === 201) throw new Error(`status ${r.status}`);
});

// ---- C. signed-in planner journey ----
await check('GET /dashboard 200 as signed-in user', async () => {
  const r = await fetch(`${app}/dashboard`, { headers: asUser() });
  if (r.status !== 200) throw new Error(`status ${r.status}`);
  const html = await r.text();
  if (!html.includes('E2E Nunta')) throw new Error('occasion not listed');
});
for (const sub of ['', '/tasks', '/guests', '/eventday', '/operate', '/travel', '/programme']) {
  await check(`GET /occasions/[id]${sub} 200`, async () => {
    const r = await fetch(`${app}/occasions/${data.occasionId}${sub}`, { headers: asUser() });
    if (r.status !== 200) throw new Error(`status ${r.status}`);
  });
}
await check('operate page shows rehearsal simulation of the programme item', async () => {
  const html = await (
    await fetch(`${app}/occasions/${data.occasionId}/operate`, { headers: asUser() })
  ).text();
  if (!html.includes('Cununie civila')) throw new Error('programme step missing from simulation');
});
await check(
  'offline API: queue QR arrival (201), list pending, reconcile applies once',
  async () => {
    const post = async (body) =>
      fetch(`${app}/api/occasions/${data.occasionId}/offline`, {
        method: 'POST',
        headers: { ...asUser(), 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    const q = await post({ clientKey: 'e2e-1', kind: 'arrival', payload: { qrId: data.qrId } });
    if (q.status !== 201) throw new Error(`queue status ${q.status}`);
    const q2 = await post({ clientKey: 'e2e-1', kind: 'arrival', payload: { qrId: data.qrId } });
    const j2 = await q2.json();
    const list1 = await (
      await fetch(`${app}/api/occasions/${data.occasionId}/offline`, { headers: asUser() })
    ).json();
    if (list1.items.length !== 1)
      throw new Error(`clientKey not idempotent: ${list1.items.length} items`);
    const rec = await post({ reconcile: true });
    const recJ = await rec.json();
    if (recJ.reconciled.applied.length !== 1) throw new Error('reconcile did not apply');
    const rec2 = await (await post({ reconcile: true })).json();
    if (rec2.reconciled.applied.length !== 0) throw new Error('second reconcile not a no-op (Q4)');
    const list2 = await (
      await fetch(`${app}/api/occasions/${data.occasionId}/offline`, { headers: asUser() })
    ).json();
    if (list2.items[0].state !== 'applied') throw new Error(`state ${list2.items[0].state}`);
    void j2;
  }
);
await check('offline API rejects unknown kind (400)', async () => {
  const r = await fetch(`${app}/api/occasions/${data.occasionId}/offline`, {
    method: 'POST',
    headers: { ...asUser(), 'content-type': 'application/json' },
    body: JSON.stringify({ clientKey: 'e2e-bad', kind: 'delete_everything', payload: {} }),
  });
  if (r.status !== 400) throw new Error(`status ${r.status}`);
});
await check('operate page lists the checked-in household after reconcile', async () => {
  const html = await (
    await fetch(`${app}/occasions/${data.occasionId}/operate`, { headers: asUser() })
  ).text();
  if (!html.includes('E2E Familia')) throw new Error('arrival not visible on operate page');
});
await check('print pack PDF served to member (C-09)', async () => {
  const r = await fetch(`${app}/api/occasions/${data.occasionId}/print-pack`, {
    headers: asUser(),
  });
  if (r.status !== 200) throw new Error(`status ${r.status}`);
  if ((r.headers.get('content-type') ?? '') !== 'application/pdf') throw new Error('not a PDF');
});
await check('print pack rejected anonymously', async () => {
  const r = await fetch(`${app}/api/occasions/${data.occasionId}/print-pack`);
  if (r.status === 200) throw new Error('print pack leaked anonymously');
});

// ---- D. guest-facing views ----
await check('guest link /g/<token> shows own household only (SEC2)', async () => {
  const r = await fetch(`${app}/g/${data.invitationToken}`);
  if (r.status !== 200) throw new Error(`status ${r.status}`);
  const html = await r.text();
  if (!html.includes('E2E Familia')) throw new Error('household missing');
});
await check('public event page /e/<slug> shows the programme (C-06/C-10)', async () => {
  const r = await fetch(`${app}/e/${data.publicSlug}`);
  if (r.status !== 200) throw new Error(`status ${r.status}`);
  const html = await r.text();
  if (!html.includes('Cununie civila')) throw new Error('programme missing on public event page');
});
await check('guest QR /g/q/<qrId> 200 (C-09)', async () => {
  const r = await fetch(`${app}/g/q/${data.qrId}`);
  if (r.status !== 200) throw new Error(`status ${r.status}`);
});
await check('guest QR unknown id 404', async () => {
  const r = await fetch(`${app}/g/q/does-not-exist`);
  if (r.status !== 404) throw new Error(`status ${r.status}`);
});

web.kill('SIGTERM');
pub.close();
await pg.stop();
console.log(failures === 0 ? 'E2E ALL OK' : `E2E ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
