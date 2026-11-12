# 04 — Release 0: platform foundation (work items)

Everything else depends on this release. Gate M0 (PRD section 12): free activation works; public
and app sites are separate; no third-party script on either site.

Work item format: **PRD** refs → **Depends on** → **Scope** → **Acceptance** (all must pass).

### R0-01 — Repo scaffold, tooling, CI
- **PRD:** Q7, INF9, DEP7
- **Depends on:** —
- **Scope:** pnpm monorepo per `01-architecture.md`; `apps/web`, `apps/public`, `apps/worker`,
  `packages/*`; TypeScript strict, ESLint/Prettier, Vitest, Playwright, k6 dev dep; `ci.yml`
  (lint → typecheck → unit/integration → build → dependency audit → e2e smoke → a11y/CSP/320px);
  branch protection on `main`; tag convention `vX.Y.Z`; PR checklist from `README.md`.
- **Acceptance:**
  - [ ] `pnpm install` + `pnpm test` + `pnpm build` green locally and in CI on a sample PR
  - [ ] CI fails a PR with a high-severity dependency (proven by a test commit), passes when fixed
  - [ ] `apps/public` build output contains no cookies set and no third-party script tag (automated check)
  - [ ] Docs: branch/tag/PR conventions in `README.md` of the repo

### R0-02 — Environments, DNS, infra, secrets
- **PRD:** INF1, INF9, SEC13, SEC9
- **Depends on:** R0-01
- **Scope:** `infra/` IaC for dev/staging/prod in the EU (Romania preferred, operator-configurable
  vendor); DNS for `eventdesk.ro`, `app.eventdesk.ro`, `media.eventdesk.ro`; secret store wiring
  (operator-configurable product); env validation at boot; backup key management separate from
  backups.
- **Acceptance:**
  - [ ] All three domains resolve to the right apps; media domain serves with
    `Content-Disposition: attachment; noinline` headers (SEC4)
  - [ ] App refuses to boot with missing/invalid env; no secret value appears in logs, build output
    or the repo (SEC13)
  - [ ] Staging deploy from `main` works end-to-end

### R0-03 — Database core, audit log, backups, retention
- **PRD:** SEC10, INF10, INF6, D5, Q7
- **Depends on:** R0-01, R0-02
- **Scope:** Prisma + PostgreSQL; base models from `02-data-model.md` (accounts/session/audit/retention
  subset); migrations via `prisma migrate deploy`; append-only `AuditLog` (app role has INSERT
  only; trigger blocks UPDATE/DELETE); backup job (daily, encrypted, 30-day retention) + monthly
  logged restore test; retention job per INF6 table.
- **Acceptance:**
  - [ ] Migration deploy runs in the deploy job after backup (DEP4)
  - [ ] Attempt to `UPDATE`/`DELETE` an `AuditLog` row fails at DB level (test)
  - [ ] Backup + restore test job runs and logs result in console-visible store (INF10, SEC9)
  - [ ] Retention job purges expired codes per INF6 and logs counts

### R0-04 — Auth and accounts
- **PRD:** S1–S4, S7, S8, INF4, SEC1, SEC3, SEC8, SEC12, SEC14, SEC16
- **Depends on:** R0-03, R0-05, R0-11
- **Scope:** email code sign-in (15 min, 5 attempts, 3/hour, 10/day — INF4), single-use one-tap
  link with SEC14 consumed-link flow, enumeration-safe identical responses (SEC1); anonymous
  accounts (Argon2id, generic failure, 10 recovery codes, unrecoverability warning); sessions
  30d/14d-idle, Secure+HttpOnly+SameSite=Lax, sign-out-everywhere incl. MCP tokens, email change
  revokes (SEC3, SEC12); sensitive-action fresh code within 10 min (S4); opt-in TOTP/passkey +
  recovery codes (S2); hashed storage of codes/tokens (SEC8).
- **Acceptance:**
  - [ ] Code request behaves identically (template, timing band) for existing and non-existing
    emails; new code invalidates old; 6th attempt on a code fails; limits per INF4/SEC16 enforced
    with generic message + retry time
  - [ ] One-tap link single-use and expiring with the code; prefetch-consumed link still allows the
    code, and the consumed page offers one rate-limited new code (SEC14)
  - [ ] Anonymous signup shows plain consequences; wrong username/password → identical failure;
    recovery codes work for S4 actions; add/remove email converts account kind correctly (S7/S8)
  - [ ] Sessions expire at 30d/14d-idle; "sign out everywhere" revokes sessions and MCP tokens;
    cookies carry the three flags; nothing security-relevant in localStorage (SEC12)
  - [ ] Codes/tokens stored hashed; UI shows ≤ last 4 chars (SEC8)

### R0-05 — Rate limiting and bot protection middleware
- **PRD:** SEC11, SEC16
- **Depends on:** R0-03
- **Scope:** `RateLimitBucket` store, three-axis limiter (email/IP/device cookie with disclosed
  cookie), escalating per-address backoff without lockout, generic throttled messages with retry
  time, security log entries (no account-existence), honeypot + time-to-submit floor for public
  forms.
- **Acceptance:**
  - [ ] Each axis trips independently at the SEC16 defaults; message identical whether or not the
    account exists; backoff escalates per address only
  - [ ] Public form with honeypot filled or submitted under the time floor is rejected with retry
    time, never silently

### R0-06 — i18n framework and "Garden Soirée" design system
- **PRD:** L1–L5, INF8, A12, Q1, Q2, Q8, Q10, section 21
- **Depends on:** R0-01
- **Scope:** next-intl, `ro.json`/`en.json`, ro-RO default, locale formatting (RON, dd.mm.yyyy,
  24h, Europe/Bucharest display of UTC, INF8/L3); `packages/ui` tokens: cream/sage (#fdfefa,
  #dcead1), ink-green #23301f, terracotta #b0674a for attention; Sora/Cormorant Garamond/DM Mono
  with named system fallbacks, self-hosted preferred; 12–18px radius, pill buttons; all targets
  ≥44px; 320px single-column; "Midnight Candlelight" dark/event-day theme; Honest Directory mono
  labels for factual/paid/unknown; unknown rendered italic grey "unknown".
- **Acceptance:**
  - [ ] No user-facing string outside the two locale files (lint rule); diacritics render and are
    searchable; toggle switches wording only (L1, L2)
  - [ ] axe-core clean at 320px on the shell and one form; contrast pairs recorded in the design
    file (design gate, section 21); dark mode switches automatically
  - [ ] Every interactive element ≥44px; every drag in the component library has a tap path (Q8/Q10)

### R0-07 — Public site `eventdesk.ro`
- **PRD:** D1, INF1, LAU1, LAU6 (page shells), section 11 ("For businesses")
- **Depends on:** R0-01, R0-06
- **Scope:** static-export Next.js app: landing, public guides area, "For businesses" page, legal
  pages (Termeni și condiții, Politica de confidențialitate, cookie notice text, accessibility
  statement — content operator-owned per LAU1/LAU6/LAU9), status page with plain-language message.
- **Acceptance:**
  - [ ] Zero cookies set, zero third-party scripts (CI assertion, D1); self-hosted fonts with
    fallback stacks; SPF/DKIM/DMARC documented for the sending domain (LAU3 prep)
  - [ ] Pages exist and are reachable in ro + en

### R0-08 — App shell (`app.eventdesk.ro`)
- **PRD:** Q1, B11 (shell base), LAU1, LAU5
- **Depends on:** R0-01, R0-04, R0-06
- **Scope:** Next.js App Router layout, navigation, auth-guarded routes, error/loading states,
  in-app cookie notice (three cookies, re-shown on cookie-set change, LAU1), health endpoint for
  deploys (DEP4), monitoring hooks + "ceva nu funcționează" guest-facing status (LAU5), PWA
  manifest + service-worker shell (offline shell completed in B-11).
- **Acceptance:**
  - [ ] Lighthouse/PWA: installable manifest present; offline shell serves the app frame
  - [ ] Cookie notice lists exactly session/device-rate-limit/language cookies
  - [ ] Health endpoint responds; unhandled error page shows the plain-language message, no stack

### R0-09 — Security middleware
- **PRD:** SEC5, SEC6, SEC7, SEC10, SEC13
- **Depends on:** R0-02, R0-03
- **Scope:** headers (strict CSP no inline, HSTS, nosniff, referrer same-origin) on app + media +
  public; CSRF on all mutations; SSRF guard util used by worker fetches; CI test asserting headers
  (Q1 release test).
- **Acceptance:**
  - [ ] CI header assertions pass; CSP blocks an injected inline script in a test page (SEC5)
  - [ ] Worker fetch to a private-range URL is blocked; robots.txt honoured (SEC6)
  - [ ] External links rendered with `rel="noopener noreferrer"` (SEC7)

### R0-10 — Object storage and upload pipeline
- **PRD:** INF3, SEC4, Q6, Q9
- **Depends on:** R0-02, R0-03, R0-09
- **Scope:** S3 client, signed upload URLs, image re-encode (sharp), PDF → media domain,
  malware scan before visibility, fair-use counters (100 MiB/occasion, 200 MiB/business, 10 MiB/
  file, formats per Q9), scoped read links.
- **Acceptance:**
  - [ ] Uploaded PNG/JPG re-encoded (metadata stripped, verified by test); PDF served only from
    media domain with attachment+noinline (SEC4)
  - [ ] File becomes visible only after scan pass; over-limit upload names the asset to remove,
    deletes nothing (Q9)
  - [ ] Fair-use counters increment at upload; 500 emails/day enforced before provider call (Q6)

### R0-11 — Email service
- **PRD:** INF2, L5, Q6, LAU3 (config docs)
- **Depends on:** R0-02, R0-03
- **Scope:** provider client (operator-configurable, EU delivery), bilingual RO-first templates
  (L5), suppression list fed by bounce/complaint webhooks, hard-bounce never re-emailed, sign-in
  code email per SEC1 wording, daily limit check before send.
- **Acceptance:**
  - [ ] Sign-in email sends in both languages, states staff-never-ask + unrequested-code warning
    (SEC1); bounced address lands on suppression and is never sent again
  - [ ] Q6 daily email cap enforced server-side

### R0-12 — Worker and job queue
- **PRD:** Q7
- **Depends on:** R0-03
- **Scope:** `jobs` table + leasing (`FOR UPDATE SKIP LOCKED`), single worker process, job
  registry in `packages/jobs`: email send, digest, retention, backup/restore-test, nightly stats
  (INF11), enquiry nudges, discovery, deploy pipeline, webhooks; structured logging; queue-depth
  metric for LAU5 alerts.
- **Acceptance:**
  - [ ] Jobs run at-least-once with idempotent handlers; a killed job resumes
  - [ ] Nightly stats job writes daily aggregates with no visitor identifier (INF11/D4)
  - [ ] Queue-depth and error-rate metrics exposed for alerting (LAU5)

### R0-13 — Staff console skeleton, roles, two-person approvals
- **PRD:** S5, staffing (section 10), W8, W9, SEC10
- **Depends on:** R0-03, R0-04
- **Scope:** six staff roles; staff 2FA mandatory, console session 12h/30min idle (S5); audit log
  viewer with filters + read-only export (W8); approval queue implementing the second-person rule
  and single-operator restricted mode (W9: queued actions have no effect until a second staff
  member exists; live payments blocked — M4); basic dashboard counts (W1).
- **Acceptance:**
  - [ ] Staff account without 2FA cannot reach the console (S5)
  - [ ] Approval-requiring action in single-operator mode queues and has no effect until approved
    (W9); audit log records the mode
  - [ ] Audit log filterable by actor/action/object/date; export is read-only copy (W8, SEC10)

### R0-14 — Deployment pipeline
- **PRD:** W10, DEP1–DEP7
- **Depends on:** R0-02, R0-03, R0-12, R0-13
- **Scope:** GitHub App scoped to the one private repo (DEP1); console deploy UI: live release +
  hash, tags, commits between (DEP2), tag-only selection, second-person approval + emergency path
  (DEP3); deploy job: backup → migrate → release → health checks → auto-rollback (DEP4), manual
  rollback with non-reversible-migration stop (DEP5); audit of every deploy (DEP6); CI-green
  requirement per tag, console refuses otherwise except audited emergency (DEP7); deploys
  disabled while running.
- **Acceptance:**
  - [ ] Deploy of a tag with failing CI is refused in console (DEP7); emergency deploy is
    audit-marked (DEP3)
  - [ ] Failed health check triggers automatic rollback to previous release with reason shown
    (DEP4); rollback never deletes data and stops with a message on non-reversible migration (DEP5)
  - [ ] Deploy history visible with actors, hash, tag, result, duration (DEP6, W10)

### R0-15 — MCP server foundation
- **PRD:** MCP1–MCP8, SEC8, SEC15
- **Depends on:** R0-03, R0-04, R0-12, R0-13
- **Scope:** Streamable-HTTP MCP server at `app.eventdesk.ro/mcp`, Bearer personal tokens (hashed,
  revocable, 30-day inactivity expiry, deleted with account); versioned tool catalogue served by
  the server (MCP8); per-token consent warning before first use naming data classes (MCP4);
  read tools bounded by the user's own grants (MCP2); propose tools bounded by write grants and
  returning a proposal id, never applying (MCP3, SEC15); per-call audit log (MCP1); initial tools:
  `get_occasion`, `list_tasks`, `propose_task_list`, `propose_invitation_text` (release P adds the
  rest); no admin/payment/other-account tools ever (MCP6); external-assistant labelling (MCP5).
- **Acceptance:**
  - [ ] Token works as Bearer; revoked/expired token fails at once; read tool returns only data the
    user can see in the app (test with a finance-less contributor: no budget data, no
    propose_budget) (MCP2, SEC15)
  - [ ] Propose tool creates a `Proposal` in What-if state; nothing changes until in-app confirm
    (MCP3); every call audit-logged; consent warning shown before first use per token (MCP4)
  - [ ] Tool catalogue discoverable from the server; every tool declares scope (MCP8)

### R0-16 — What-if preview engine
- **PRD:** principle 3, goal 2, MCP3
- **Depends on:** R0-03
- **Scope:** generic preview engine: given a proposed change (date move, guest change, supplier
  change, payment move, MCP proposal, cancel/postpone), compute and store a delta (knock-on
  effects on cost/timing/commitments) and apply only on explicit confirmation; applied changes are
  audit-logged.
- **Acceptance:**
  - [ ] Preview shows downstream effects before apply; confirm applies atomically; discard leaves
    no trace besides audit/preview row
  - [ ] Idempotent confirm (double-tap applies once, Q4)

### R0-17 — Legal/compliance scaffolding
- **PRD:** LAU1, LAU2 (hooks), LAU8, LAU9
- **Depends on:** R0-07, R0-13
- **Scope:** legal document pages + in-app links before signup (LAU1); console records for
  ANSPDCP registration + DPIA (content operator-owned, LAU2); DSA notice-and-action intake route
  reusing W3 restriction flow + audit log (LAU8); accessibility statement page ro+en with
  feedback route (LAU9).
- **Acceptance:**
  - [ ] Signup blocked until legal docs published (LAU1); cookie notice per R0-08
  - [ ] Report intake creates an auditable case with reason given to affected party (LAU8)

### R0-18 — Account/occasion deletion with undo
- **PRD:** D6, INF6
- **Depends on:** R0-03, R0-12
- **Scope:** deletion request → 7-day undo → purge per retention table; UI states clearly what is
  retained and why (receipts 7 years, objection records 3 years, audit 2 years).
- **Acceptance:**
  - [ ] Deleted account/occasion restorable within 7 days, gone after; retained categories listed
    in the confirmation; MCP tokens deleted with the account (MCP1)
