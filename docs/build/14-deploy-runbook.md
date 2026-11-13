# 14 — Deploy runbook (R0-14, DEP1–DEP7, W10, INF10, SEC9, SEC13, LAU5, LAU7)

How production is deployed, rolled back and recovered, what the operator must set up before
the first deployment, and the launch-day runbook. It describes what is in this repository;
where a choice is still the operator's, it says so instead of guessing.

**Not verified in the build environment:** the workflows have not run on GitHub, the images
have not been built, the Terraform has not been validated or applied, and the deploy scripts
have not touched a real host. The domain logic (`packages/core/src/deploys.ts`) is covered by
tests with a fake GitHub. Treat the first staging deployment as the test of everything else.

## 1. The pieces

| Piece | Where |
| --- | --- |
| Console screen (W10) | `/console/deploys` — `apps/web/app/console/deploys/` |
| Rules: tag only, second person, CI green, one at a time, audit | `packages/core/src/deploys.ts` (tests: `packages/core/test/deploys.test.ts`) |
| Deploy history table | `deploys` — `packages/db/src/schema/deploys.ts` |
| Pipeline | `.github/workflows/deploy.yml` (`workflow_dispatch` only) |
| Release check that makes a tag deployable | `.github/workflows/release.yml` → commit status `release-ci` |
| CI | `.github/workflows/ci.yml` |
| Pipeline → console reports | `scripts/record-deploy.mjs` → `POST /api/deploys/record` |
| Vendor-specific steps | `scripts/deploy/{backup,migrate,roll,health,rollback}.sh`, switch `DEPLOY_TARGET` |
| Reference target (a Docker host over SSH) | `infra/reference-docker-host/` |
| Images | `Dockerfile` (targets `web`, `worker`, `public`) |
| Infrastructure description (reference, not applied) | `infra/terraform/` |

## 2. What happens in a deployment, end to end

1. A maintainer merges to protected `main` and pushes an annotated tag `vX.Y.Z`.
2. `release.yml` checks the tag is annotated and on `main`, runs the full CI on that exact
   commit and posts the commit status **`release-ci`** (success or failure).
3. In `/console/deploys` a `platform_admin` or `security_administrator` sees the live
   release, the release tags with their CI status, and — after choosing a tag — the commits
   between the live release and it (DEP2). They give a reason and press **Cere publicarea**.
   The server refuses anything that is not an existing release tag, and any tag without a
   green `release-ci` on its commit (DEP7). Nothing is deployed yet: an approval request
   `deploy.production` is created.
4. A **second** staff member with one of those two roles approves it in
   `/console/approvals` (the requester can never approve their own request). With only one
   person on the staff the request waits and has no effect (W9).
5. On approval the server re-checks the tag and CI, takes the single "production" slot,
   and — using the GitHub App's installation token, which never leaves the server (DEP1) —
   dispatches `deploy.yml` with the tag, the deploy id and the two staff ids.
6. `deploy.yml`:
   1. refuses a ref that is not a `vX.Y.Z` tag on `main`;
   2. **asks the console to confirm** this deploy id, tag and commit (`record-deploy start`).
      A run that the console did not approve — for example someone pressing "Run workflow"
      in GitHub — is refused here, before anything else happens;
   3. reads the commit's CI status and refuses unless `release-ci` is green (DEP7);
   4. builds and pushes the three images;
   5. takes an **encrypted database backup** (INF10, SEC9);
   6. runs **`pnpm db:migrate`** with the new release's code;
   7. **switches** web, worker and public site to the new release;
   8. runs **health checks**: `GET /api/health` every 10 s, up to 30 times, until it answers
      `ok` with the new version three times in a row;
   9. on failure of 7 or 8: **automatic rollback** to the previous release, then records
      `rolled_back` with the reason (DEP4). On failure before 7: records `failed` —
      production was not switched.
7. Every stage is reported to the console, which shows it as live progress (the page
   refreshes itself) and keeps it as history: tag, commit, requester, approver, CI status,
   result, duration, rollback reason (DEP6). Each step is also an audit-log row.

> **Order note.** The images are built *before* the backup and the migrations. DEP4 fixes
> backup → migrations → release; building first changes nothing in production and means a
> release that cannot be built never touches the database.

## 3. Requirement map

| | How it is met |
| --- | --- |
| **DEP1** | One repository (`GITHUB_REPO`), reached through a GitHub App installation token minted server-side from `GITHUB_APP_ID` / `GITHUB_APP_PRIVATE_KEY` / `GITHUB_APP_INSTALLATION_ID`. No function returns the key or the token; the console shows only the repository name and, when the variables are missing, their *names*. Revoke at any time by uninstalling the App on GitHub. The connection is configured by whoever controls the server environment; in the console only `platform_admin` / `security_administrator` see the screen. |
| **DEP2** | `/console/deploys`: live release + commit, tags with CI status, commits between live and a candidate. Deploy by tag: the server validates `vX.Y.Z` and resolves it through `git/ref/tags/…`, so a branch or a bare commit cannot be passed. |
| **DEP3** | Approval action `deploy.production` (one other person). Single-operator mode queues. Emergency: `security_administrator` only, reason ≥ 10 characters, audit action `deploy.emergency_requested` with `emergency: true`, `ciBypassed`, `secondPersonBypassed`. |
| **DEP4** | Section 2, step 6. The pipeline runs in GitHub Actions rather than inside the worker process: the worker cannot replace the release it is itself part of. The worker still owns the *daily* backup and the monthly restore test. |
| **DEP5** | **Revino la vX.Y.Z** on the console: one staff member, reason required. `rollback.sh` switches the release only — it never drops, truncates or restores data — and refuses (exit 3) when `scripts/deploy/irreversible.txt` lists a release in between; the console then shows "rollback stopped" with the migration's name. |
| **DEP6** | `deploys` rows + audit actions `deploy.requested`, `.approved`, `.started`, `.succeeded`, `.failed`, `.rolled_back`, `.rollback_requested`, `.rollback_succeeded`, `.rollback_blocked`, `.refused`, `.start_refused`, `.abandoned`, `.cancelled`. One deploy at a time: unique index on `deploys.active_lock`, plus the workflow's `concurrency: deploy-production` (no cancel-in-progress). |
| **DEP7** | Protected `main`, protected `v*` tags (GitHub settings, section 4), `release-ci` status on the exact commit, checked by the console at request time, again at approval time, and again by the workflow. |

## 4. Before the first deployment (operator)

Nothing below is done by the code. Tick each item; the open choices are listed in
`10-operator-decisions.md`.

### 4.1 GitHub

- [ ] The repository is **private** and owned by an **organisation**, not a personal account.
- [ ] Branch protection on `main`: pull request required, review required, CI required
      (`Lint, types, tests, build, audit, headers, smoke`), no force-push, no deletion.
- [ ] Tag protection (ruleset) for `v*`: only maintainers create; nobody updates or deletes.
- [ ] A **GitHub App** owned by the organisation, installed on **this repository only**, with
      repository permissions: *Actions: read and write* (to start the workflow),
      *Contents: read*, *Commit statuses: read*, *Metadata: read*. No webhook is needed.
      Note its App id and installation id; generate a private key.
- [ ] Environment **`production`** (Settings → Environments), deployment branches restricted
      to `main`. Variables: `APP_URL`, `PUBLIC_URL`, `DEPLOY_TARGET`, `REGISTRY`, `IMAGE_PREFIX`, and for
      the reference target `DEPLOY_SSH_HOST`, `DEPLOY_SSH_USER`, `DEPLOY_SSH_PORT`,
      `DEPLOY_DIR`. Secrets: `DEPLOY_RECORD_TOKEN`, `REGISTRY_USERNAME`,
      `REGISTRY_PASSWORD`, `DEPLOY_SSH_KEY`, `DEPLOY_SSH_KNOWN_HOSTS`.
- [ ] *Optional second lock:* required reviewers on the `production` environment. Know the
      trade-off: GitHub then also holds an **emergency** deploy until a reviewer approves it
      there. If the emergency path must work with one person (DEP3), either do not add
      required reviewers (the console already enforces the second person) or make sure a
      security administrator is a permitted reviewer and self-review is allowed.

### 4.2 Hosting (operator decision — INF9: EU, Romania preferred)

- [ ] PostgreSQL 16 (encrypted at rest, daily backups, 30 days), three buckets (assets,
      media, backups — versioned, encrypted, backups on a separate key), a secret store, and
      compute for the three images. `infra/terraform/` describes one reference stack; read
      its README, especially "Why the AWS bodies are only a reference".
- [ ] DNS: `eventdesk.ro`, `app.eventdesk.ro`, `media.eventdesk.ro`; SPF, DKIM and DMARC for
      the sending domain (LAU3).
- [ ] A container registry in the EU; the deploy runner can push, the host can pull.
- [ ] How the deploy runner reaches the host. GitHub-hosted runners have no fixed address:
      choose a self-hosted runner / bastion with a fixed address, or key-only SSH open to the
      internet. Pin the host key in `DEPLOY_SSH_KNOWN_HOSTS` either way.
- [ ] Using a different host type than the reference: implement your `DEPLOY_TARGET` in the
      five scripts (contract at the top of `scripts/deploy/lib.sh`).

### 4.3 Application environment (in the secret store — names in `.env.example`)

- [ ] Core: `DATABASE_URL` (an application role, not the master user), `APP_URL`,
      `PUBLIC_URL`, `MEDIA_URL`, `SESSION_SECRET`.
- [ ] Deploy console: `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY` (PEM; write newlines as
      `\n`), `GITHUB_APP_INSTALLATION_ID`, `GITHUB_REPO` (`owner/name`),
      `DEPLOY_RECORD_TOKEN` — 32+ random characters, the **same** value as the GitHub
      environment secret of that name:
      `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`.
- [ ] Email, object store, malware scanner (production refuses uploads without one),
      `OPS_ALERT_WEBHOOK_URL`.
- [ ] Backups: generate the backup key pair **on a machine that is not the server**:
      `age-keygen -o eventdesk-backup.key`. The printed public key (`age1…`) goes into
      `BACKUP_AGE_RECIPIENT`. The private file is the customer-managed backup key (SEC9):
      store it where the backups are not — a separate vault, two custodians. Set
      `BACKUP_S3_*`, and `BACKUP_COMMAND` / `RESTORE_TEST_COMMAND` as shown in
      `infra/reference-docker-host/README.md`.

### 4.4 The very first installation

The console cannot deploy the console before it exists. Once, by hand, from an operator
machine that has the repository at the release tag and SSH access:

```sh
export DEPLOY_TARGET=ssh-docker DEPLOY_SSH_HOST=… DEPLOY_SSH_USER=deploy \
       DEPLOY_SSH_KEY_FILE=~/.ssh/eventdesk_deploy DEPLOY_SSH_KNOWN_HOSTS_FILE=~/.ssh/eventdesk_known_hosts \
       IMAGE_PREFIX=<registry>/<namespace> APP_URL=https://app.eventdesk.ro
TAG=v1.0.0
for t in web worker public; do
  docker build --target $t --build-arg APP_VERSION=$TAG \
    --build-arg NEXT_PUBLIC_APP_URL=$APP_URL --build-arg NEXT_PUBLIC_SITE_URL=https://eventdesk.ro \
    -t $IMAGE_PREFIX/$t:$TAG . && docker push $IMAGE_PREFIX/$t:$TAG
done
bash scripts/deploy/migrate.sh $TAG      # creates the schema (the database is empty: no backup yet)
bash scripts/deploy/roll.sh $TAG
bash scripts/deploy/health.sh $TAG
```

Then, on the host (in `/opt/eventdesk`): seed the reference data
(`docker compose --env-file release.env run --rm tools pnpm db:seed`), create the first two staff
members (`docker compose --env-file release.env run --rm tools node scripts/make-staff.mjs
<email> platform_admin,security_administrator` — each person must have signed in once and must
turn on two-step sign-in), and open `/console/deploys`. It should show the repository and the
tags. **Deploy the same tag once through the console**: it is harmless (same images, no
pending migrations) and it records the live release, which is what rollbacks and the
"commits since live" view are measured against.

`pnpm db:migrate` needs the committed migrations in `packages/db/drizzle/`; they are
generated once, at integration, with `pnpm db:generate`.

## 5. Day-to-day

### Deploy a release

Console → *Publicări* → **Examinează** next to the tag → read the commits → reason →
**Cere publicarea** → a second person approves in *Aprobări* → watch the progress table.
Done when the row says *Reușită*. Typical duration: the image build plus a few minutes.

### Emergency deploy (DEP3)

Only for an urgent security fix. A `security_administrator` chooses the tag → **Publicare de
urgență** → reason. It starts at once, without a second person; if CI is not green the
console says so and the bypass is recorded. Afterwards: a second person reviews the audit
entry (`deploy.emergency_requested`) the next working day.

### Roll back (DEP5)

Console → *Publicări* → **Revino la vX.Y.Z** → reason. One person. The target is the
release that was live before the current one. If the row ends as *Eșuată* with "rollback
stopped: migration … cannot be reversed", nothing was changed: decide between fixing forward
(a new release) and the restore procedure in section 7.

### When a deployment does not succeed

| Console shows | What it means | What to do |
| --- | --- | --- |
| *Eșuată*, stage verify / build / backup | Production was not changed | Fix the cause, request again |
| *Eșuată*, stage migrate | A migration failed; the release was **not** switched. Pending migrations are applied inside a transaction, so a failure normally leaves the schema as it was — verify before trusting that | Check the database, fix forward with a new release. The old release keeps running — this is why migrations must be backward compatible |
| *Anulată prin revenire* | Health checks failed; the previous release is running again | Read the reason, fix, new release |
| *Anulată prin revenire* … "NOT answering" | The previous release was put back but is not healthy either | Incident: section 8 |
| *Eșuată* … "rollback stopped" | The new release is unhealthy **and** cannot be rolled back because of an irreversible migration. It is still running | Incident: fix forward at once, or restore (section 7) |
| *În desfășurare* for a very long time | The pipeline died without reporting | Check the workflow run on GitHub and what is running on the host. 90 minutes after its last message the console offers **Închide ca eșuată** (changes the record only) |

### Irreversible migrations

A migration that older code cannot live with — a dropped or renamed column, a constraint the
old code violates, data rewritten in place — gets a line in
`scripts/deploy/irreversible.txt`, in the same pull request: `vX.Y.Z  <migration name>  <why>`.
Prefer never needing it: expand in one release, switch the code, contract in a later one.

## 6. Secrets (SEC13)

All secrets live in the secret store and reach the processes as environment variables;
none is in the repository, in an image layer, in the Terraform state or in a log (boot
errors and the console print variable *names* only). Rotate at least yearly and whenever a
staff member with access leaves: `SESSION_SECRET` (signs everyone out),
`GITHUB_APP_PRIVATE_KEY` (generate a new key in the App, delete the old), `DEPLOY_RECORD_TOKEN`
(change it in the secret store **and** the GitHub environment together), email and object
store keys, `DEPLOY_SSH_KEY`, the registry credentials. Record each rotation date on
`/console/launch`. After changing a value, roll the release (the reference host re-reads the
secret store at each roll).

## 7. Backups, restore, key rotation (INF10, SEC9, LAU5)

**What exists.** (a) The database service's own daily snapshots, 30 days. (b) Application
dumps: daily at 02:30 (worker job `backup.run`) and before every deploy, encrypted with the
`age` public key before upload, kept 30 days by the bucket's lifecycle rule; the host can
write and read them but not delete them. (c) Object storage versioning: a deleted or
overwritten file is recoverable for 30 days. Job results are on `/console/operations`.

**Targets.** RPO 24 hours (one daily backup; in practice the pre-deploy dump is fresher).
RTO 4 hours.

**Monthly restore test.** Worker job `backup.restore-test` on the 1st at 04:30 runs
`RESTORE_TEST_COMMAND`: it downloads the newest dump, **decrypts** it with the private key and
**restores** it into an empty scratch database, then counts tables — proof of decryption end
to end, not of a file existing. Where the private key lives during the test is an operator
decision (see `infra/reference-docker-host/README.md`); it must not sit permanently next to
the backups.

**Restore procedure (two people; one of them a security administrator).**

1. Open an incident on `/console/incidents` so guest-facing pages show the plain message.
2. Stop the worker and the web app (reference host: `docker compose stop worker web`).
3. Choose the restore point: the pre-deploy dump (`postgres/YYYY/MM/eventdesk-…-pre-deploy-vX.Y.Z.dump.age`)
   or the last daily one. Everything written after it is lost — say so in the incident log.
4. Create a **new, empty** database (never overwrite the damaged one: it is evidence and a
   fallback). Restore into it:
   `aws s3 cp s3://<bucket>/<key> - | age -d -i <private key file> | pg_restore --no-owner --exit-on-error -d <new database url>`
5. Point `DATABASE_URL` in the secret store at the new database; deploy the release that
   matches the dump (the tag is in the file name) through the console, or by hand as in 4.4
   if the console is down.
6. Check `/api/health`, sign in, open an occasion, check the audit log's last entries.
7. Close the incident; write what was lost and why. Keep the damaged database until the
   review is done.

**Key rotation (at least yearly — SEC9).** Generate a new key pair; put the new public key
in `BACKUP_AGE_RECIPIENT`; roll. **Before retiring the old private key**, restore a backup
taken *before* the rotation with it (`container-restore-test.sh <key of a pre-rotation dump>`
with the old identity file) and record the result. Keep the old key until every backup made with it has
expired (30 days).

## 8. Monitoring and incidents (LAU5)

- `/api/health` — used by the pipeline; point an outside uptime monitor at it (operator's
  product).
- Worker alerts (queue depth, job error rate, oldest waiting job) → `OPS_ALERT_WEBHOOK_URL`
  and `/console/operations`. Infrastructure alarms → the alert channel of the hosting.
- Incident: a `security_administrator` opens it on `/console/incidents`; guest-facing pages
  show "Ceva nu funcționează…" in plain language — never a stack trace. Close it when done;
  the log stays.

## 9. LAU7 — launch-day runbook

Owner: PlatformAdmin. Fill in the names before launch day; keep a printed copy.

**On call (at least two people — a solo launch is out of scope by design).**

| Role | Name | Phone | Can do |
| --- | --- | --- | --- |
| PlatformAdmin (lead) | ____ | ____ | request/approve deploys, roll back, approvals |
| SecurityAdministrator | ____ | ____ | emergency deploy, incidents, approve deploys, restore |
| PrivacyOwner (reachable) | ____ | ____ | data-subject requests, breach assessment |
| Third person for compliance access | ____ | ____ | second approval of a compliance access request |

**Before opening.** Launch checklist on `/console/launch` complete (LAU1–LAU9). Two staff
accounts with two-step sign-in tested. Last backup and last restore test green on
`/console/operations`. Malware scanner and email provider configured; a real sign-in code
received on an outside mailbox. The release that is live is the one that passed the
penetration test (LAU4). Alert channel tested by someone actually receiving an alert.

**Deploys and rollbacks on the day.** Exactly as section 5. No deploy without both on-call
people reachable. Freeze: no non-urgent deploy in the two hours before and after an
announced launch moment.

**Pulling back a bad discovery batch (W5).** Pause the source in the console's discovery
section, pull the batch back there (its unclaimed listings leave the directory), record why
on the batch. Listings already claimed by a business are not touched by a batch pull-back:
handle them through moderation. Two people for anything irreversible.

**Guest-link incident.** If guest links fail or show the wrong thing: (1) open an incident
with a plain message in Romanian and English; (2) roll back if a deploy caused it;
(3) if any guest could have seen another household's data, treat it as a personal-data
breach — PrivacyOwner assesses notification to ANSPDCP within 72 hours; (4) hosts are told
by email what happened and whether they need to do anything; never a stack trace, never
blame on the guest.

**The two-person rule.** Every irreversible console action goes through
`/console/approvals`: staff roles, sign-in limits, production deploys, refunds and
suspensions where they apply. The requester never approves their own request. **Compliance
access** to a person's retained records needs three people: the PrivacyOwner asks on
`/console/compliance`, two others approve, access lasts 24 hours by default and every read
is in the audit log.

**After the day.** Review the audit log entries of the day (deploys, approvals, any
emergency), note what to change in this runbook.

## 10. Operator decisions this runbook depends on

Hosting vendor and region; secret store product; container registry; how the deploy runner
reaches the host; whether the GitHub `production` environment has required reviewers; where
the backup private key is kept and where the restore test runs; the outside uptime monitor
and the alert channel; the email provider (LAU3); the malware scanner (SEC4); the second and
third staff person. Each is a variable or a setting with a placeholder — see
`10-operator-decisions.md`, `.env.example` and `infra/terraform/variables.tf`.
