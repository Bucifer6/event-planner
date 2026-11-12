# infra/ — R0-02 environments, DNS, infra, secrets (artifacts only)

Terraform for dev / staging / prod in the EU (Romania preferred; the vendor and region are
operator-configurable via `var.region` — see `terraform/variables.tf`). **These artifacts
are versioned but NOT applied from this environment**: apply them once, by the operator,
from a machine with cloud credentials. No secret value lives in this repo (SEC13) — only
references (`var.*_secret_arn`) into the operator-configured secret store.

Layout:

- `terraform/versions.tf` — provider pins
- `terraform/variables.tf` — every operator decision as a variable with a placeholder
  default (vendor, region, domains, secret ARNs, instance sizes)
- `terraform/main.tf` — DNS zone + records (`eventdesk.ro`, `app.eventdesk.ro`,
  `media.eventdesk.ro`), managed Postgres, S3-compatible object store for media
  (served with `Content-Disposition: attachment; noinline`, SEC4), app compute,
  secret-store wiring, backup vault (daily, encrypted, 30-day retention, INF10/SEC9)
- `terraform/envs/{dev,staging,prod}.tfvars.example` — per-env values (copy to `*.tfvars`,
  never commit real values)

Boot contract: the app refuses to boot in production (`APP_ENV=production`) with missing
`DATABASE_URL`/`APP_URL` (see `apps/web/instrumentation.ts`, SEC13). Backups run before
every migration in the deploy job (DEP4, `.github/workflows/deploy.yml`). See
`docs/build/14-deploy-runbook.md` for DEP1–DEP7.
