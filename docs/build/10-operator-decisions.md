# 10 — Operator decisions, and the setting that carries each

**What this is, in plain English.** Some choices are not the builder's to make: which company
hosts the servers, who delivers the email, what the prices are, who the second staff member
is. The code does not guess any of them. Each is a setting with a placeholder. This file lists
every such decision, the exact setting that holds it, what it is set to today, and where the
code reads it — so that when you decide, you know precisely what to change.

There are two kinds of setting:

- **Environment variables** — values given to the programs when they start. Locally they live
  in the `.env` file; on a server they live in the secret store. Every name is in
  `.env.example` with a one-line explanation. Changing one needs a restart.
- **Console settings** — values a staff member edits in the console; they are stored in the
  `platform_settings` table and take effect at once. Some need a second person's approval.

Nothing in this file has been decided on the operator's behalf. Where a default exists it is
a placeholder that works on a developer machine.

## Hosting and infrastructure

| Decision (PRD) | Setting | Placeholder / default | Read in |
| --- | --- | --- | --- |
| Hosting vendor and region — EU, Romania preferred (INF9) | None in the app. `infra/terraform/variables.tf` and `*.tfvars.example`; the deploy target `DEPLOY_TARGET` | Reference only: `ssh-docker`; Terraform not applied | `scripts/deploy/lib.sh`, `.github/workflows/deploy.yml` |
| The three public addresses (INF1) | `APP_URL`, `PUBLIC_URL`, `MEDIA_URL`; at build time `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SITE_URL` | `http://localhost:3000`, `:3001`, `:3002` | `packages/shared/src/env.ts`; `apps/public` build |
| Database (INF9, INF12) | `DATABASE_URL` | Local `eventdesk_dev` | `packages/db/src/client.ts` |
| Secret store product (SEC13) | None — it only has to deliver environment variables | — | `infra/reference-docker-host/README.md` (`render-env`) |
| Session signing secret | `SESSION_SECRET` (32+ characters); optional `STORAGE_URL_SECRET` for file links | Empty — you must set it | `packages/shared/src/env.ts`, `packages/storage/src/sign.ts` |
| Which request header carries the visitor's address | `TRUSTED_IP_HEADER` | `x-forwarded-for` | `apps/web/lib/ctx.ts` and the guest, supplier, public-page and MCP entry points |
| Object store endpoint, region, buckets, encryption key (INF3, INF12) | `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET_PRIVATE`, `S3_BUCKET_MEDIA`, `S3_FORCE_PATH_STYLE`, `S3_SSE_KMS_KEY_ID`; or `STORAGE_DIR` for a local folder | Unset: files go to a local folder | `packages/storage/src/transport.ts` |
| Malware scanner (SEC4) | `MALWARE_SCANNER` (`none`, `command`, `http`) with `MALWARE_SCANNER_COMMAND` or `MALWARE_SCANNER_URL` | `none` — **production then refuses uploads** | `packages/storage/src/scan.ts` |
| PDF tooling for venue drawings | `PDF_RASTERISER_BIN` | `pdftoppm` (poppler; installed in the web image). Without it PDF drawings cannot be calibrated | `packages/core/src/drawings.ts` |
| Fonts for generated PDFs | `PDF_FONT_DIR` (DejaVu, set by the web image to `/app/fonts`); `STATIONERY_FONT_DIR` (Bodoni Moda and Hanken Grotesk `.ttf` for stationery) | Looked up in `node_modules`; stationery falls back to DejaVu. **Whether the stationery fonts are present in the container image has not been checked** | `packages/core/src/briefingpdf.ts`, `stationerykit.ts` |
| Worker tuning | `WORKER_CONCURRENCY`, `WORKER_POLL_MS` | 4 jobs; 2000 ms | `packages/jobs/src/runner.ts` |
| Log detail | `LOG_LEVEL` | `info` | `packages/shared/src/env.ts` |

## Email

| Decision (PRD) | Setting | Placeholder / default | Read in |
| --- | --- | --- | --- |
| Transactional email provider with EU delivery (INF2) | `EMAIL_PROVIDER` (`dev` or `http`), `EMAIL_PROVIDER_URL`, `EMAIL_PROVIDER_API_KEY` | `dev` — nothing is sent; messages stay in `email_outbox` | `packages/email/src/providers.ts` |
| Sender address; SPF, DKIM, DMARC on its domain (INF1, LAU3) | `EMAIL_FROM` | Empty | `packages/email/src/providers.ts` |
| Bounce and complaint webhook secret | `EMAIL_WEBHOOK_SECRET` | Empty (the endpoint then refuses) | `apps/web/app/api/webhooks/email/route.ts` |

No specific provider is integrated; `http` is a generic seam.

## Backups and monitoring

| Decision (PRD) | Setting | Placeholder / default | Read in |
| --- | --- | --- | --- |
| How the daily backup is taken (INF10) | `BACKUP_COMMAND`, `BACKUP_COMMAND_TIMEOUT_MS` | Unset — the job records "skipped" | `packages/jobs/src/builtin.ts` |
| How the monthly restore test runs | `RESTORE_TEST_COMMAND`, `RESTORE_TEST_DATABASE_URL`, `BACKUP_AGE_IDENTITY_FILE` | Unset — "skipped" | `packages/jobs/src/builtin.ts`, `scripts/deploy/container-restore-test.sh` |
| Backup encryption key and who holds the private half (SEC9) | `BACKUP_AGE_RECIPIENT` (the public key). The private key is deliberately **not** a setting of the server | Empty | `scripts/deploy/container-backup.sh` |
| Backup bucket, separate from the asset buckets | `BACKUP_S3_BUCKET`, `BACKUP_S3_ENDPOINT`, `BACKUP_S3_REGION`, `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY`, `BACKUP_S3_SSE_KMS_KEY_ID` | Empty | `scripts/deploy/container-backup.sh` |
| Alert channel someone watches (LAU5) | `OPS_ALERT_WEBHOOK_URL` | Empty — alerts only appear on `/console/operations` | `packages/jobs/src/runner.ts` |
| Alert thresholds | `ALERT_QUEUE_DEPTH`, `ALERT_ERROR_RATE`, `ALERT_OLDEST_DUE_SECONDS` | 500 jobs; 0.2; 900 s | `packages/jobs/src/metrics.ts` |
| Outside uptime monitor | None — point it at `APP_URL/api/health` | — | `apps/web/app/api/health/route.ts` |

## Deployments from the console

| Decision (PRD) | Setting | Placeholder / default | Read in |
| --- | --- | --- | --- |
| The private, organisation-owned repository (DEP1) | `GITHUB_REPO` (`owner/name`) | Empty — the deploy screen says it is not connected | `packages/core/src/deploys.ts` |
| The GitHub App (DEP1) | `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_INSTALLATION_ID`; optional `GITHUB_API_URL`, `GITHUB_DEFAULT_BRANCH`, `GITHUB_DEPLOY_WORKFLOW`, `DEPLOY_CI_CONTEXT` | Empty; `main`, `deploy.yml`, `release-ci` | `packages/core/src/deploys.ts` |
| Token the pipeline presents to the console | `DEPLOY_RECORD_TOKEN` (the same value as the GitHub environment secret) | Empty | `packages/core/src/deploys.ts` (`verifyDeployRecordToken`), `scripts/record-deploy.mjs` |
| Container registry; how the runner reaches the host | GitHub `production` environment: `REGISTRY`, `IMAGE_PREFIX`, `REGISTRY_USERNAME`, `REGISTRY_PASSWORD`, `DEPLOY_SSH_HOST`, `DEPLOY_SSH_USER`, `DEPLOY_SSH_PORT`, `DEPLOY_DIR`, `DEPLOY_SSH_KEY`, `DEPLOY_SSH_KNOWN_HOSTS` | Not set anywhere | `.github/workflows/deploy.yml`, `scripts/deploy/lib.sh` |
| Whether GitHub also requires reviewers on the `production` environment | GitHub setting | — | Runbook §4.1 |
| Branch and tag protection (DEP7) | GitHub settings | — | Runbook §4.1 |

`APP_VERSION` is set by the image build, and `DEPLOY_RECORD_URL`, `DEPLOY_ID`, `DEPLOY_TAG`,
`DEPLOY_COMMIT` by the workflow — they are not decisions. `NODE_ENV`, `NEXT_OUTPUT`,
`AUTH_TIMING_FLOOR_MS` and `TEST_DATABASE_ADMIN_URL` are technical switches for building and
testing; leave them as documented in `.env.example`.

## People

| Decision (PRD) | Setting | Today | Where |
| --- | --- | --- | --- |
| The first staff member | `node scripts/make-staff.mjs <email> <roles>` on the server | Nobody | `scripts/make-staff.mjs`, `core/staff` (`grantStaffBootstrap`) |
| The second person (approvals, W9) and the third (compliance access, W8) | The same script for the second; afterwards console → *Acces*, approved by another platform admin | Single-operator mode until a second person exists | `/console/access` |
| Who holds each of the six roles; the named privacy owner | Console → *Acces* | — | `core/staff` |
| Launch-day on-call names (LAU7) | The table in `14-deploy-runbook.md` §9 | Blank | — |
| Where security reports go | `SECURITY.md` at the repository root | Placeholder | — |

## Console settings

| Decision (PRD) | Setting key | Placeholder / default | Edited at | Read in |
| --- | --- | --- | --- | --- |
| Legal documents published — the gate for new accounts (LAU1) | `legal.published` | Nothing recorded: sign-up closed (open only on localhost) | Console → *Lansare* | `core/compliance` (`areLegalDocsPublished`), `packages/auth/src/signup.ts` |
| Launch checklist LAU1–LAU9 and its records (ANSPDCP, DPIA, ANCOM, accessibility) | `launch.checklist`, `launch.records` | All open | Console → *Lansare* | `core/compliance` |
| Moderation service target in hours (W2) | `moderation.targetHours` | 48 | Console → *Moderare* | `core/moderation` (`MODERATION_TARGET_DEFAULT_HOURS`) |
| Sign-in limits (SEC16) | `security.signInLimits` | 3 per hour and 10 per day per email; 10 per hour per IP and per device; 5 attempts per code; 20 entries per hour | Console → *Operațiuni*, by approval | `core/ratelimit` (`SIGN_IN_LIMIT_DEFAULTS`) |
| Real monthly fixed cost for the break-even figure | `commercial.monthlyFixedCostMinor` | 20,000 RON, shown as a placeholder | Console → *Comercial* | `core/billing` (`MONTHLY_COST_PLACEHOLDER_MINOR`) |
| Pilot prices and TVA rate (MON3, PAY4) | `billing.prices` | 199 / 1.990 / 149 RON excluding TVA, 21% — shown as unconfirmed | Console → *Comercial*, by approval | `core/billing` (`PILOT_PRICE_PLACEHOLDERS`) |
| When to enable monetisation (MON2, M3/M4) | Table `monetization_switch` | OFF | Console → *Comercial*, by approval, after a recorded test-mode acceptance | `core/monetization` |
| Launch counties and which directory pages are public | Columns `counties.launch_area`, `published`; `categories.published`; `localities.public_page` | From the seed | Console → *Director* | `core/geography`, `core/directory` |
| Discovery sources, their rate limits and on/off switch (BD7) | Table `discovery_sources` | None configured | Console → *Descoperire* | `core/discovery` |

## Payments, invoicing and AI text (all optional, all off)

| Decision (PRD) | Setting | Placeholder / default | Read in |
| --- | --- | --- | --- |
| Payment processor — Stripe first, Netopia as fallback, revisited at M2 (PAY5) | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PAYMENT_METHOD_CONFIGURATION` | Empty — the webhook endpoint answers 404 | `core/billing` (`stripeConfig`) |
| Fiscal invoicing connector and e-Factura (PAY3) | `INVOICING_PROVIDER`, `INVOICING_WEBHOOK_SECRET`; an adapter registered with `registerInvoicingProvider` | Empty — the endpoint answers 404; **no adapter exists** | `core/invoicing` |
| AI text provider and model (INF7) | `AI_TEXT_PROVIDER` (`off`, `dev`, `http`), `AI_TEXT_MODEL`, `AI_TEXT_URL`, `AI_TEXT_API_KEY` | `off` | `core/aitext` (`getAiTextConfig`). The choice in use is recorded in the setting `aitext.provider` |
| MCP call limits | `MCP_CALLS_PER_MINUTE`, `MCP_CALLS_PER_DAY`, `MCP_AUTH_FAILURES_PER_IP_PER_HOUR` | 60; 2000; 60 | `packages/mcp/src/server.ts` |
| Gift estimator starting table (a cultural guide, not a rule) | Constant `DEFAULT_GIFT_GUIDE`; each user can change their own copy | Deliberately round placeholder amounts | `core/gifts` |
| Licensed discovery datasets and the ONRC data source (BD1) | A discovery source of kind `licensed_dataset`; an adapter registered with `registerOnrcAdapter` | None | `core/discovery` |

## Legal, compliance and commercial decisions with no setting

These are decisions and paperwork; the console's launch checklist records that they were done.

- The legal entity operating the platform, its TVA status and e-Factura obligations.
- ANSPDCP formalities; the DPIA for discovery, guest household data and the MCP transfer
  (LAU2).
- Romanian legal review of the terms, the business terms, the "For businesses" page, the
  claim invitation and the quote disclaimer; the texts of the legal pages on the public site
  (`packages/i18n/messages/*/legal.json`) are part of this review.
- DSA contact point and registration with ANCOM (LAU8).
- The external penetration test before the first guest link (LAU4).
- The accessibility evaluation behind the statement (LAU9).
- Which categories and counties are promoted first; whether basic listings stay free
  permanently.
- A licence for the source code, if it is ever shared.
- The open product questions in PRD §13 (drawing formats beyond PDF and images, dried
  flowers, animated invitation envelope, paid invitation packs, SMS for enquiries).

## Decisions the gap list adds

`09-traceability.md` found three places where a decision is needed before code can follow:

1. **What happens to a person's occasions when they delete their account** — delete them too,
   or require handing over or deleting each first.
2. **How audit entries older than 2 years are removed**, given the log is append-only by
   design.
3. **Whether the "For businesses" page and guides must be editable from the console** (PRD
   W7) or may keep changing by release.

## The rule

If a decision above blocks a piece of work, ship the placeholder and the setting, say so, and
never bake a guess into code, data or wording.
