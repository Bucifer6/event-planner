# Changelog

**What this is, in plain English.** A running record of what changed in EventDesk.ro, newest
first, written for people rather than machines. It follows the
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) layout. No version has been released
yet, so everything built so far sits under *Unreleased*. When the first release tag is cut,
the *Unreleased* section becomes that version's entry.

Status and evidence for everything listed here: `docs/build/13-implementation-log.md` and
`docs/build/09-traceability.md`. Nothing below has been deployed.

## [Unreleased]

### Fixed (remaining check items)
- A stranger or signed-out visitor opening someone else's occasion or business now gets a real
  "not found" (HTTP 404), not the not-found page with status 200. The loading skeleton moved
  from the top of the app to inside the occasion, business and account sections, below their
  access checks; a test stops it moving back above them.
- Patched two security advisories in developer-only tools (drizzle-kit's bundled esbuild and
  eslint's minimatch) with dependency overrides; `pnpm audit` is clean.
- The guest-import test no longer fails at random when a generated id or timestamp happens to
  contain "41"; it still proves the age column is never stored.

The first complete build of the product, made on 13–14 November 2026 on the branch
`build/eventdesk-app`, from the requirements in `docs/PRD.md` (v4.9).

### Added — Release 0: foundation

- The repository: one app (`apps/web`), a static public site (`apps/public`), one background
  worker (`apps/worker`) and ten shared packages, on Node 22, Next.js 16, PostgreSQL 16 and
  Drizzle ORM.
- Sign-in by emailed six-digit code or one-tap link; anonymous accounts with a generated
  username, password and recovery codes; sessions with "sign out everywhere"; fresh
  confirmation for sensitive actions; optional two-step sign-in with an authenticator app.
- Rate limiting on three axes for sign-in, and bot protection for public forms without any
  third-party script.
- Security headers with a strict, nonce-based Content-Security-Policy; cross-site request
  checks; a guard against server-side request forgery.
- Uploads: type detection, server-side image re-encoding, a malware-scan gate, a separate
  media origin, fair-use counters.
- Transactional email pipeline with bilingual templates, a suppression list and a daily cap.
- A PostgreSQL job queue with schedules; daily backup and monthly restore-test jobs that run
  the operator's commands.
- The staff console: six roles, second-person approvals, single-operator mode, a read-only
  audit log with export, incidents, operations, the launch checklist.
- The What-if engine: changes are previewed and applied only on confirmation.
- Account and occasion deletion with a seven-day undo; retention rules run nightly.
- An MCP endpoint for external AI assistants with personal tokens.
- Console-driven deployment through a GitHub App, with CI, release and deploy workflows,
  container images, a reference Docker-host target and a reference Terraform description.
- The public site in Romanian and English, with no cookies and no third-party scripts.
- An installable app shell with an offline page.
- The "Maison" design system (`packages/ui`).

### Added — Release A: plan and invite

- Occasions with a date, a date range or a date poll; an event brief.
- Seven planning templates with tasks scheduled backwards from the date; moving the date is a
  previewed change.
- Tasks with owners, due dates, checklists, dependencies and child tasks, in list, board and
  calendar views of the same records.
- Delegation by offer and acceptance.
- Roles, and separate grants for finance and private requests.
- Household invitations by private link, RSVP with custom questions, children recorded only as
  a number.
- Date polls; one shared capacity count; guest contributions ("who brings what").
- Overview and a daily digest; guest list import from CSV or XLSX with a preview; exports.

### Added — Release B: budget and deliver

- Budget by category with estimate, committed, invoiced, paid and forecast kept separate.
- Expenses with receipts; approval and payment as separate states.
- A shared-cost ledger with settlement per currency.
- Supplier records, booking states, versioned briefings acknowledged through a supplier link.
- Final-order snapshots, with later guest changes shown as deltas.
- Deliveries, hired items and returns; payment deadlines.
- Corrections: recorded facts change only through an audited correction, enforced by the
  database.
- Event-day view, readiness decisions, cancel and postpone previews, closeout and lessons.
- A downloadable briefing PDF.

### Added — Release P: businesses

- Business accounts with teams; listings with fixed categories and localities.
- One moderation queue for listings, drawings, parking facts and catalogues.
- Two factual badges; no ratings or testimonials.
- A directory whose order rotates daily and cannot be bought.
- Enquiries with limits, thread states, nudges and PDF quotes.
- Venue drawings with calibration, markings and parking facts; the occasion's space model.
- Flower catalogues and quote requests.
- Business-owned occasions, a shared library, branding, reports and handover to the client.
- Business discovery from public pages and operator-supplied datasets, with human approval,
  claim invitations, claims and objections.
- Listing response statistics as daily facts.
- The monetisation switch (off), dormant billing, invoicing and Featured placement.
- The rest of the console: moderation, businesses, directory, discovery, commercial,
  communications, compliance access, content reports.
- The MCP tool catalogue: 23 tools, read or propose only.

### Added — Release C: celebration

- Seating and layout on the space model with fit checks per meal stage; custom tables.
- Programme, cue lists and guest notices of changes.
- A stationery designer with proofs and print-ready PDFs.
- Menus, meal choices and quantities.
- A public event page with registration and a waiting list.
- Private dietary and access requests; an accessible guest journey.
- Guests see their own table once the seating is published.
- A print pack with QR codes; the guest event page with a navigation link.
- A gift estimator; promotion texts and assets to download; a visual arrangement designer.
- AI wording suggestions, off by default.

### Added — Release D: travel

- Itinerary across time zones with booking import as a preview.
- Subgroups and optional activities; packing lists; transport and rooms.
- Settlement across currencies.

### Added — Release E: operate

- Rehearsal of the day; QR check-in with guest-flow estimates.
- Limited offline capture of arrivals and checklist ticks.
- Optional sustainability goals.

### Fixed — quality and security check (14 November 2026)

- Every page sent the browser the whole message catalogue (about 640 KB of Romanian, admin
  console and help articles included). It now sends only what client components read
  (`apps/web/lib/client-messages.ts`, guarded by a test): the sign-in page goes from 524 KB to
  341 KB.
- The seating and supplier-payment CSV exports had English column names and English
  "+2 children" rows in a Romanian app; they are now in the occasion's language, and the extra
  guests are written so spreadsheets do not prefix them with an apostrophe.
- An occasion kind such as "constructor" sent with a live invitation preview could reach an
  inherited JavaScript property and crash that request; table lookups now accept only their
  own entries (tested).
- Occasion templates were named after their first palette ("Scalloped frame · Cotton candy"),
  which contradicted the colours once another colourway was chosen; they are now named by style
  and number ("Scalloped frame no. 8").

### Added — after the main build (14 November 2026)

- Four more looks for the app — Atelier, Riviera, Jardin and Studio — beside the house look
  Maison, each with a dark version, switchable for everyone from Console → Aspect.
- Eight more looks — Nocturne, Folio, Herbarium, Prism, Salon, Dune, Ledger and Muse — ported
  from the planner-appearance work, as token sets in the same theme system — plus Vellum and
  Lagoon, the planner-appearance versions of Atelier and Riviera under new names (fifteen in all).
- The invitation collections in the stationery designer: 64 more designs in five ranges —
  Romanian embroidery and weaving (16 cross-stitch borders), a signature collection (6),
  rustic (11) and traditional (11) regional editions, and twenty compositions — drawn by the
  same kit, so the proof, the PDF and the proof gate work exactly as for the house designs.
  Each occasion kind has five palettes of its own plus five studio palettes, a small motif,
  and ten starter wordings in Romanian and English. Sources for the regional designs:
  `docs/design/romanian-invitations.md`.
- 24 more occasion kinds (graduation, engagement party, baby shower, housewarming,
  conference, launch, charity gala, reunion, dinner party, exhibition opening, concert,
  workshop, sports tournament, retirement, awards ceremony, festival, birthday, kids'
  birthday, bridal shower, vow renewal, gender reveal, Christmas party, celebration of life,
  networking event), each with a short starter task list, budget categories and directory
  suggestions.
- 52 original invitation templates for every occasion kind (1,664 in all) under "Made for this
  occasion" in the stationery designer: 45 drawn styles (confetti, balloons, art deco fans,
  Bauhaus blocks, terrazzo, snowflakes, laurels, mountains, soundwaves…) in 55 palettes, chosen
  to suit each kind, each with two alternative palettes. A test checks every template on four
  sheet sizes: text stays on the sheet and never sits on top of the artwork.
- An invitation builder for AI assistants (MCP): `list_invitation_designs` (the designs an
  occasion can use, their colours, the text fields and limits, starter wordings, the current
  invitation), `get_invitation_preview` (draws a draft and returns it as a picture with a fit
  report) and `propose_invitation_design` (a proposal the planner confirms; it becomes a new,
  unproofed version with the assistant's wording AI-labelled). The consent screen names the
  new data class, "your invitation designs and their wording".
- The template picker on "New occasion" now works in two steps: choose a group (weddings and
  love, family, parties, trips, work, culture and sport, or blank), then the kind within it.
- `AGENTS.md` (rules for coding agents and new developers), a generated code map (`docs/build/21-code-map.md`, kept current by a test) and `pnpm check`, one command that runs every gate.
- An in-app help centre at `/help`: 60 task-based articles in Romanian and English, search, a
  staff section, and contextual help links on the main screens.
- A deleted account's occasions are handed to their longest-standing project manager, or
  deleted with the account when there is none.
- The security log is erased after 90 days.
- A security review (`docs/build/12-security-review.md`) with fixes and `security-review`
  test files; its own write-up says what was found and fixed.
- Documentation brought in line with the code: architecture, data model, cross-cutting rules,
  traceability, operator decisions, testing, deploy runbook, contracts; new operations guide,
  glossary, this changelog, `CONTRIBUTING.md` and `SECURITY.md`.

### Changed — deviations from the original plan

- The database layer is Drizzle ORM instead of Prisma.
- The design language is "Maison" instead of the PRD's "Garden Soirée" (owner's decision).
- Translations are one file per namespace instead of one file per language.
- The deploy pipeline runs in GitHub Actions instead of as a worker job.

### Known gaps

Not built: passkeys; business-scoped assistant tokens; per-person, per-session attendance;
console publishing of guides and the "For businesses" page; secret rotation dates in the
console; deletion of a deleted account's occasions; purging the audit log after two years.

Prepared but not connected to a real service: email provider, malware scanner, S3 object
store, Stripe, fiscal invoicing, the ONRC data source, an AI text provider.

Never run: the GitHub workflows, the container images, Terraform, the deploy and backup
scripts. Not done: browser end-to-end tests, an accessibility audit, performance and load
tests, testing on real phones.

The full list with evidence is in `docs/build/09-traceability.md`.
