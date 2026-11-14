# Infrastructure as code (R0-02)

**Nothing in this folder has been applied.** It was written in a build environment with no
cloud account and no `terraform` binary: it has not been through `terraform validate` or
`terraform plan`. Before the first apply, run `terraform fmt -check -recursive`,
`terraform init`, `terraform validate` and review the plan line by line.

## What it describes

| PRD | What | Module |
| --- | --- | --- |
| INF1 | DNS for `eventdesk.ro`, `app.eventdesk.ro`, `media.eventdesk.ro`; SPF, DKIM, DMARC | `modules/dns` |
| INF9, INF10, INF12 | Managed PostgreSQL 16, encrypted at rest with a customer-managed key, daily backups, 30-day retention, private network only | `modules/database` |
| INF3, INF10, INF12, SEC4 | Three private buckets — assets, media, backups — with versioning (30-day recovery) and server-side encryption with a customer-managed key; the backup bucket uses a **different** key | `modules/storage` |
| SEC13 | Secret store; the application environment is read **by reference** at start, never stored in the repo, state, image or logs | `modules/secrets` |
| Q7 | Compute for one web service and one worker (plus the static public site and the TLS ingress) | `modules/compute` |
| LAU5 | Alarm channel and infrastructure alarms | `modules/monitoring` |
| — | Private network, firewall rules | `modules/network` |

`main.tf` wires the modules; `variables.tf` holds **every operator decision as a variable**
with a placeholder default and a comment. One state per environment (`staging`,
`production`); local development needs none of this (`docker-compose.dev.yml`).

## Why the AWS bodies are only a reference

The hosting vendor is an open operator decision (`docs/build/10-operator-decisions.md`,
INF9: EU, Romania preferred). To be useful anyway, the modules are implemented for **one**
concrete, widely available stack on which every PRD control maps to a first-party feature:
AWS in an EU region (managed PostgreSQL with customer-managed keys and managed master
password, versioned buckets with lifecycle rules, a secret store with IAM-scoped read).

What that reference does **not** settle:

- **Romania.** AWS has no region in Romania. `region` defaults to `eu-central-1`
  (Frankfurt) as a placeholder; the variable refuses anything outside the EU. If "Romania
  preferred" becomes "Romania required", the vendor changes.
- **Single host.** The compute module is one Docker host — the simplest shape of "one web
  service, one worker" and the reference target of the deploy scripts. It is a single point
  of failure, sized by placeholder; the stated RTO is 4 hours (LAU5).
- **SSH for deploys.** Who may reach SSH on the host (`deploy_ssh_cidrs`) depends on where
  the deploy runner lives. The default is closed.

## Swapping the vendor

The module **interfaces** are the provider-agnostic part. To move to another vendor, keep
each module's `variables.tf` / `outputs.tf` and rewrite its `main.tf`:

| Module | The platform needs | Outputs the rest relies on |
| --- | --- | --- |
| `network` | a private network; database unreachable from the internet | subnet ids, app security group |
| `database` | PostgreSQL 16, encryption at rest, daily backups kept ≥ 30 days, TLS | `endpoint` |
| `storage` | 3 private buckets, versioning, 30-day recovery, encryption with a managed key, a separate key for backups | bucket names, key ids |
| `secrets` | a secret the compute can read by reference | secret name |
| `compute` | runs the `web`, `worker`, `public` images; health-checked; gets its env from the secret store | public address |
| `dns` | A/AAAA or CNAME for the three hosts; TXT/CNAME for email | name servers |
| `monitoring` | alarms to a monitored channel | — |

and add a matching `DEPLOY_TARGET` case in `scripts/deploy/*.sh` (contract in
`scripts/deploy/lib.sh`). Nothing in the application code is vendor-specific: it reads
`DATABASE_URL`, `S3_*` and friends from the environment (`.env.example`).

## Media domain and `Content-Disposition`

SEC4 requires uploaded PDFs to be served from `media.eventdesk.ro` as downloads
(`Content-Disposition: attachment`, never inline). An object store cannot force response
headers by itself, so the guarantee is made where the bytes are served: the web app's
`/api/media/*` route sets the header, the app refuses every other path on the media host,
and the reference ingress (`infra/reference-docker-host/Caddyfile`) adds
`Content-Disposition: attachment` and `nosniff` to anything that lacks them. The storage
module carries the value as `media_content_disposition` so a vendor with a CDN in front of
the bucket can enforce it at the edge.

## Backups and keys (INF10, SEC9)

Two independent lines:

1. the database service's own daily snapshots, 30 days, encrypted with the database key;
2. application-level dumps (`scripts/deploy/container-backup.sh`), taken daily by the worker
   and before every deploy, **encrypted with an `age` public key before upload**. The
   matching private key is the customer-managed backup key: it is not in this cloud account
   and never next to the backups. The bucket adds its own at-rest key (separate from the
   objects key) and expires dumps after 30 days. The host can write and read dumps but not
   delete them.

## Applying (operator)

```sh
cd infra/terraform
cp production.tfvars.example production.tfvars      # fill in; never commit
terraform init                                      # configure the backend first (versions.tf)
terraform fmt -check -recursive && terraform validate
terraform plan  -var-file=production.tfvars -out=production.plan
terraform apply production.plan
```

Then follow `docs/build/14-deploy-runbook.md`, "Before the first deployment": fill the
application secret, copy `infra/reference-docker-host/` to the host, configure the GitHub
`production` environment.
