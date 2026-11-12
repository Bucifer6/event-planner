# 12 — Security review brief (for a cybersecurity agent)

This file is the handoff note for a security-focused coding agent reviewing EventDesk.ro. Read
`README.md` (invariants), `01-architecture.md`, `03-cross-cutting.md` and `02-data-model.md`
first. The PRD (v4.9) already did a security review and produced SEC1–SEC16, INF1–INF12, DEP1–DEP7
and LAU1–LAU9 — your job is to **verify the implementation matches them and to hunt for what the
paper review missed**. The PRD wins conflicts; report, don't silently "fix" spec-level behaviour.

## Working rules for the reviewer

- Review is read-mostly: open findings as issues/PRs with a repro; never paste real secrets, tokens or
  user data into reports (SEC8, SEC13). Use seeded test accounts only.
- Every finding gets: surface, PRD ID, severity, repro steps, impact, suggested fix, and the test
  that would have caught it. Template at the bottom.
- Never weaken a guard to make a test pass (e.g., loosening CSP, removing rate limits). If a
  control blocks legitimate UX, propose the narrow change in the finding.

## Surfaces in scope

1. Public site `eventdesk.ro` — no cookies, no third-party scripts (D1); self-hosted fonts; status page.
2. App `app.eventdesk.ro` — auth, sessions, occasions, tasks, budget, guest links, uploads, exports,
   PWA/offline, MCP endpoint `app.eventdesk.ro/mcp`.
3. Guest/invitation links — scoped, ≥128-bit hashed tokens (S6, SEC2, SEC8), per-link rate limits.
4. Media domain `media.eventdesk.ro` — untrusted PDFs, attachment+noinline (SEC4).
5. Uploads — image re-encode, malware scan before visibility, fair-use accounting (INF3, SEC4, Q6/Q9).
6. Worker jobs — email, digests, retention, backups, nightly stats, discovery crawler (BD1–BD7),
   deploy pipeline (DEP1–DEP7), webhooks (Stripe/e-Factura, dormant).
7. Staff console — six roles, two-person approvals, single-operator restricted mode, append-only
   audit (W1–W10, S5, SEC10).
8. MCP server — tokens, tool catalogue, propose-only writes (MCP1–MCP8, SEC15).

## Checklist: what to verify, where it lives, what proves it

| PRD | Verify | Proof to look for |
| --- | --- | --- |
| SEC1 | Sign-in identical for existing/non-existing accounts; codes single-use, newer invalidates older; emails carry the staff-never-ask warning | security tests + timing-band test |
| SEC2 | Guest tokens ≥128-bit, hashed, revocable, optional expiry, per-link rate limit; link shows only its household | integration tests, DB schema check |
| SEC3 | Session list + sign-out-everywhere revokes sessions **and** MCP tokens; email change does too | e2e + job test |
| SEC4 | Images re-encoded (metadata stripped); PDFs only from media domain, attachment+noinline; scan before visible | upload pipeline tests |
| SEC5 | Strict CSP (no inline), HSTS, nosniff, referrer same-origin; CSP tested every release | CI header assertions |
| SEC6 | CSRF on all mutations; SSRF guard on every fetch (private/link-local blocked, size/time caps, robots.txt) | negative tests incl. 127.0.0.1/169.254.169.254/file:// |
| SEC7 | External links `rel="noopener noreferrer"` | DOM assertions on guest pages |
| SEC8 | Codes/tokens hashed only; UI shows ≤ last 4; staff can't read them | DB + console test |
| SEC9 | Backup key rotation tested by restoring a pre-rotation backup | job log + test |
| SEC10 | Audit log append-only at DB level (UPDATE/DELETE fail); exports read-only | DB-level test |
| SEC11 | Public forms: per-IP/per-link limits, honeypot, time floor, retry time shown, no third-party CAPTCHA | bot tests |
| SEC12 | Cookies Secure/HttpOnly/SameSite=Lax; server-side revocable; nothing security-relevant in localStorage | header + storage scan tests |
| SEC13 | Secrets only in secret store; never in repo/logs/build output; rotation dates in console; annual rotation | grep CI + console test |
| SEC14 | Consumed one-tap link still allows the code; consumed page offers one rate-limited new code | e2e |
| SEC15 | MCP propose tools bounded by write grants, not just read grants; every proposal records its token | MCP tests with a finance-less contributor and a guest-role token |
| SEC16 | Rate limits on all three axes (email/IP/device cookie); generic messages; escalating backoff, no lockout; security log without account existence | trip tests per axis |
| S1–S8 | Code rules (INF4: 15 min, 5 attempts, 3/hour, 10/day), anonymous Argon2id accounts, recovery codes, sessions 30d/14d-idle, S4 fresh code ≤10 min, S5 staff 2FA + 12h console | auth integration/e2e suite |
| D1–D6 | No third-party script on public site; grants enforced in `packages/core` on every read/write; no visitor identifiers in stats; retention per INF6; deletion 7-day undo | automated checks + worker tests |
| MCP1–MCP8 | Token lifecycle (revocable, 30-day inactivity, deleted with account); propose-only; consent warning per token; per-call audit; no admin/payment/other-account tools; directory tool returns labels verbatim | MCP test suite |
| DEP1–DEP7 | GitHub App scoped to one repo; tag-only deploys; second-person; backup→migrate→release→health→auto-rollback; CI-gated tags; emergency path audit-marked | deploy drill tests |
| MON/PAY | While switch OFF: no checkout/pricing/card UI reachable; Featured absent; feature grants only from verified webhooks | grep + e2e + webhook tests |

## Vulnerability classes to actively hunt (beyond the checklist)

- IDOR / scope escape on every object route: occasions, tasks, budgets, invitations, drawings,
  catalogues, enquiries, proposals, console objects — try cross-account and cross-role access in
  tests (D2, SEC2, SEC15).
- Money: double-posting, negative amounts, currency confusion, rounding; idempotency-key reuse across
  different payloads (Q4, B1–B3, release blockers).
- Race conditions: capacity last place, contribution last units, moderation double-approval, claim
  double-approval, deploy double-run (A8, A9, W9, DEP6).
- Upload abuse: polyglots, decompression bombs, oversized files, scan-bypass via content-type
  confusion (SEC4, Q9).
- Injection: SQL via Prisma raw queries (forbid raw SQL; if needed, parameterized only), XSS via
  stored content in guest pages/emails/exports, template injection in email templates (SEC5, L5).
- SSRF in discovery crawler and any URL-fetching job, incl. redirect chains and DNS rebinding (SEC6).
- Token/link leakage: logs, error messages, emails, referrer headers, browser history (SEC7, SEC8).
- Auth logic: timing oracles, code brute force beyond limits, magic-link prefetch, session fixation,
  logout CSRF (SEC1, SEC12, SEC14, SEC16).
- Auditability: any path that mutates facts without a Correction row or audit entry (principle 4,
  SEC10).
- Supply chain: dependency audit, lockfile integrity, build reproducibility, no secrets in build
  output (SEC13, DEP7).

## Severity triage (aligns with PRD §12 release blockers)

| Severity | Definition | Gate |
| --- | --- | --- |
| Blocker | Unauthorised access, duplicate money posting, unexplained overbooking, lost approved records, wrongly reversed facts | Release blocked until fixed + regression test |
| Critical | Auth bypass, token/secret leakage, XSS on app origin, SSRF, audit-log tampering, scope escape on private data | Release blocked; fix before any guest link (LAU4) |
| High | CSRF on state change, rate-limit bypass, upload scan bypass, referrer leak of scoped URLs | Fix before release; may defer only with operator sign-off recorded |
| Medium | Missing header hardening, enumeration via timing, weak validation | Fix in current or next release |
| Low | Hardening gaps, logging noise | Backlog |

## Definition of a secure release

No open Blocker/Critical/High findings; the checklist above green in CI; the external penetration
test (LAU4, operator-run, repeated after changes to sign-in, guest links or MCP) completed with
critical/high fixed before the first real guest link; secrets rotation dates current (SEC13);
two-person rule verified on all approval paths (W9).

## Finding template

```
Title: <short>
Surface: <public site | app | guest link | media | worker | console | MCP | deploy>
PRD refs: SECx / Sx / Dx / MCPx / ...
Severity: Blocker | Critical | High | Medium | Low
Repro: <steps, seeded accounts only — no real data, no secrets>
Impact: <what an attacker gains>
Suggested fix: <code-level direction>
Test that would catch it: <name + layer>
```

## Out of scope for the reviewer (operator obligations, LAU1–LAU9)

Legal documents and ANSPDCP/DPIA formalities (LAU1/LAU2), email-domain warm-up (LAU3), running the
external pen test itself (LAU4 — coordinate with SecurityAdministrator), business terms (LAU6),
runbook (LAU7), DSA registration/reporting (LAU8), accessibility statement (LAU9). Verify the
*software* side of these (e.g., cookie notice lists exactly the three cookies, DSA intake route
works and is audit-logged) but do not review legal content.
