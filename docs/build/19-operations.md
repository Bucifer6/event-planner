# 19 — Operations: running EventDesk.ro day to day

**What this is, in plain English.** A guide for the people who look after the live service:
what each screen of the staff console is for and who may use it, how approvals work, what to
do with a listing waiting for review, a report of illegal content, a person asking for their
data, a failed backup, a bad release. It assumes no programming knowledge.

**Read this first.** The service has not been deployed yet. Everything below describes how the
software is built to behave, checked by automated tests and by reading the code — not
procedures that have been practised on a live system. Practise each one on a staging copy
before you rely on it. Installing and releasing are in `14-deploy-runbook.md`; this file is
about the days after.

## 1. Getting into the console

The console is at `/console` on the app's address. It opens only for an account that

1. has been given a staff role (the first two by `node scripts/make-staff.mjs` on the server,
   later ones in the console), **and**
2. has two-step sign-in switched on (*Cont → Verificare în doi pași*, with an authenticator
   app), **and**
3. signed in using that second step in the current session.

Otherwise you see a short set-up page explaining what is missing, and nothing of the console.

A console session lasts 12 hours and ends after 30 minutes without activity in the console.
It is not reopened: sign in again. People who are not staff get "not found" at `/console`.

## 2. The six roles

One person may hold several roles. Menu entries are hidden from people without the role, and
every page and every action checks the role again on the server.

| Role (in the console) | For |
| --- | --- |
| `platform_admin` | Overall running: staff roles, deployments, most screens |
| `security_administrator` | Incidents, operations, deployments (including emergency ones), sign-in limits |
| `privacy_owner` | Data-subject requests (compliance access), objections, the legal side of the launch checklist |
| `listing_moderator` | Moderation, businesses, directory, discovery, content reports, claims |
| `commercial_manager` | The commercial screen and notices to businesses |
| `content_editor` | Notices to businesses |

## 3. The screens

| Screen (Romanian label) | Path | Who sees it | What you do there |
| --- | --- | --- | --- |
| Dashboard (*Tablou*) | `/console` | all staff | Counts of accounts, occasions, businesses, listings, enquiries, open moderation and reports. Counts only — never anyone's plans |
| Approvals (*Aprobări*) | `/console/approvals` | all staff | Approve or reject other people's requests; cancel your own |
| Audit log (*Jurnal audit*) | `/console/audit` | platform admin, security administrator, privacy owner | Search by actor, action, object, date; export a CSV copy. Nothing can be edited |
| Access (*Acces*) | `/console/access` | platform admin, security administrator | Who is on the staff, with which roles; request a change |
| Incidents (*Incidente*) | `/console/incidents` | security administrator, platform admin | Open and close an incident; set the message guests see |
| Operations (*Operațiuni*) | `/console/operations` | security administrator, platform admin | Last backups and restore tests, job-queue health and alerts, sign-in limits |
| Content reports (*Rapoarte conținut*) | `/console/reports` | listing moderator, platform admin | Decide reports of illegal content |
| Launch (*Lansare*) | `/console/launch` | platform admin, privacy owner, security administrator, commercial manager | Launch checklist LAU1–LAU9, its records, **the publication of the legal documents** |
| Moderation (*Moderare*) | `/console/moderation` | listing moderator, platform admin | Approve or reject listings, drawings, parking facts, catalogues; set the response target |
| Businesses (*Firme*) | `/console/businesses` | listing moderator, platform admin | See a business; restrict or suspend it or a listing; record a badge check |
| Directory (*Director*) | `/console/directory` | listing moderator, platform admin | Categories, counties, localities: add, rename, merge, retire, publish; daily statistics |
| Deployments (*Publicări*) | `/console/deploys` | platform admin, security administrator | Release a new version; roll back (see the runbook) |
| Compliance access (*Acces de conformitate*) | `/console/compliance` | privacy owner, platform admin, security administrator | Time-limited access to one person's records |
| Commercial (*Comercial*) | `/console/commercial` | commercial manager, platform admin | Free-phase dashboard, monthly cost, the monetisation switch and its history |
| Communications (*Comunicări*) | `/console/communications` | commercial manager, content editor | Send a notice to businesses |
| Discovery (*Descoperire*) | `/console/discovery` | listing moderator, platform admin | Discovery sources, drafts, removal requests and objections, claims |

Staff also see a staff section in the in-app help centre (`/help`).

## 4. Approvals: the two-person rule

Anything that cannot be undone, or that changes who holds power, is not done directly. You
**request** it with a reason; **another** staff member approves it under *Aprobări*; only then
does it happen, once. You can never approve your own request.

| Request | Who may ask | Approvals needed |
| --- | --- | --- |
| Change a staff member's roles | platform admin | one other person |
| Change the sign-in limits | security administrator | one other person |
| Deploy to production | platform admin, security administrator | one other person |
| Approve a claim on an unclaimed listing | listing moderator, platform admin | one other person |
| Turn monetisation on or off | commercial manager (see section 11) | one other person |
| Change prices; issue a refund (dormant) | commercial manager | one other person |
| Compliance access to a person's records | privacy owner | **two** other people |

**Single-operator mode.** While only one person holds a staff role, a banner says so. You can
do everything that needs no approval; every request simply waits and has no effect until a
second person exists and approves it. This is deliberate. The way out is to add the second
person with `scripts/make-staff.mjs` on the server — and a third, if compliance access will
ever be needed.

## 5. Moderation

Everything a business publishes — a new listing, an edit, a venue drawing, parking facts, a
flower catalogue — waits in *Moderare*, oldest first, with its waiting time shown against the
response target (48 hours unless you change it on that screen).

- Open an item to see what changed, field by field, and any pictures.
- **Approve** publishes it. **Reject** needs a reason, which the business sees. The business
  can also withdraw a submission.
- While an edit waits, the version already public stays public.
- You cannot decide a submission from a business you are a member of.
- A decision cannot be changed afterwards; the business submits again.

Badges are facts, not judgements: on a business's page under *Firme* you record that you saw
the company's registration or its insurance (valid until a date). Those are the only two
badges that can exist.

To restrict or suspend a business or a listing, use its page under *Firme*, give a reason
(the business sees it and is notified), and restore it the same way. The restriction stays
until someone lifts it.

## 6. A report of illegal content

Anyone can report content at `/report`, with or without an account. Each report gets a
reference.

1. *Rapoarte conținut* lists reports waiting for a decision. Open one.
2. Look at the reported item. If it concerns a listing, the listing's own page under *Firme*
   is where you would suspend it.
3. Decide, and write the **reason given to the affected party** in plain language — the law
   (the Digital Services Act) requires that the business is told why.
4. The decision and reason are recorded. The reporter's contact details, if they left any,
   are erased 183 days after the decision.

Where the contact point for authorities is published, and the registration with ANCOM, are
launch obligation LAU8 — recorded under *Lansare*.

## 7. A removal request or objection from a business

A business that was added by discovery, or anyone on its behalf, can ask for its listing to
be removed or object to it. These arrive under *Descoperire*. Each shows the date it is due —
**30 days** from receipt. Handle it, record what you did, and the record is kept for three
years as evidence. A removed business is remembered (as an unreadable fingerprint) so
discovery never adds it again.

## 8. A person asks for their data, or to be forgotten

**Deletion.** People delete their own account (*Cont → delete*) and owners delete their own
occasions; each has a seven-day undo and states what is kept afterwards and why. You do not
need to do anything.

> **Known gap.** When an account is finally deleted, the occasions it owns are not deleted
> with it. Until that is fixed, ask anyone who requests erasure to delete their occasions
> first, or check for leftover occasions yourself with the help of a developer. See
> `02-data-model.md`.

**A request to see their data (GDPR access request).** Staff cannot browse people's data.
Access is granted for one person, for a limited time, by three people:

1. The **privacy owner** opens *Acces de conformitate*, finds the person, states the legal
   reason and asks for access (24 hours by default, 72 at most).
2. **Two other** staff members approve it under *Aprobări*.
3. For that period the privacy owner — and nobody else — can read that person's records
   through the console and download an export. Every read is written to the audit log. The
   access can be revoked early.

With fewer than three staff members this cannot be completed, by design.

> **Limit of what is built.** The export contains the account's profile and the list of
> occasions it owns. It is not a complete copy of everything about the person. For a full
> answer to an access request you will need a developer to extract the rest from the
> database, under the same recorded grant.

## 9. Incidents

When something is wrong for guests or users:

1. A **security administrator** opens an incident under *Incidente*, with a short message in
   Romanian and English. Write plainly, with no technical detail. Leave it empty to show the
   standard "Ceva nu funcționează" text.
2. The message appears at once on guest-facing pages, in the guest's language.
3. Fix the cause — often a rollback (`14-deploy-runbook.md` §5).
4. Close the incident. The log stays.

If guests could have seen another household's data, treat it as a personal-data breach: the
privacy owner assesses whether ANSPDCP must be notified within 72 hours (runbook §9).

## 10. What to watch

*Operațiuni* is the health page.

| What you see | Healthy | If not |
| --- | --- | --- |
| **Backups** — the last ten runs | One *Succeeded* every day (taken at 02:30) | *Failed*: the backup command returned an error — check the backup bucket, its credentials and disk space. *Skipped*: `BACKUP_COMMAND` is not set. A failed backup means yesterday's is your newest: fix it the same day |
| **Restore tests** — the last six runs | One *Succeeded* each month (1st, 04:30) | A failed restore test means you do not know whether your backups are usable. Run it by hand (runbook §7) until it passes |
| **Waiting now** | Near zero | Growing: the worker is stopped or overloaded. Check that the worker is running |
| **Oldest due job** | Seconds | Over 15 minutes raises an alert |
| **Failed in the last hour / error rate** | Zero or close | High: something the jobs depend on is down — usually email |
| **Failed for good** | Zero | Jobs that failed five times are parked. They need a developer to look at the logs |
| **No snapshot** | — | The worker writes the queue state every minute; no snapshot means it is not running |

Alerts (too many jobs waiting, high error rate, a job waiting too long) are also sent to the
alert channel if one is configured (`OPS_ALERT_WEBHOOK_URL`). Point an outside monitor at
`/api/health` as well: it answers "ok" with the release version, or an error if the database
cannot be reached.

The dashboard counters and *Jurnal audit* are the other two things worth a look each day:
the open moderation queue, open reports, and anything unexpected in the audit log (role
changes, emergency deploys, compliance access).

## 11. Turning monetisation on — and why it is off

**It is off, and the product is free for everyone.** While it is off no price, checkout or
card form is reachable, and the directory shows no paid placement at all. This is the PRD's
launch state: businesses were promised a free phase, and paid features must not appear before
the service has proved useful (gates M2 to M4).

**Do not turn it on yet.** The payment and invoicing parts are written but have never been
connected to Stripe, an invoicing provider or ANAF; there is no adapter for SmartBill or
Oblio. Turning the switch on is the *last* step:

1. Choose and connect the payment processor and the fiscal-invoicing provider (developer work
   plus the settings in `10-operator-decisions.md`).
2. Run the whole flow in test mode with real sandbox accounts and record the acceptance
   under *Comercial*. The switch refuses to move without a recorded acceptance.
3. Confirm the prices (the 199 / 1.990 / 149 RON figures are placeholders) — by approval.
4. Publish the business terms (LAU6).
5. Request the switch under *Comercial*; a second person approves. This starts a **60-day**
   public notice, with reminders to businesses at 60, 30 and 7 days. Nothing is charged
   automatically; a business that does nothing keeps the free tier permanently.
6. In single-operator mode, live payments are blocked.

The *Comercial* screen also shows the free-phase dashboard. Enter your real monthly fixed
cost there; until you do, 20,000 RON is shown and marked as a placeholder.

## 12. Deployments and rollback

In one paragraph; the full procedure is `14-deploy-runbook.md` §5. Under *Publicări* you pick
a release tag, read what changed, give a reason and request it; a second person approves; the
pipeline backs up the database, updates it, switches to the new version and checks its
health, going back automatically if the checks fail. One person can roll back to the previous
release. A security administrator alone can make an emergency deploy, which is marked as such
in the audit log and must be reviewed by a second person the next working day.

## 13. Backups and the restore test

Backups are encrypted before they leave the server, with a key whose private half is kept
somewhere else, by two custodians. A daily backup and a monthly restore test run by
themselves once configured; their results are on *Operațiuni*. The restore procedure, and how
to rotate the backup key without losing old backups, are in the runbook §7. Recovery targets:
at most 24 hours of data lost, service back within 4 hours — **targets, not measurements,
until you have done a restore**.

## 14. Rotating secrets

At least once a year, and whenever someone with access leaves. Change the value in the secret
store, then restart the service (on the reference host: deploy or roll the current release).

| Secret | Effect of changing it |
| --- | --- |
| `SESSION_SECRET` | Everyone is signed out |
| `GITHUB_APP_PRIVATE_KEY` | Create a new key in the GitHub App, then delete the old one |
| `DEPLOY_RECORD_TOKEN` | Change it in the secret store **and** in the GitHub environment at the same moment |
| Email, object-store and registry credentials; `DEPLOY_SSH_KEY` | None for users |
| Backup key pair | Follow the runbook: restore an old backup with the old key **before** retiring it |

The console has no place to record rotation dates yet; keep them in your own log.

## 15. When something a feature depends on fails

| What failed | What users notice | What the software does | What you do |
| --- | --- | --- | --- |
| **Email provider** | Sign-in codes, invitations and digests do not arrive. People who are already signed in carry on; nobody new can sign in by email | The sign-in screen looks the same whether or not the email left (by design, so it does not reveal which addresses have accounts) — the code simply does not arrive. Emails sent by background jobs are retried up to five times with growing waits, then parked | Check the provider's status and your credentials. Open an incident if sign-in is affected. Anonymous accounts can still sign in |
| **An address bounces or complains** | That person stops receiving email | The address goes on the suppression list and is never emailed again | Nothing. Do not remove it without the person's request |
| **Malware scanner** | Uploads are refused with a plain message. Everything else works | A file is never made visible without a clean scan; in production nothing is accepted while the scanner is unreachable | Restore the scanner. Do not switch scanning off |
| **Object store** | Uploads fail; pictures, receipts and drawings do not open | Pages still load; the data in the database is unaffected | Check the store's status and credentials |
| **Database** | The app shows "Ceva nu funcționează" | `/api/health` reports an error; your monitor alerts | This is an incident: runbook §7 and §8 |
| **Worker stopped** | Nothing at first; then digests, reminders, nudges and notices stop, deleted data is not purged | Jobs wait in the queue and run when the worker returns | Restart the worker; watch *Waiting now* fall |
| **PDF tool missing on the server** | A venue cannot calibrate a PDF drawing | The PDF is stored; pictures (PNG, JPG) still work | Install poppler on the web host (the provided image has it) |

## 16. Routine

A suggested rhythm; adjust to your team.

- **Every working day:** the dashboard; *Moderare* (nothing older than the target);
  *Rapoarte conținut*; *Aprobări*; *Operațiuni* (yesterday's backup, queue alerts).
- **Every week:** removal requests and objections close to their 30-day date; the audit log
  for role changes, emergency deploys and compliance access.
- **Every month:** the restore test result; discovery runs and drafts.
- **Every year, and when someone leaves:** rotate secrets; rotate the backup key; review who
  holds which role; review the launch checklist records.

## Changing the look of the app

**Console → Aspect** (platform administrator). Pick one of the five looks and press
"Aplică aspectul". Everyone sees it on the next page they open; other web servers follow
within about 15 seconds. It changes appearance only and can be changed back at any time. The
change is recorded in the audit log. Printed stationery, emails and the public marketing site
are not affected.
