# 14 — Deploy runbook (R0-14, DEP1–DEP7, W10, LAU7)

This runbook maps the deploy obligations to the artifacts in this repo. The pipeline is
`.github/workflows/deploy.yml`; every deploy is recorded in the `Deploy` table and shown
on the console screen `/console/deploys` (W10).

- **DEP1**: GitHub App / OIDC role scoped to this one private repo; `deploy.yml` requests
  only `contents: read` + `id-token: write`.
- **DEP2**: the console `/console/deploys` screen shows the live release with hash and tag,
  plus tags and the commits between them.
- **DEP3**: deploys run under the `production` GitHub environment — second-person approval
  is enforced by environment protection rules. The `workflow_dispatch` emergency input is
  the audited emergency path and is stored as `emergency=true` on the `Deploy` row.
- **DEP4**: job order is backup (`pg_dump` → encrypted backup bucket, key managed
  separately per SEC9) → `prisma migrate deploy` → image build/push → service roll →
  health checks against `/api/health` (30 × 10 s); any failure auto-rolls back to the
  previous tag. No data is ever deleted by a rollback.
- **DEP5**: manual rollback re-runs the previous tag's task definition. If a migration is
  non-reversible, the rollback stops with a message instead of running it — the operator
  then follows the restore procedure (restore from the pre-migrate backup, INF10; stated
  RTO 4 h / RPO 24 h per LAU5).
- **DEP6**: `scripts/record-deploy.mjs` writes start/done/rolled_back with tag, hash,
  actors, CI status and duration on every deploy (SEC10-audited table).
- **DEP7**: the workflow reads the tag's combined CI status via the GitHub API and refuses
  the deploy unless it is `success`, except through the emergency input. Deploys are
  serialized (`concurrency: deploy-production`, no cancel-in-progress).

## LAU7 launch-day runbook (operator completes before go-live)

1. Who is on call (minimum two people — the two-person rule for irreversible console
   actions, W9; a solo launch is out of scope by design).
2. Deploy and rollback exactly as above (W10, DEP1–DEP7).
3. Pulling back a bad discovery batch: pause the source in `/console/discovery`, revert the
   affected listings, record the run (W5).
4. Guest-link incident communication: plain-language message via the incident banner
   (LAU5) + status page; never a stack trace.
5. Every irreversible console action goes through `/console/approvals` (two-person rule).

## Operator decisions needed (placeholders, not guesses)

Cloud vendor + EU region, secret store product, registry credentials, backup bucket/KMS,
app ingress — all are variables in `infra/terraform/variables.tf` with placeholder
defaults. Email provider warm-up (LAU3), penetration test (LAU4), ANSPDCP/DPIA (LAU2) and
ANCOM DSA registration (LAU8) are operator gates listed on `/console/launch`.
