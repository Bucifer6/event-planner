# 07 — Release P: serve businesses (work items)

> **How to read this file (added after the build).** This is the original work-item
> specification, written as a plan before any code existed and kept as the record of scope.
> The work described here has since been built; it is not a description of the final code.
> Where it names a tool that was not used in the end, read it like this: *Prisma* → Drizzle ORM
> (`15-conventions.md`); *Playwright*, *axe* and *k6* → not set up, see what is and is not
> tested in `11-testing-and-qa.md`; *Garden Soirée* → the "Maison" design language
> (`16-design.md`). What was actually built and verified: `13-implementation-log.md`;
> requirement by requirement: `09-traceability.md`.

Outcome (PRD section 6): business accounts, directory and listings, discovery and admin console,
venue drawings and flower catalogues, enquiries, dormant monetization switch. P depends only on
A and B. Gate M2: acceptance tests pass, billing in test mode, monetization switch OFF, business
terms published, fiscal invoicing tested end-to-end in sandbox.

### P-01 — Business accounts and listings
- **PRD:** P1, P2, P29 (account side), P30
- **Depends on:** R0-04, A-05
- **Scope:** business account (email required), up to 5 listings, each 1–5 of the 21 fixed categories
  (P2 list, ro names + en toggle) and 1–20 localities across ≤5 counties; geography as fixed picklists
  (41 counties + Bucharest, locality second picklist, no free text); launch areas Bucharest/Ilfov +
  Cluj proposed (operator confirms).
- **Acceptance:**
  - [ ] Listing creation validates category/county/locality against seeded picklists; free text
    rejected
  - [ ] 21 categories exactly as P2, in ro with en toggle

### P-02 — Moderation workflow
- **PRD:** P3, W2
- **Depends on:** P-01, R0-13
- **Scope:** every listing revision (incl. drawings, catalogue items) queued; approver must not be a
  member of that business; live version stays up while pending; queue shows waiting time vs the
  moderation target (operator-set SLA, `10-operator-decisions.md`).
- **Acceptance:**
  - [ ] Pending revision leaves live listing unchanged; approval by a business member is rejected;
    second-person approval enforced (R0-13 queue)

### P-03 — Factual badges
- **PRD:** P4
- **Depends on:** P-02
- **Scope:** only "Verificat: înregistrare ONRC" and "Verificat: asigurare văzută până la <data>";
  no generic "Verified"; checks free.
- **Acceptance:**
  - [ ] Only the two badge types render; no other badge string exists in the codebase (grep test)

### P-04 — Directory search, organic rotation, public pages
- **PRD:** P5, P6, P7, D4, INF11
- **Depends on:** P-01, P-02
- **Scope:** in-app "Găsește firme" pre-filled from the occasion; public directory pages per
  category × county (+ locality where supply justifies); organic order rotates daily and payment
  cannot change it (P5); one dismissible "Vezi firme de <categorie> în <zona>" link on relevant
  tasks, names no business, switchable per account/occasion (P7); statistics are daily aggregates,
  no visitor identifiers (D4/INF11).
- **Acceptance:**
  - [ ] Same search returns a daily-rotated organic order; no payment field influences it (test +
    code review note)
  - [ ] Public pages render per category/county in ro+en; the task link is dismissible and names no
    business

### P-05 — Enquiries
- **PRD:** P8–P11, P33, F5 (flow), D3
- **Depends on:** P-04, B-04, R0-11
- **Scope:** free enquiry with editable pre-filled fields (occasion kind, date, ~guests, county/
  locality, optional budget band, message); nothing else shared; planner email only if ticked (P9);
  creates/reuses supplier record + booking so the thread sits in the plan (P10, B4); limits 10 per
  occasion + 30 per account per day, flower quote requests count against both (P11); either side can
  close/report; planner sees Sent(date)/Awaiting/Answered/Closed — unanswered shows "sent <date>";
  close or re-send once after 7 days without a duplicate thread (P33); business notified on arrival
  (email in listing language, L4) + one 48h nudge (P32, off switch for the nudge only).
- **Acceptance:**
  - [ ] Enquiry thread appears in the plan's supplier record; limits enforced server-side; 11th
    enquiry refused with clear message
  - [ ] Planner email absent unless ticked; business sees only what P8 lists (D3)
  - [ ] State machine renders as specified; re-send after 7 days reuses the thread; nudges stop
    after the second

### P-06 — Venue drawings and space model
- **PRD:** V1–V11
- **Depends on:** P-01, P-02, R0-10
- **Scope:** upload per space (PNG/JPG/PDF ≤ Q9 limits) with stated real dimensions (V1); mark
  available floor areas + standard table inventory with real dims and counts (V2); moderated with
  the listing (V3); readable by listing viewers and active bookers (V3); booking pulls the drawing
  into the plan as the occasion's space model with visible version + effective date — later updates
  arrive as a proposed change the planner accepts, never a silent overwrite (V4); custom tables with
  own name/dims marked "custom", never venue-supplied (V5); unknown dims shown unknown and excluded
  from fit checks (V6); **two-point calibration derives scale before markings are accepted; without
  calibration the drawing is stored but unusable for space models/fit checks (V7)**; POIs (toilets,
  garderobă, bar, entrances/exits, photo corner, stage) and named fixtures (dance floor, candy bar,
  photo cabin, scenă) with real dims participating in fit checks (V8); read-only guest space view from
  the same model (V9); parking facts each known/unknown, "no parking on site" stated explicitly
  (V10); parking areas drawn to scale with matching counts, mismatch → unknown until confirmed
  (V11).
- **Acceptance:**
  - [ ] Uncalibrated drawing cannot be attached to a space model or used in fit checks (V7)
  - [ ] Drawing update on a booked venue arrives as a What-if proposal to the planner; no silent
    overwrite (V4)
  - [ ] Custom tables render dashed/"custom"; unknown dims excluded from fit checks and shown as
    unknown (V5, V6)
  - [ ] Guest space view shows POIs only, no editing (V9); parking facts render known/unknown, never
    blank-guessed (V10, V11)

### P-07 — Flower catalogues and quote flow
- **PRD:** F1, F2, F5, F6 (designer UI ships in release C)
- **Depends on:** P-01, P-02, P-05
- **Scope:** florist/styling business publishes catalogue (variety, image, seasonality, indicative
  price per stem/bunch, colours), moderated with the listing (F1), readable from listing and in-app
  directory, reusable across the business's occasions (F2); from a design (C) or an uploaded photo/
  sketch with notes (F4), the planner sends a quote request through the enquiry flow carrying only
  arrangement + occasion date + ~guests + message, email only if ticked (F5); business replies with a
  PDF quote (P12); accepted quote lands in supplier record + budget, design and quote linked as
  versions so later changes show as deltas (F6).
- **Acceptance:**
  - [ ] Quote request carries exactly the F5 fields; counts against both enquiry limits (P11)
  - [ ] Accepted quote appears in the supplier record and budget; design↔quote version link renders
    deltas (F6)

### P-08 — Business occasions, team, branding, handover, lapse
- **PRD:** P17–P23
- **Depends on:** A-01, A-05, P-01
- **Scope:** business-owned occasions with full planning features, creatable by any active member
  (P17); team roles owner/admin/staff, admin cannot create/remove admins (P18); shared libraries of
  templates/checklists/supplier contacts + shareable assets (P19); logo/name/accent colour on guest
  pages of business occasions (P20); dashboard/reports across occasions incl. asset usage as daily
  totals without visitor identifiers (P21, D4); handover to client ends branding + business access,
  keeps history — business MCP tokens stop at handover (P22, MCP7); on plan lapse, existing occasions
  stay fully usable, only new business occasions/branding/library edits stop, drawings+catalogues in
  live plans stay readable (P23, principle 8).
- **Acceptance:**
  - [ ] Admin cannot promote another admin (P18); handover revokes business-side access incl. MCP
    tokens, history retained (P22, MCP7)
  - [ ] Simulated lapse leaves existing occasions and in-use assets working (P23)

### P-09 — Business discovery
- **PRD:** BD1–BD7, W5
- **Depends on:** P-01, P-02, R0-09, R0-12, R0-13
- **Scope:** discovery from lawful public sources (ONRC public data, business's own published pages,
  licensed datasets under operator contract) with SSRF guard + robots.txt (SEC6); creates
  **unclaimed draft listings** (name, category guess, county/locality, public contact route, source
  URL + collection date) — never live, never public until approved (BD2); dedup by name/address/
  public identifiers, suspected duplicates queued for humans, never auto-merged (BD3); moderator
  approves drafts → live minimal factual listing labelled "Adăugat de EventDesk — nefiind revendicat
  încă", source cited in the moderation record (BD4); unclaimed listings show the published contact
  route + "This listing isn't claimed yet", receive no enquiries/quotes/Featured/uploads (P29); single
  claim invitation by email to the published address only, none if no public email, stating who
  added it, how to claim/correct/remove (BD5); no marketing to discovered contacts ever; removal/
  objection honoured ≤30 days and recorded (BD6, 3-year retention); console config per source with
  rate limits + kill switch; every run logged (BD7, W5).
- **Acceptance:**
  - [ ] Drafts invisible publicly until approved; approved unclaimed listing shows the label +
    contact route and rejects enquiries (P29)
  - [ ] Exactly one claim invitation sent, only to a publicly listed email; objection honoured and
    recorded within 30 days (BD5, BD6)
  - [ ] Kill switch stops a source immediately; run log shows source/items/drafts/duplicates (BD7)

### P-10 — Listing claiming
- **PRD:** P29, P30
- **Depends on:** P-09, R0-04, R0-11, R0-13
- **Scope:** claim proves ownership: code emailed to the published contact address; if no public
  email, a ListingModerator verifies against the public source and records the check; approved claim
  converts to a normal claimed listing with full features (P30); verification needs second person
  (W9 queue).
- **Acceptance:**
  - [ ] Wrong code fails generically; correct code + approval converts the listing; moderator
    verification path records the check against the source

### P-11 — Listing response statistics
- **PRD:** P31
- **Depends on:** P-05, R0-12
- **Scope:** claimed listing with ≥10 answered enquiries shows computed share-answered + median reply
  time as daily-verified facts; no stars, no testimonials, payment cannot influence; listing may hide
  them.
- **Acceptance:**
  - [ ] Stats computed nightly from events only (INF11); hide toggle works; no rating UI exists

### P-12 — Monetization switch, dormant billing (build, do not enable)
- **PRD:** MON1–MON5, P24–P28, PAY1–PAY5
- **Depends on:** P-01, R0-12, R0-13
- **Scope:** at launch everything free, no pricing/checkout/card UI anywhere (MON1); directory shows
  organic only, Featured does not exist (MON5); console free-phase cost dashboard (W6). Built but
  dormant: Stripe Billing integration in test mode, features switch only from verified webhook
  (P24); Apple Pay → Google Pay → card order, BT Pay out of scope (PAY1/PAY2); 14-day grace, cancel at
  period end (P25); refunds/credits second-person (P26); fiscal invoicing via SmartBill/Oblio webhook
  → RO e-Factura, TVA shown separately, prices excl. TVA (PAY3/PAY4); switch ON needs billing
  acceptance in test mode + second-person approval + 60-day notice with 30/7 reminders (MON2–MON4,
  P28); permanent free tier defined (P23).
- **Acceptance:**
  - [ ] Grep + e2e: no checkout/pricing/card-entry route reachable while switch OFF (MON1)
  - [ ] Webhook-driven grant flips a feature flag only after signature verification (P24); browser
    redirect alone changes nothing
  - [ ] Switch ON attempt without test-mode billing acceptance is refused (MON4); with approvals it
    records history + notice dates (MON2)
  - [ ] Sandbox: test invoice generated via e-Factura-connected provider with TVA line (PAY3/PAY4),
    tested end-to-end (gate M2)

### P-13 — Featured placement (built, inactive while MON OFF)
- **PRD:** P13–P16
- **Depends on:** P-04, P-12
- **Scope:** up to 3 Featured cards above organic, random per request from live matching items (P13);
  labels "Promovat — plasare plătită" (en: "Featured — paid placement") in the same weight as the
  business name (P14, design gate); pre-purchase view: expected share min(1, 3÷(n+1)) + last 30 days
  of searches in its categories/counties, no guarantee (P15); Featured never in plans, guest pages,
  emails, exports, offline packs (P16).
- **Acceptance:**
  - [ ] While MON OFF: zero Featured cards rendered anywhere (MON5)
  - [ ] With MON ON in test mode: cards labelled verbatim, random rotation, organic order untouched;
    label legible at phone width (design gate); export/plan/guest-page tests assert absence (P16)

### P-14 — Admin console (full)
- **PRD:** W1–W10
- **Depends on:** R0-13, R0-14, P-02, P-09, P-12
- **Scope:** W1 platform dashboard (counts/broad status only — never planner content); W2 moderation
  queue with service-target timer; W3 business suspend/restrict with recorded reason, survives staff
  session end, business notified in-app; W4 directory management (categories/counties/localities
  create-merge-rename-retire, publish/unpublish pages, per-category/county daily stats without
  visitor identifiers); W5 discovery management (run/pause/configure, batch review with one recorded
  reason per batch); W6 commercial (monetization switch + notice history + free-phase cost dashboard;
  when ON: approve/reject subscriptions, credits/refunds, price changes — all second-person);
  W7 communications to businesses only, never to planner-entered contacts; W8 access management +
  audit log + compliance access needs three people; W9 single-operator restricted mode; W10
  deployments (R0-14).
- **Acceptance:**
  - [ ] Each W item has a working console screen + server-side enforcement test
  - [ ] W3 restriction survives staff logout; business sees status in-app; W8 three-person rule for
    compliance access enforced

### P-15 — MCP tool expansion for P
- **PRD:** MCP2, MCP6, tool catalogue
- **Depends on:** R0-15, P-04, P-06, P-07, P-05
- **Scope:** add read tools `get_budget_summary` (finance grant required), `get_space_model`
  (geometry, not raw image), `list_catalogues`, `get_rsvp_summary` (counts, not identities without
  guest-list access), `search_directory` (returns the directory's own order + labels verbatim —
  Featured items arrive labelled, never reordered/boosted), `get_listing`; propose tools
  `propose_budget` (estimates labelled), `propose_supplier_shortlist` (planner-side note only, notifies
  nobody), `propose_seating_layout` (fit-checked vs V6), `propose_custom_table`,
  `propose_arrangement_design` (indicative cost), `propose_budget_note`; still no payments/admin/
  enquiry-sending/other-account tools (MCP6); propose tools bounded by write grants (SEC15).
- **Acceptance:**
  - [ ] `search_directory` returns identical ordering/labels to the in-app directory (D3); a Featured
    item arrives labelled, and the tool cannot reorder it
  - [ ] `propose_supplier_shortlist` creates only a plan note; no notification sent
  - [ ] Guest-role token cannot call `propose_task_list`; contributor without finance cannot call
    `propose_budget` (SEC15)

Release P exit: gate M2 acceptance tests pass; business terms published quoting Featured rules
(LAU6); fiscal invoicing tested end-to-end in sandbox; monetization switch OFF in production (M3
prep); 20 approved listings per promoted category × county before free-phase launch (M3).
