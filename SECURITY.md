# Security

**What this is, in plain English.** How to tell the people who run EventDesk.ro about a
security problem, what to expect when you do, and where the project's own security review is.

## Reporting a vulnerability

> **Contact — to be filled in by the operator.** There is no published address yet. Before
> the service goes live, the operator must put a monitored contact here (for example a
> dedicated mailbox, and optionally a `security.txt` file on the public site) and name who
> reads it. No address has been invented in this file.
>
> **Security contact:** _not yet set_

Until a contact is published, if you have access to this repository, report privately to the
repository's owner — not in a public issue, pull request or discussion.

When you report, please include:

- what you found and where (the address, screen or file);
- the steps to reproduce it;
- what an attacker could do with it;
- whether you have told anyone else.

Please do not: access, change or delete data that is not yours; test against real users'
accounts, guest links or listings; run automated scans that degrade the service; or publish
details before a fix is available.

## What to expect

These are intentions for the operator to confirm when the contact is published; they are not
yet a commitment:

- an acknowledgement that the report was received;
- an assessment of severity using the scale in `docs/build/12-security-review.md`;
- a fix released through the normal process — or, for an urgent fix, through the emergency
  deployment path described in `docs/build/14-deploy-runbook.md` (one security administrator,
  recorded in the audit log, reviewed by a second person afterwards);
- credit if you would like it.

## If personal data may have been exposed

Treat it as a personal-data breach. The privacy owner assesses whether the data-protection
authority (ANSPDCP) must be notified within 72 hours. The procedure for a guest-link incident
is in `docs/build/14-deploy-runbook.md`, section 9, and the day-to-day handling of incidents
is in `docs/build/19-operations.md`, section 9.

## Illegal content is a different channel

To report illegal content or an unlawful listing — not a vulnerability — use the report form
in the app (`/report`). Those reports are handled by moderators under the EU Digital Services
Act (`docs/build/19-operations.md`, section 6).

## The project's own security work

- **Security review:** [`docs/build/12-security-review.md`](docs/build/12-security-review.md)
  — scope, findings and their status. It is a code review, not a penetration test.
- **External penetration test:** required before the first guest link is sent (launch
  obligation LAU4). **Not done yet** — it is the operator's to commission.
- **How the security requirements were met:** `docs/build/09-traceability.md`, rows SEC1–SEC16,
  and `docs/build/03-cross-cutting.md`.
- **Automated checks on every change:** security-header assertions
  (`scripts/check-headers.mjs`), a dependency audit that fails on high or critical advisories,
  and the tests listed in `docs/build/11-testing-and-qa.md`. The CI workflow that runs them
  has not yet run on GitHub.

## Supported versions

Nothing has been released. Once releases exist, only the release that is live in production
is supported; fixes are made on `main` and shipped as a new release tag.
