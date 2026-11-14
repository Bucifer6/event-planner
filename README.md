# EventDesk.ro

**What this is, in plain English.** EventDesk.ro is a free, Romanian-first planning app for
private events — weddings, baptisms, anniversaries, holidays. A host plans the occasion on a
phone (tasks, guests and replies by link, budget, suppliers, the event-day run sheet); guests
answer through a private link without an account; businesses list themselves in an honest
directory; staff run the platform from a console that requires a second person for anything
irreversible. All data is meant to be hosted in the EU.

This file tells you what is in the repository, how to run it on your own computer, how to
check it, and where every other document is. The product requirements are in
[`docs/PRD.md`](docs/PRD.md) — when anything disagrees with it, the PRD wins.

## Current status (14 November 2026)

- **Built:** all seven releases of the PRD (0, A, B, P, C, D, E). The status page is
  [`docs/build/13-implementation-log.md`](docs/build/13-implementation-log.md); the
  requirement-by-requirement verdict is
  [`docs/build/09-traceability.md`](docs/build/09-traceability.md).
- **Checked on the build machine:** type checks, lint, the automated tests (69 test files,
  724 tests at the last full run), the two production builds, the public-site privacy gate,
  the security-header check and the HTTP smoke test.
- **Not verified anywhere yet:** the GitHub workflows, the container images, the Terraform
  description and the deploy scripts have never run; there is no browser-driven test suite,
  no accessibility audit, no load test and no test on real phones; nothing has been deployed.
- **Not built or only a seam:** passkeys (two-step sign-in is authenticator-app only); a
  screen for a business to create an assistant token scoped to the business; live adapters
  for the email provider, malware scanner, Stripe, the fiscal-invoicing provider, the ONRC
  data source and the AI text provider (each is a documented plug-in point with a
  development stand-in). Monetisation is switched **off**.
- **Needs people, not code:** the launch obligations LAU1–LAU9 and the PRD gates M0–M5.

## What is in this repository

```
apps/
  web/        the app (app.eventdesk.ro): Next.js, Server Actions, /console, /mcp, guest links
  public/     the public site (eventdesk.ro): static pages, no cookies, no third-party scripts
  worker/     the single background worker: email, digests, retention, backups, statistics
packages/
  db/         PostgreSQL schema (Drizzle ORM), the migration, SQL guards, seed data, test harness
  core/       every business rule and every access check (web, worker and MCP only call this)
  auth/       sign-in codes and links, anonymous accounts, sessions, two-step sign-in
  i18n/       all user-facing text, Romanian and English (75 namespaces each: 61 for the product, 14 for the help centre)
  ui/         the "Maison" design system (components, tokens, fonts)
  email/      email templates, the send pipeline, the suppression list
  storage/    uploads: type check, image re-encoding, malware-scan gate, fair-use counters
  jobs/       the job queue, schedules and the registry of background jobs
  mcp/        the endpoint for external AI assistants and its 23 tools
  shared/     ids, money, time, validation helpers, the SSRF guard, environment checks
infra/
  terraform/               infrastructure as code (reference stack; NOT applied)
  reference-docker-host/   the one implemented deploy target (a Docker host over SSH)
  docker/                  files used by the container images
scripts/      CI gates (headers, smoke, public-site check), deploy scripts, the staff bootstrap
.github/workflows/   ci.yml, release.yml, deploy.yml
docs/         PRD.md and the build documentation (docs/build/)
```

Stack: Node 22, pnpm 10, TypeScript 5.9, Next.js 16 (React 19), Drizzle ORM on PostgreSQL 16,
Vitest. One web service and one worker (PRD Q7).

## Running it on your own computer

You need three programs installed first:

- **Node.js 22** (22.12 or newer) — <https://nodejs.org>
- **pnpm 10** — after installing Node, run `corepack enable` once
- **Docker Desktop** (or Docker Engine) — it runs the database for you. If you already have
  PostgreSQL 16 installed locally you can use that instead: create a role `ed` with password
  `ed` that may create databases, and a database `eventdesk_dev`.

Then, in a terminal opened in this folder:

1. **Install the code's dependencies**

   ```sh
   pnpm install
   ```

2. **Start the local services** (PostgreSQL, plus an object store and a mail catcher that the
   default settings do not use — you can ignore them)

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
   pnpm db:migrate && pnpm db:seed
   ```

   `db:migrate` applies the committed migration (`packages/db/drizzle/`, 167 tables) and then
   the database guards (`packages/db/src/sql/`). It is the same command production uses. The
   seed adds the 21 directory categories, the counties and localities, the planning templates
   and the monetisation switch in its OFF state; it is safe to run again.

   *When is `pnpm db:push` used instead?* Only by a developer who has just changed the schema
   files and has not generated a migration yet: it copies the schema straight into a local
   database. Never use it on a real server.

5. **Start the three programs**, each in its own terminal window:

   ```sh
   pnpm dev:web       # the app          → http://localhost:3000
   pnpm dev:public    # the public site  → http://localhost:3001
   pnpm dev:worker    # the background worker (no web page)
   ```

6. **Sign in.** Open <http://localhost:3000>, type any email address and ask for a code. On
   your computer no email is really sent (`EMAIL_PROVIDER=dev`): the message is kept in the
   database. Read the code with:

   ```sh
   docker compose -f docker-compose.dev.yml exec postgres \
     psql -U ed -d eventdesk_dev -c "select body_text from email_outbox order by created_at desc limit 1"
   ```

   (Or use "Folosește un cont anonim" on the sign-in page, which needs no email.)

   **Why you can create an account straight away here, and not on a real server.** New
   accounts may only be created once the terms, the privacy policy and the cookie notice are
   recorded as published (console → *Lansare* → legal documents; launch obligation LAU1).
   On your own computer this rule is relaxed: while nothing has been recorded there yet
   **and** `APP_URL` points at `localhost`, sign-up is open, so a fresh setup is not blocked.
   On any real address — or as soon as you record anything in that console form — the rule
   applies: until all three documents have a version and a publication date that is not in
   the future, the sign-in page says "Înregistrările se deschid în curând" and only people
   who already have an account can sign in.

7. **Open the staff console (optional).** The console is for platform staff. To make your
   account the first staff member (the account must already exist — sign in once first):

   ```sh
   node scripts/make-staff.mjs you@example.ro platform_admin,security_administrator
   ```

   Then, in the app: turn on two-step sign-in under *Cont → Verificare în doi pași*
   (<http://localhost:3000/account/security>; you need an authenticator app on your phone),
   sign out, sign in again with the second step, and open <http://localhost:3000/console>.
   Until two-step is on, the console shows a short page explaining what to do.
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
| `pnpm audit --audit-level=high` | fails on a dependency with a high or critical advisory |
| `node scripts/check-headers.mjs` | boots the built app and asserts the security headers (strict CSP with a nonce, HSTS, nosniff…). Needs `pnpm build` first and a migrated database |
| `node scripts/smoke.mjs` | boots the built app and walks the signed-out journey over HTTP. Same needs |

CI (`.github/workflows/ci.yml`) runs lint, type checks, tests, both builds, the public-site
gate, the dependency audit, then prepares a database and runs the header check and the smoke
test — on every pull request and on `main`. **The workflow has never run on GitHub**; each
step was run by hand on the build machine.

What is tested and — just as important — what is not is in
[`docs/build/11-testing-and-qa.md`](docs/build/11-testing-and-qa.md), together with a manual
checklist a non-developer can follow in the running app.

## How changes get in: branches, pull requests, tags

- `main` is protected. Nobody pushes to it directly and nobody force-pushes it.
- One piece of work = one branch named `feat/<work-item-id>-<short-slug>`, cut from `main`.
- Open a pull request to `main` with the checklist from [`CONTRIBUTING.md`](CONTRIBUTING.md).
  Merge only after a review and green CI.
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

These protections are settings on GitHub that the operator must switch on; the repository
cannot enforce them by itself (see the runbook, section 4.1).

## Deploying

Production is updated **from the staff console, never from a terminal and never by a push**:

1. In `/console/deploys` a platform admin or security administrator picks a release tag,
   reads the commits since the live release, and requests the deployment.
2. A second staff member approves it in `/console/approvals`.
3. The console starts the deploy workflow through a GitHub App. The workflow builds the
   images, takes an encrypted database backup, runs the migrations, switches the release, and
   checks its health for up to five minutes; if the checks fail it puts the previous release
   back and the console shows why.
4. Every step, with who asked and who approved, is in the deploy history and the audit log.

An emergency security fix can be deployed by one security administrator alone; it is marked
as an emergency in the audit log. One person can roll back to the previous release.

The full procedure, what the operator must configure first, the restore procedure and the
launch-day runbook are in
**[`docs/build/14-deploy-runbook.md`](docs/build/14-deploy-runbook.md)**. The infrastructure
description is in [`infra/terraform/README.md`](infra/terraform/README.md) — it is a
reference and **has not been applied**. None of this has been exercised against a real host.

## Decisions that are still open (operator)

The code deliberately does not guess these; each is a setting with a placeholder. The full
list, with the exact setting that carries each decision, is in
**[`docs/build/10-operator-decisions.md`](docs/build/10-operator-decisions.md)**.
The ones that block a first production deployment:

- **Hosting vendor and region** for the app, the database and the object store — EU,
  Romania preferred (INF9). The Terraform and the deploy target in this repo are a reference.
- **Secret store product** (SEC13) and who holds the **backup decryption key** (SEC9).
- **Transactional email provider** with EU delivery, and SPF/DKIM/DMARC on the sending
  domain (INF2, LAU3). The code has a generic HTTP plug-in point, not a vendor integration.
- **Malware scanner** for uploads (SEC4) — production refuses to accept uploads without one.
- **Container registry**, and **how the deploy runner reaches the host**.
- **The GitHub organisation and private repository**, and the GitHub App that connects the
  console to it (DEP1).
- **The second and third staff person.** Approvals need two people (W9); compliance access
  needs three (W8). A solo launch is out of scope by design.
- **Alert channel** that someone actually watches (LAU5).
- **A contact address for security reports** ([`SECURITY.md`](SECURITY.md) has a placeholder).

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

## All the documentation

| Document | What it is for |
| --- | --- |
| [`docs/PRD.md`](docs/PRD.md) | The product requirements. Wins over everything else |
| [`docs/build/README.md`](docs/build/README.md) | Index of the build documentation and the twelve rules the product must never break |
| [`docs/build/01-architecture.md`](docs/build/01-architecture.md) | How the system is put together, as built |
| [`docs/build/02-data-model.md`](docs/build/02-data-model.md) | Every database table, the database guards, and what is kept or deleted when |
| [`docs/build/03-cross-cutting.md`](docs/build/03-cross-cutting.md) | Sign-in, links, limits, uploads, email, payments, language, accessibility — as implemented |
| [`docs/build/04-foundation-release-0.md`](docs/build/04-foundation-release-0.md) | Original work items for Release 0 (the record of scope) |
| [`docs/build/05-release-A.md`](docs/build/05-release-A.md) | Original work items for Release A |
| [`docs/build/06-release-B.md`](docs/build/06-release-B.md) | Original work items for Release B |
| [`docs/build/07-release-P.md`](docs/build/07-release-P.md) | Original work items for Release P |
| [`docs/build/08-releases-C-D-E.md`](docs/build/08-releases-C-D-E.md) | Original work items for Releases C, D and E |
| [`docs/build/09-traceability.md`](docs/build/09-traceability.md) | Every PRD requirement: built or not, where it lives, which test covers it |
| [`docs/build/10-operator-decisions.md`](docs/build/10-operator-decisions.md) | Every decision left to the operator and the setting that carries it |
| [`docs/build/11-testing-and-qa.md`](docs/build/11-testing-and-qa.md) | What is tested, what is not, and a manual checklist per release |
| [`docs/build/12-security-review.md`](docs/build/12-security-review.md) | The security review: scope, checklist, severity scale and findings (maintained by the security review itself) |
| [`docs/build/13-implementation-log.md`](docs/build/13-implementation-log.md) | The status page: what is built and what has been verified |
| [`docs/build/14-deploy-runbook.md`](docs/build/14-deploy-runbook.md) | Deploying, rolling back, backups and restore, launch day |
| [`docs/build/15-conventions.md`](docs/build/15-conventions.md) | Binding code conventions |
| [`docs/build/16-design.md`](docs/build/16-design.md) | The "Maison" design language |
| [`docs/build/17-ui-rules.md`](docs/build/17-ui-rules.md) | The checklist every screen is built to |
| [`docs/build/18-contracts.md`](docs/build/18-contracts.md) | Reference of what each package offers to the others |
| [`docs/build/19-operations.md`](docs/build/19-operations.md) | Day-to-day guide for the people running the platform |
| [`docs/build/20-glossary.md`](docs/build/20-glossary.md) | Product and code terms in plain English, with the Romanian term used on screen |
| [`CHANGELOG.md`](CHANGELOG.md) | What changed, by release |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | How to make a change: branches, checks, definition of done |
| [`SECURITY.md`](SECURITY.md) | How to report a security problem |
| [`infra/terraform/README.md`](infra/terraform/README.md) | The reference infrastructure description (not applied) |
| [`infra/reference-docker-host/README.md`](infra/reference-docker-host/README.md) | The reference deploy target |

## Licences of bundled fonts

- **Bodoni Moda** and **Hanken Grotesk** (the two typefaces of the interface) are shipped as
  `.woff2` files in `packages/ui/fonts/`. Both are under the SIL Open Font License 1.1; the
  licence texts are beside them: `LICENSE-bodoni-moda.txt`, `LICENSE-hanken-grotesk.txt`.
  The same two families are also installed as `.ttf` files through the npm packages
  `@expo-google-fonts/bodoni-moda` and `@expo-google-fonts/hanken-grotesk`, which the
  stationery PDFs use.
- **DejaVu** (used in generated PDFs such as the supplier briefing, and as the fallback for
  stationery) is not stored in this repository: it comes from the npm package
  `dejavu-fonts-ttf`, which carries its own `LICENSE` file (the DejaVu Fonts licence, a
  permissive licence derived from Bitstream Vera). The web container image copies those
  `.ttf` files to `/app/fonts`. There is no copy of the DejaVu licence text under
  `packages/ui/fonts/`; if the fonts are redistributed outside npm, include it.

The application code itself has no licence file in this repository: choosing one is the
owner's decision.
