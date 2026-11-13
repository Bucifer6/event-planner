# EventDesk.ro

EventDesk.ro is a free, Romanian-first planning app for private events — weddings, baptisms,
anniversaries, holidays. A host plans the occasion on a phone (tasks, guests and RSVP by
link, budget, suppliers, the event-day run sheet); guests answer through a private link
without an account; businesses list themselves in an honest directory; staff run the
platform from a console that requires a second person for anything irreversible. All data
is hosted in the EU. The product requirements are in `docs/PRD.md` (it wins over everything
else); the build plan is in `docs/build/`.

## What is in this repository

```
apps/
  web/        the app (app.eventdesk.ro): Next.js, Server Actions, /console, /mcp
  public/     the public site (eventdesk.ro): static pages, no cookies, no third-party scripts
  worker/     the single background worker: email, digests, retention, backups, statistics
packages/
  db/         PostgreSQL schema (Drizzle), migrations, seed data, test harness
  core/       every business rule and every access check (web, worker and MCP only call this)
  auth/       sign-in codes, sessions, two-step sign-in
  i18n/       all user-facing text, Romanian and English
  ui/         the "Maison" design system
  email/  storage/  jobs/  mcp/  shared/
infra/
  terraform/               infrastructure as code (reference stack; NOT applied)
  reference-docker-host/   the reference deploy target
  docker/                  files used by the container images
scripts/      CI gates, deploy scripts, the staff bootstrap
.github/workflows/   ci.yml, release.yml, deploy.yml
docs/         PRD.md and the build plan (docs/build/)
```

Stack: Node 22, pnpm, TypeScript, Next.js 16, PostgreSQL 16, one web service and one worker.

## Running it on your own computer

You need three programs installed first:

- **Node.js 22** (22.12 or newer) — <https://nodejs.org>
- **pnpm 10** — after installing Node, run `corepack enable` once
- **Docker Desktop** (or Docker Engine) — it runs the database for you

Then, in a terminal opened in this folder:

1. **Install the code's dependencies**

   ```sh
   pnpm install
   ```

2. **Start the local services** (PostgreSQL, plus an object store and a mail catcher you can
   ignore at first)

   ```sh
   docker compose -f docker-compose.dev.yml up -d
   ```

3. **Create your settings file.** Copy `.env.example` to `.env`, then open `.env` and set
   `SESSION_SECRET` to any random text of 32 characters or more. Everything else already
   has a working local value. To generate one:

   ```sh
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

4. **Create the database tables and the starting data**

   ```sh
   pnpm db:push && pnpm db:seed
   ```

5. **Start the three programs**, each in its own terminal window:

   ```sh
   pnpm dev:web       # the app          → http://localhost:3000
   pnpm dev:public    # the public site  → http://localhost:3001
   pnpm dev:worker    # the background worker (no web page)
   ```

6. **Sign in.** Open <http://localhost:3000>, type any email address and ask for a code. On
   your computer no email is really sent: the message is kept in the database. Read the
   code with:

   ```sh
   docker compose -f docker-compose.dev.yml exec postgres \
     psql -U ed -d eventdesk_dev -c "select body_text from email_outbox order by created_at desc limit 1"
   ```

   (Or use "Folosește un cont anonim" on the sign-in page, which needs no email.)

7. **Open the staff console (optional).** The console is for platform staff. To make your
   account the first staff member:

   ```sh
   node scripts/make-staff.mjs you@example.ro platform_admin,security_administrator
   ```

   Then, in the app: turn on two-step sign-in under *Cont → Verificare în doi pași*, sign
   out, sign in again with the second step, and open <http://localhost:3000/console>.
   With only one staff member the console is in *single-operator mode*: actions that need
   a second person wait in the queue and do nothing. Run the script again for a second
   account to try approvals (and a third to try compliance access, which needs three people).

To stop: `Ctrl+C` in each terminal, then `docker compose -f docker-compose.dev.yml down`.
Add `-v` to that last command to erase the local database as well.

## Tests and checks

| Command | What it does |
| --- | --- |
| `pnpm lint` | code style |
| `pnpm typecheck` | type checks every package and app |
| `pnpm test` | unit and integration tests (needs the local PostgreSQL running) |
| `pnpm exec vitest run packages/core/test/deploys.test.ts` | one test file |
| `pnpm --filter @ed/i18n test` | Romanian and English texts have the same keys |
| `pnpm build` | builds the app and the public site, then checks the public site loads nothing from another origin and sets no cookie (D1) |
| `node scripts/check-headers.mjs` | boots the built app and asserts the security headers (strict CSP with a nonce, HSTS, nosniff…) |
| `node scripts/smoke.mjs` | boots the built app and walks the signed-out journey over HTTP |
| `pnpm audit --audit-level=high` | fails on a dependency with a high or critical advisory |

CI (`.github/workflows/ci.yml`) runs all of these, in this order, on every pull request and
on `main`.

## How changes get in: branches, pull requests, tags

- `main` is protected. Nobody pushes to it directly and nobody force-pushes it.
- One work item = one branch named `feat/<work-item-id>-<short-slug>`, cut from `main`.
- Open a pull request to `main` with the checklist from `docs/build/README.md` in its body
  (acceptance criteria, CI green, both languages, 320 px and AA contrast, security
  checklist, no secrets, idempotent mutations, PRD requirement ids). Merge only after a
  review and green CI.
- A **release** is an annotated tag `vX.Y.Z` on a commit of `main`:

  ```sh
  git tag -a v1.4.0 -m "Release 1.4.0" && git push origin v1.4.0
  ```

  Pushing the tag runs the full CI on that exact commit (`release.yml`) and records the
  result on the commit as the status `release-ci`. Only a tag with a green `release-ci` can
  be deployed. Release tags are never moved or deleted.
- A migration that older code cannot live with must be listed in
  `scripts/deploy/irreversible.txt` in the same pull request (it makes rollbacks stop instead
  of guessing).

## Deploying

Production is updated **from the staff console, never from a terminal and never by a push**:

1. In `/console/deploys` a platform admin or security administrator picks a release tag,
   reads the commits since the live release, and requests the deployment.
2. A second staff member approves it in `/console/approvals`.
3. The console starts the deploy workflow through a GitHub App. The workflow takes an
   encrypted database backup, runs the migrations, switches the release, and checks its
   health for five minutes; if the checks fail it puts the previous release back and the
   console shows why.
4. Every step, with who asked and who approved, is in the deploy history and the audit log.

An emergency security fix can be deployed by one security administrator alone; it is marked
as an emergency in the audit log. One person can roll back to the previous release.

The full procedure, what the operator must configure first, the restore procedure and the
launch-day runbook are in **[`docs/build/14-deploy-runbook.md`](docs/build/14-deploy-runbook.md)**.
The infrastructure description is in [`infra/terraform/README.md`](infra/terraform/README.md)
— it is a reference and **has not been applied**.

## Decisions that are still open (operator)

The code deliberately does not guess these; each is a setting with a placeholder. The full
list is in **[`docs/build/10-operator-decisions.md`](docs/build/10-operator-decisions.md)**.
The ones that block a first production deployment:

- **Hosting vendor and region** for the app, the database and the object store — EU,
  Romania preferred (INF9). The Terraform and the deploy target in this repo are a reference.
- **Secret store product** (SEC13) and who holds the **backup decryption key** (SEC9).
- **Transactional email provider** with EU delivery, and SPF/DKIM/DMARC on the sending
  domain (INF2, LAU3).
- **Malware scanner** for uploads (SEC4) — production refuses to accept uploads without one.
- **Container registry**, and **how the deploy runner reaches the host**.
- **The GitHub organisation and private repository**, and the GitHub App that connects the
  console to it (DEP1).
- **The second and third staff person.** Approvals need two people (W9); compliance access
  needs three (W8). A solo launch is out of scope by design.
- **Alert channel** that someone actually watches (LAU5).

## Launch obligations (not software — the operator's gates)

These are tracked in the console under *Lansare* (`/console/launch`), each with an owner:

| | Obligation |
| --- | --- |
| LAU1 | Terms, privacy policy and cookie notice published before the first signup |
| LAU2 | ANSPDCP formalities; DPIA for discovery, guest household data and MCP |
| LAU3 | Email domain authenticated and warmed up before real sign-in codes are sent |
| LAU4 | External penetration test before the first guest link goes out |
| LAU5 | Monitoring, alerts to a watched channel, restore procedure with RTO 4 h / RPO 24 h |
| LAU6 | Written business terms quoting the Featured rules |
| LAU7 | Launch-day runbook; at least two people on call |
| LAU8 | DSA notice-and-action contact point and ANCOM registration |
| LAU9 | Accessibility statement |

## More documentation

`docs/build/README.md` (how the build is organised) · `15-conventions.md` (binding code
conventions) · `18-contracts.md` (what each package offers) · `12-security-review.md` ·
`11-testing-and-qa.md`.
