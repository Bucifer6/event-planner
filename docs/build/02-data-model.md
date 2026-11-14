# 02 — Data model, as built

**What this is, in plain English.** The list of everything the database stores: every table,
grouped by the part of the product it belongs to, with one line on what it is for. After the
tables come the rules the database itself enforces (so a mistake in the app cannot overwrite
a payment or an audit entry), the conventions for money, time and ids, and — important for
privacy — what is deleted when, and what is deliberately kept.

**How it was produced.** The table list was generated from the schema files
(`packages/db/src/schema/*.ts`, 46 files) and checked against the committed migration
(`packages/db/drizzle/0000_eminent_the_stranger.sql`): both contain **167 tables**. Purposes
come from the comments in the schema files. Column lists here name only the columns that
matter for understanding; the schema file is the authority for the rest. The database layer
is **Drizzle ORM** on PostgreSQL 16 — the original plan said Prisma (`15-conventions.md`
explains the change).

## Conventions

- **Ids** are random `cuid2` text values from `newId()` — never sequential (SEC2).
- **Tokens and codes** (sessions, sign-in codes, guest, supplier, invitation and MCP tokens)
  are stored only as SHA-256 hashes (`hashToken()`); the readable value exists once, in the
  link or email (SEC8).
- **Time**: `timestamp with time zone`, always UTC (INF8). A "day" of an occasion is stored
  as noon local time in the occasion's zone. Display is Europe/Bucharest.
- **Money**: whole minor units (bani) in `integer`/`bigint` columns plus a `currency` text
  column (default `RON`). Never a floating-point number.
- **Unknown is `NULL`**, never 0 (principle 5). An unknown price, dimension or count stays
  `NULL` and is shown as "necunoscut".
- **Names**: tables `snake_case` plural; columns `snake_case`; TypeScript properties camelCase.
- **Enumerations** are `text` columns with a TypeScript union and a zod enum exported from the
  schema file (there are no PostgreSQL enum types); several also carry a `CHECK` constraint.
- **Children are never rows.** `rsvp_responses.children_count`, `check_ins.children_arrived`
  and `public_registrations.children` are numbers; there is no child name, age or any other
  child field anywhere (PRD A6).
- **Schema changes**: edit the schema file, run `pnpm db:generate` to produce a migration in
  `packages/db/drizzle/`, commit it. `pnpm db:migrate` applies migrations and then the SQL
  guards. `pnpm db:push` copies the schema straight to a local database and is for
  development only.

## Tables by domain

### Accounts and sign-in — `accounts.ts` (14)

| Table | Purpose | Key columns |
| --- | --- | --- |
| `accounts` | A person's account, email-based or anonymous | `kind`, `email`, `username`, `password_hash` (Argon2id, anonymous only), `locale`, `deletion_requested_at`, `deleted_at` |
| `sessions` | Signed-in sessions; server-side revocable | `account_id`, `token_hash`, `last_seen_at`, `expires_at`, `revoked_at`, `fresh_auth_at`, `second_factor_pending` |
| `sign_in_codes` | Six-digit codes for sign-in and fresh confirmation | `email_hash`, `purpose`, `code_hash`, `attempts`, `expires_at`, `used_at`, `invalidated_at` |
| `magic_links` | The one-tap link that travels with a code | `sign_in_code_id`, `token_hash`, `used_at`, `resend_used_at` |
| `recovery_codes` | Ten single-use recovery codes | `code_hash`, `last_four`, `used_at` |
| `totp_secrets` | Authenticator-app secret (encrypted) | `secret_enc`, `enabled_at`, `last_used_step` |
| `passkey_credentials` | **Unused.** Table for the passkey seam; no code writes it | — |
| `rate_limit_buckets` | Fixed-window counters per scope and axis | `scope`, `axis`, `key_hash`, `window_start`, `count` |
| `rate_limit_backoffs` | Escalating wait per address, never a lockout | `strikes`, `blocked_until` |
| `security_log` | Security events; hashed keys only, never whether an account exists | `event`, `scope`, `axis`, `key_hash` |
| `email_outbox` | One row per send attempt. Only the `dev` transport keeps the message body | `to_email`, `template`, `status`, `provider_message_id` |
| `email_suppressions` | Addresses never to be emailed again (hash only) | `email_hash`, `reason` |
| `email_daily_counters` | Emails sent per occasion per day (Q6) | `occasion_id`, `day`, `count` |
| `deletion_requests` | Deletion with a seven-day undo, for accounts and occasions | `target_type`, `target_id`, `undo_until`, `undone_at`, `completed_at`, `retained_note` |

### Platform — `platform.ts` (3), `jobs.ts` (3), `stats.ts` (1), `storage.ts` (2), `incidents.ts` (1), `whatif.ts` (1), `corrections.ts` (1)

| Table | Purpose | Key columns |
| --- | --- | --- |
| `audit_log` | Append-only trail of state changes (SEC10) | `actor_kind`, `actor_id`, `action`, `object_type`, `object_id`, `before`, `after`, `meta` |
| `idempotency_keys` | Stored result of a change that must apply once (Q4) | `scope`, `key`, `result_json` |
| `platform_settings` | Operator settings edited in the console (key → JSON) | `key`, `value` |
| `jobs` | The job queue | `name`, `payload`, `run_at`, `attempts`, `locked_at`, `lease_expires_at`, `done_at`, `failed_at`, `unique_key` |
| `job_schedules` | Last slot enqueued per recurring schedule | — |
| `job_runs` | Operator-visible log of backup, restore-test, retention and statistics runs | `name`, `status`, `started_at`, `finished_at`, `detail` |
| `stats_daily` | Daily aggregates; no column can hold a visitor, account, session, device or IP | `day`, `metric`, `dimensions`, `value` |
| `assets` | Uploaded files; readable only when scanned clean and visible | `owner_type`, `owner_id`, `kind`, `mime`, `bytes`, `sha256`, `scan_state`, `visible_at`, `deleted_at` |
| `storage_usage` | Fair-use counters per owner | `owner_type`, `owner_id`, `bytes`, `files` |
| `incidents` | Incident log; an open one shows its message on guest-facing pages | `message_ro`, `message_en`, `started_at`, `resolved_at` |
| `whatif_previews` | Proposed changes awaiting confirmation | `kind`, `subject_type`, `subject_id`, `input`, `delta`, `state`, `proposed_by_kind`, `source`, `expires_at` |
| `corrections` | The history of changed facts; append-only | `target_table`, `target_id`, `field`, `before`, `after`, `reason`, `actor_kind`, `actor_id` |

### Occasions and planning — `occasions.ts` (2), `tasks.ts` (5), `templates.ts` (2), `lifecycle.ts` (1), `plannotes.ts` (1)

| Table | Purpose | Key columns |
| --- | --- | --- |
| `occasions` | The occasion being planned | `owner_account_id`, `business_id` (business-owned occasions), `title`, `kind`, `status` (planning, cancelled, postponed, closed), `date_mode`, `starts_at`, `ends_at`, `timezone`, `purpose`, `priorities` |
| `occasion_members` | Who is on the team, their role and grants | `account_id` or pending `invite_email` + `invite_token_hash`, `role` (owner, pm, workstream_lead, contributor, supplier, guest), `grant_finance`, `grant_private_requests`, `custom_label`, `removed_at` |
| `tasks` | One row per task, shown in list, board, calendar and event-day views | `status` (todo, doing, waiting, done), `owner_member_id`, `due_at`, `parent_id`, `template_task_key`, `offset_months`, `offset_days` |
| `task_check_items` | Checklist items of a task (a packing list is one of these) | `label`, `done`, `position` |
| `task_dependencies` | "Cannot sensibly finish before" links | `task_id`, `depends_on_task_id` |
| `delegations` | An offer of a task, accepted or declined | `from_member_id`, `to_member_id`, `state`, `decline_reason` |
| `reminder_digests` | One digest per member per day (the unique index is the once-a-day gate) | `member_id`, `date_key`, `outcome` |
| `templates` | The seven planning templates plus blank | `kind`, `name_ro`, `name_en` |
| `template_tasks` | A template's tasks with their offsets from the date | `key`, `stage`, `offset_months`, `offset_days` |
| `lessons` | Lessons written at closeout; they belong to the account and survive the occasion | `account_id`, `occasion_kind`, `occasion_title`, `body` |
| `plan_notes` | Notes attached to a plan by an accepted assistant proposal (shortlists, budget notes) | `kind`, `title`, `body`, `items`, `source`, `preview_id` |

### Guests and replies — `guests.ts` (14)

| Table | Purpose | Key columns |
| --- | --- | --- |
| `occasion_guest_settings` | RSVP settings per occasion, custom invitation text, the "changed since your last visit" revision | — |
| `rsvp_questions` | The planner's custom questions | `kind`, `text_ro`, `text_en`, `options`, `required`, `position` |
| `households` | An invited household | `name`, `lead_name`, `lead_email`, `language`, `expected_party_size` |
| `guests` | Named **adult** persons of a household | `household_id`, `full_name` |
| `invitations` | One link per household | `token_hash`, `qr_id`, `language`, `expiry_mode`, `expires_at`, `revoked_at`, `seen_revision` |
| `rsvp_responses` | The household's answer, as counts | `attending`, `adults_count`, `children_count` |
| `rsvp_answers` | Answers to custom questions | `question_id`, `option_id`, `value_text` |
| `date_polls`, `date_poll_options`, `date_poll_votes` | A date poll, its candidate dates and each household's vote; votes never reserve places | `status`, `confirmed_option_id`; `starts_at`; `vote` |
| `occasion_capacity` | The one shared count of places | `total`, `taken` |
| `capacity_claims` | Who holds how many places; the key makes a claim apply once | `claim_key`, `places` |
| `contribution_needs` | "Who brings what": a stated need | `title`, `units_needed`, `units_claimed` |
| `contribution_claims` | A claim by a household or a member | `household_id` or `account_id`, `units` |

### Money — `budget.ts` (2), `ledger.ts` (3)

| Table | Purpose | Key columns |
| --- | --- | --- |
| `budget_categories` | A budget line. Only estimate and forecast are stored; committed, invoiced and paid are worked out from expenses and supplier payments | `estimate_minor`, `forecast_minor`, `currency` |
| `expenses` | An expense; approval and payment are separate states; a paid expense is a fact | `amount_minor`, `currency`, `spent_on`, `booking_id`, `receipt_asset_id`, `approval_state`, `payment_state`, `paid_at`, `idempotency_key`, `retained_at` |
| `ledger_participants` | People who share costs: a member, a household or a typed name | `kind`, `member_id`, `household_id`, `name` |
| `ledger_entries` | Who paid what; a fact | `kind`, `amount_minor`, `currency`, `paid_by_participant_id`, `split_mode`, `voided_at` |
| `ledger_shares` | Who benefits from an entry and by how much; the shares add up to the entry | `participant_id`, `share_minor`, `weight` |

### Suppliers and delivery — `suppliers.ts` (9), `deliveries.ts` (2), `eventday.ts` (2)

| Table | Purpose | Key columns |
| --- | --- | --- |
| `suppliers` | A supplier record in a plan | `name`, `category_label`, contact fields, `listing_id` |
| `bookings` | The state of the agreement with one supplier | `state` (enquired, quoted, booked, confirmed, delivered, cancelled), `agreed_minor`, `quote_asset_id` |
| `booking_events` | Every state change of a booking, with who and when | `from_state`, `to_state`, `actor_kind`, `actor_id` |
| `supplier_links` | The supplier's scoped link | `token_hash`, `language`, `revoked_at` |
| `briefing_versions` | A published briefing; immutable | `version`, `content` |
| `briefing_acks` | The supplier's "received and understood", once per version | `briefing_version_id`, `ack_name`, `ack_at` |
| `order_snapshots` | The agreed final order; immutable | `version`, `items`, `based_on` |
| `order_deltas` | A guest change after the final order, written by a database trigger | `snapshot_id`, `household_id`, `before`, `after`, `folded_into_snapshot_id` |
| `payment_deadlines` | Advances, instalments and final balances with due dates | `kind`, `due_on`, `amount_minor`, `paid_at` |
| `deliveries` | A delivery, hire or return | `kind`, `expected_from`, `expected_to`, `place`, `state` |
| `delivery_items` | Expected, received and returned quantities, and deposits | `expected_qty`, `received_qty`, `returned_qty`, `deposit_minor`, `deposit_recovered_at` |
| `task_day_state` | Time of day and contact for a task on the event day | `start_time`, `contact_phone` |
| `readiness_decisions` | Hold / Proceed / Proceed with conditions, with evidence; append-only | `decision`, `conditions`, `evidence`, `decided_by_name`, `decided_at` |

### Directory, businesses and moderation — `directory.ts` (4), `business.ts` (9), `catalogues.ts` (2), `drawings.ts` (3), `featured.ts` (1)

| Table | Purpose | Key columns |
| --- | --- | --- |
| `categories` | The directory categories (21 seeded) | `slug`, `name_ro`, `name_en`, `active`, `published`, `merged_into_id` |
| `counties` | The 41 counties and București | `code`, `slug`, names, `launch_area`, `published`, `merged_into_code` |
| `localities` | Localities in a county (sectors for București) | `county_code`, `slug`, `kind`, `public_page`, `merged_into_id` |
| `directory_link_prefs` | Where the "see businesses" task link is switched off | `scope`, `subject_id` |
| `businesses` | A business account | `owner_account_id`, `onrc_registration`, `insurance_valid_until`, `status`, `restriction_reason`, `plan_lapsed_at`, `nudge_48h`, `hide_stats` |
| `business_members` | Owner, admins and staff; a row without an account is a pending invitation | `role`, `invite_email`, `invite_token_hash`, `removed_at` |
| `business_fact_checks` | The record behind each factual badge; a constraint allows only the two kinds | `kind`, `outcome`, `staff_id`, `valid_until` |
| `business_notices` | In-app messages to a business | `kind`, `reason`, `read_at` |
| `listings` | A directory listing, claimed or unclaimed | `business_id`, `status`, `claimed`, `live_revision_id`, `draft`, `source_url`, `public_contact_route`, `suspension_reason` |
| `listing_categories`, `listing_localities` | The live categories and localities of a listing (the search index) | — |
| `listing_revisions` | **The moderation queue** for listings, drawings, parking facts and catalogues; a decided row is immutable | `kind`, `subject_id`, `payload`, `base_payload`, `state`, `moderator_staff_id`, `decision_reason` |
| `listing_stats` | Response numbers per listing per day | `enquiries_received`, `enquiries_answered`, `median_reply_minutes` |
| `flower_catalogues` | A florist's catalogue (working copy and live state) | `listing_id`, `state`, `draft`, `live_revision_id` |
| `catalogue_items` | The live items of a catalogue | `variety_name`, `image_asset_id`, `season_months`, `price_per_stem_minor`, `price_per_bunch_minor`, `colours` |
| `spaces` | A venue's space with its drawing — the business's working copy | `width_mm`, `length_mm`, `drawing_asset_id`, `calibration`, `mm_per_px`, `markings`, `live_version_id` |
| `drawing_versions` | One approved version of a drawing; immutable | `space_id`, `version_no`, `snapshot`, `effective_at` |
| `listing_parking` | Parking facts of a venue listing; the live copy changes only by an approved revision | — |
| `featured_slots` | Featured placement; **inactive while monetisation is off** | `listing_id`, `category_id`, `county_code`, `active`, `starts_at`, `ends_at` |

### Enquiries, discovery and claims — `enquiries.ts` (4), `discovery.ts` (7)

| Table | Purpose | Key columns |
| --- | --- | --- |
| `enquiries` | A planner's enquiry or quote request to a listing | `kind`, `state`, `occasion_id`, `listing_id`, `booking_id`, `email_shared`, `sent_at`, `resent_at`, `first_answered_at`, `nudged_at`, `closed_at` |
| `enquiry_messages` | The thread | `side`, `body`, `quote_asset_id` |
| `enquiry_stat_events` | When an enquiry reached a listing and how long the first reply took; no occasion, account or text, so it outlives the thread | `listing_id`, `received_at`, `answered_at`, `reply_minutes` |
| `quote_links` | An accepted quote linked to what was asked for; a later acceptance is a new version | `version`, `design_ref`, `quote_asset_id`, `agreed_minor` |
| `discovery_sources` | A configured source with its rate limit and on/off switch | `kind` (onrc_public, business_page, licensed_dataset), `config`, `rate_limit_per_hour`, `enabled` |
| `discovery_runs` | Every run and what it produced | `items_seen`, `drafts_created`, `duplicates_queued`, `stopped_reason` |
| `discovery_drafts` | A candidate business; never public | `name`, `category_guess_id`, `county_code`, `public_contact_route`, `public_email`, `source_url`, `state`, `dedupe_keys`, `duplicate_of_listing_id` |
| `discovery_batches` | One decision over many drafts with its one recorded reason | — |
| `objection_records` | A removal or objection request and how it was handled | `kind`, `state`, `received_at`, `due_at`, `handled_at` |
| `discovery_suppressions` | Hashed keys of businesses that asked to be removed; discovery skips them for good | `key_hash` |
| `listing_claims` | A claim on an unclaimed listing, from proof to approval | `method`, `state`, `code_hash`, `verified_at`, `check_note`, `approval_request_id` |

### Business occasions, billing and communications — `bizoccasions.ts` (5), `billing.ts` (8), `comms.ts` (2)

| Table | Purpose | Key columns |
| --- | --- | --- |
| `business_profiles` | Branding of a business and what its team may see in its occasions | — |
| `business_occasion_seats` | A team member who took a real place in a business occasion | `business_member_id`, `occasion_member_id` |
| `occasion_handovers` | The record that an occasion was handed to the client; never updated | `to_account_id`, `team_access_ended`, `mcp_tokens_revoked`, `at` |
| `business_library_items` | Reusable templates, checklists, contacts and files | `kind`, `title`, `body`, `asset_id` |
| `business_library_links` | A library file shared into an occasion; keeps it readable after a lapse or handover | `item_id`, `occasion_id` |
| `monetization_switch` | One row; OFF unless switched on | `state`, `notice_starts_at`, `effective_at` |
| `monetization_history` | Every change of the switch: who asked, who approved, notice dates | `change`, `requested_by_staff_id`, `approver_staff_ids` |
| `monetization_reminders` | One row per notice reminder actually sent | `effective_at`, `days_before` |
| `billing_acceptances` | The recorded acceptance of the billing stack in test mode (MON4) | — |
| `subscriptions` | Dormant. Written only by the verified webhook handler and the nightly sweep | `plan`, `status`, `current_period_end`, `grace_until`, `sandbox` |
| `processor_events` | Processor events already handled (once per event id) | — |
| `invoices` | Dormant. One fiscal invoice per charge | `number`, `fiscal_ref`, `net_minor`, `tva_minor`, `gross_minor`, `tva_rate_bp`, `status` |
| `refund_requests` | A refund or credit request; no effect until a second person approves | `kind`, `amount_minor`, `state`, `approval_request_id` |
| `platform_notices` | A notice sent to businesses | `subject`, `body`, `audience`, `business_count`, `email_count` |
| `platform_notice_sends` | One row per business reached | `notice_id`, `business_id` |

### Staff, compliance and deployment — `staff.ts` (4), `compliance.ts` (1), `complianceaccess.ts` (1), `deploys.ts` (1), `mcp.ts` (2)

| Table | Purpose | Key columns |
| --- | --- | --- |
| `staff_members` | A person on the staff and their roles | `account_id`, `roles`, `active` |
| `console_sessions` | The console session: 12 hours, 30 minutes idle | `staff_id`, `session_id`, `last_seen_at`, `expires_at`, `ended_reason` |
| `approval_requests` | A request that needs another person; nothing happens until approved | `action`, `payload`, `requester_staff_id`, `state`, `single_operator_mode`, `approvals_needed`, `executed_at` |
| `approval_decisions` | One row per person who approved or rejected | `request_id`, `staff_id`, `decision` |
| `content_reports` | Notice-and-action reports (DSA) | `reference`, `target_type`, `target_id`, `reason_category`, `state`, `reason_given_to_affected`, `reporter_contact` |
| `compliance_access_grants` | Time-limited access to a person's retained records, approved by two others | `subject_type`, `subject_id`, `legal_reason`, `hours`, `expires_at`, `revoked_at` |
| `deploys` | Deploy history; a unique index allows one active deploy | `kind`, `tag`, `commit_hash`, `requested_by_staff_id`, `approved_by_staff_id`, `emergency`, `ci_status`, `state`, `stage`, `rollback_reason` |
| `mcp_tokens` | A connection token for an external assistant | `token_hash`, `last4`, `scope`, `business_id`, `last_used_at`, `revoked_at`, `consent_accepted_at` |
| `mcp_call_log` | One row per tool call: tool and token only, never arguments or results | `token_id`, `tool`, `scope`, `ok`, `error_code` |

### Release C: celebration — `seating.ts` (6), `programme.ts` (4), `stationery.ts` (2), `menus.ts` (4), `publicpage.ts` (2), `requests.ts` (2), `gifts.ts` (2), `promotion.ts` (1), `arrangements.ts` (3), `aitext.ts` (2)

| Table | Purpose | Key columns |
| --- | --- | --- |
| `space_models` | The one space model of an occasion: a frozen venue drawing version, or a rectangle the planner typed in, or a room they drew with the drawing tool | `source` (venue, own), `drawing_version_id`, `version_no`, `effective_at`, `own_width_mm`, `own_length_mm`, `own_areas` (drawn floor outlines in mm; NULL = not drawn), `own_features` (doors on their walls and pillars of the drawn room) |
| `plan_items` | A table or fixture on the plan, in real millimetres | `kind`, `source`, `shape` (round, rect, oval, halfmoon; round and half-moon by diameter), `fixture_kind` (stage, dance floor, speaker…), dimensions, `seats`, `x`, `y`, `rotation` |
| `seat_assignments` | Who sits at which table | `table_item_id`, `household_id`, `guest_id`, `places`, `seat_no` |
| `meal_stages` | Stages of the meal or evening with their own layout | `name`, `position` |
| `stage_item_states` | How an item differs from the base layout during one stage | `present`, `x`, `y`, `rotation` |
| `seating_plans` | Whether the seating is published to guests | — |
| `programme_items` | A moment of the programme | `title`, `kind`, `day_offset`, `start_minute`, `duration_min`, `visible_to_guests`, `concerns_all`, `supplier_id`, `cue_version` |
| `programme_cue_versions` | Versioned cue lists | `version`, `cues` |
| `programme_state` | The programme's revision counter per occasion | — |
| `programme_changes` | A guest-visible change and whom it concerns; told once | `revision`, `kind`, `concerns_all`, `household_ids`, `notified_at` |
| `stationery_sets` | Per occasion: the newest stationery version and which version the guest link's invitation adopts | `current_version`, `digital_version` |
| `stationery_versions` | A saved stationery version; immutable except the one-time proof mark | `version`, `design_key`, `colourway_key`, `texts`, `proofed_at` |
| `menus`, `menu_items` | Menus and their dishes | `meal_stage_id`; `course`, `diet_tags`, `is_choice`, `audience` |
| `meal_choices` | How many of a household take an option (counts only) | `menu_item_id`, `count` |
| `menu_settings` | Margins and drink rules for quantities | — |
| `public_pages` | The published event page and its registration settings | `slug`, `published`, `registration_enabled`, `shares_capacity`, `questions` |
| `public_registrations` | A public registration or waiting-list place | `queue_no`, `name`, `email`, `adults`, `children`, `status`, `manage_token_hash`, `consent_at` |
| `private_requests` | A private dietary or access request; needs its own grant to read | `household_id` or `registration_id`, `kind`, `diet_tag`, `body`, `status` |
| `guest_journeys` | The published accessible guest journey | — |
| `gift_guide_settings` | An account's own copy of the gift guide table | — |
| `gift_estimates` | Saved gift estimates; private to the account | `household_id`, `relationship`, `distance`, `venue`, `low_minor`, `high_minor` |
| `promotion_copies` | The promotion texts the planner edited (images and files are generated on request, not stored) | — |
| `arrangement_designs` | A flower arrangement design | `name`, `current_version`, `archived_at` |
| `arrangement_versions` | A saved design version; immutable | `version`, `form`, `lines`, `note`, `source` |
| `arrangement_quote_requests` | Which design version a quote request carried | `design_id`, `version`, `enquiry_id` |
| `ai_text_usage` | AI wording results used per account and month | `month`, `used` |
| `ai_text_results` | What was asked and which provider and model answered — never the text | `purpose`, `provider`, `model`, `accepted_at` |

### Release D: travel — `travel.ts` (11)

| Table | Purpose | Key columns |
| --- | --- | --- |
| `subgroups`, `subgroup_members` | Subgroups of a group trip and who is in them | `lead_member_id`; `person_key` |
| `itinerary_legs` | A leg of the itinerary, each end with its own time zone | `kind`, `starts_at`, `ends_at`, `start_tz`, `end_tz`, `reference`, `import_key` |
| `activities`, `activity_optins` | Optional activities and who opted in | `cost_minor`, `capacity`, `taken`; `person_key`, `places` |
| `packing_lists` | Marks a task as a packing list and says whom it is for | `task_id`, `scope` |
| `transport_legs`, `transport_seats` | Vehicles with seats, claimed atomically | `seats`, `taken`; `person_key`, `seats` |
| `rooms`, `room_assignments` | Rooms with beds and who sleeps where | `capacity`, `occupants`; `person_key`, `places` |
| `exchange_notes` | A note typed beside a currency; shown only, never used to convert | `currency`, `note` |

### Release E: operate — `operate.ts` (5)

| Table | Purpose | Key columns |
| --- | --- | --- |
| `check_ins` | An arrival, one row per household; a fact | `adults_arrived`, `children_arrived`, `arrived_at`, `source`, `voided_at` |
| `offline_items` | What a device captured without network; received once per client key | `client_key`, `kind`, `payload`, `captured_at`, `state`, `result_code` |
| `check_item_revisions` | A revision bumped by trigger on every checklist change, so an offline tick can tell if the item changed | — |
| `sustainability_goals` | Optional goals | `metric`, `target_value`, `unit`, `direction`, `aggregate` |
| `sustainability_measurements` | Measured quantities | `goal_id`, `value`, `measured_at` |

## What the database itself enforces

The files in `packages/db/src/sql/` are applied after the schema by `db:migrate`, `db:push`
and the test harness, every time, in file-name order. They are written to be safe to
re-apply.

| File | Trigger on | What it refuses |
| --- | --- | --- |
| `001_audit_append_only.sql` | `audit_log` | Any UPDATE, DELETE or TRUNCATE (SEC10) |
| `010_corrections_append_only.sql` | `corrections` | Any UPDATE, DELETE or TRUNCATE |
| `020_finance_fact_guards.sql` | `expenses`, `ledger_entries`, `ledger_shares` | Changing the amount, currency or payment state of a **paid** expense, or deleting it; changing a ledger entry's amount, currency, payer or void mark; updating shares — unless the transaction declared a correction |
| `020_listing_revisions_immutable.sql` | `listing_revisions` | Changing a decided (approved or rejected) moderation revision |
| `020_suppliers_guards.sql` | `briefing_versions`, `order_snapshots`, `briefing_acks`, `order_deltas`, `payment_deadlines`, and a trigger on `rsvp_responses` | Editing or deleting a published briefing, a final order or an acknowledgement (deletion only during an occasion purge); changing an order delta other than marking it folded; changing or clearing a payment's "paid" mark without a correction. The `rsvp_responses` trigger **writes** an `order_deltas` row for every booking with a final order when a guest's answer changes afterwards |
| `021_delivery_facts.sql` | `delivery_items` | Changing a recorded received or returned quantity, or a recovered deposit, without a correction (the first recording is free) |
| `022_readiness_append_only.sql` | `readiness_decisions` | Any UPDATE; DELETE except during an occasion purge |
| `030_drawing_versions_immutable.sql` | `drawing_versions` | Any UPDATE of an approved drawing version |
| `040_operate_guards.sql` | `check_ins`, `task_check_items` | Changing an arrival's counts, time or un-check mark without a correction; deleting an arrival except during a purge. Also bumps a checklist item's revision on every insert or change |
| `040_stationery_guards.sql` | `stationery_versions`, `arrangement_versions`, plus a unique index on `invitations.qr_id` | Changing a saved stationery version other than setting its proof mark once; changing a saved arrangement version |

Two transaction-local settings open these guards, and only `@ed/core` sets them:
`ed.correction = 'on'` (a `corrections` row is being written in the same transaction) and
`ed.purge = 'on'` (the occasion is being finally deleted). Tests:
`packages/db/test/audit-append-only.test.ts`, and the money, deliveries, suppliers, operate,
stationery, arrangements and drawings tests in `packages/core/test/`.

*Note for developers:* a comment in `packages/db/src/schema/budget.ts` refers to
`020_expenses_paid_guard.sql`; the file is actually `020_finance_fact_guards.sql`.

## Retention, as implemented

The nightly job `retention.purge` (03:30) runs every rule registered with
`registerRetentionRule`. Sixteen rules exist (the sixteenth, `security-log`, erases the security log after 90 days). The PRD's retention table is INF6.

| What | Kept for | Rule or job | Where |
| --- | --- | --- | --- |
| Sign-in and fresh-confirmation codes, one-tap links | Deleted 24 hours after expiry | job `auth.purge-expired` (03:10) | `packages/auth/src/codes.ts` |
| Expired sessions | 30 days after expiry | same job | same |
| Rate-limit windows and back-offs | 2 days | same job | same |
| Accounts | Until a deletion request, then 7 days of undo, then purged | job `accounts.purge-due` (03:20) | `packages/core/src/accounts.ts` |
| Occasions | Until a deletion request, then 7 days of undo, then purged | rule `occasions-deleted` | `packages/core/src/occasions.ts` |
| Private requests | 30 days after the occasion is closed | rule `private-requests` | `packages/core/src/requests.ts` |
| Paid expenses and receipts of a deleted occasion | 7 years, counted **from the occasion's deletion** | rule `finance-records-retained` | `packages/core/src/expenses.ts` |
| Rejected or discarded discovery drafts | 90 days | rule `discovery-rejected-drafts` | `packages/core/src/discovery.ts` |
| Handled removal and objection records | 3 years | rule `objection-records` | same |
| Claim verification codes | Cleared once expired or used | rule `claim-codes` | `packages/core/src/claims.ts` |
| Contact details of a person who reported content | Cleared 183 days after the report was decided | rule `content-report-contacts` | `packages/core/src/reports.ts` |
| Unconfirmed What-if previews | 7 days | rule `whatif-expired-previews` | `packages/core/src/whatif.ts` |
| Stored results of once-only actions | 7 days | rule `idempotency-keys` | `packages/core/src/retention.ts` |
| Finished jobs / failed jobs | 30 days / 90 days | rules `jobs-done`, `jobs-failed` | same |
| Operator job-run log | 730 days | rule `job-runs` | same |
| MCP call log | 730 days | rule `mcp-call-log` | `packages/mcp/src/tokens.ts` |
| MCP tokens | Revoked after 30 days without use | job `mcp.expire-inactive` (03:50) | same |
| Deleted files (the stored objects) | Removed 30 days after deletion | rule `assets-deleted-objects` | `packages/storage/src/assets.ts` |
| Uploads started and never completed | Removed | rule `assets-abandoned-uploads` | same |
| Daily statistics | Indefinitely (aggregates only) | no rule, by design | — |

### Where the implementation differs from the PRD's retention table

These are recorded as gaps in `09-traceability.md`:

- **Audit log — PRD says 2 years; nothing deletes it.** The append-only trigger refuses every
  DELETE and there is no purge rule, so audit entries are kept indefinitely. The deletion
  screen tells people the audit log is kept for 2 years. Removing old entries would need a
  deliberate, reviewed mechanism (for example partitioning by year and dropping partitions).
- **Security log** (`security_log`) has no retention rule either. It holds hashed keys and IP
  addresses of rate-limit events.
- **Email outbox** (`email_outbox`) has no retention rule. With a real provider it holds the
  recipient address, the template name and the status, not the body.
- **Receipts — PRD says 7 years after closeout; the code counts 7 years from the occasion's
  deletion.** That keeps records longer than the PRD says, never shorter.

## Deletion: what a purge does, and what stays

Deleting an **occasion** (owner only, fresh confirmation) starts a 7-day undo. When it lapses,
the worker runs every `onOccasionPurge` hook inside one transaction with `ed.purge` on, then
deletes the occasion row; most tables go by foreign-key cascade (tasks, checklists,
delegations, members, households, guests, invitations, replies, polls, capacity). Hooks exist
in: `arrangements`, `checkin`, `enquiries`, `expenses`, `gifts`, `guestevent`,
`ledger`, `menus`, `plannotes`, `programme`, `promotion`, `publicpage`, `requests`, `rooms`,
`seating`, `stationery`, `subgroups`, `suppliers`, `sustainability`, `transport`. The
occasion's files are then removed from storage.

**Kept after an occasion is deleted:**

- Paid expenses and expenses with a receipt, detached from the occasion (`retained_at` set;
  receipt files moved to an owner no member can open) — 7 years.
- `enquiry_stat_events` — arrival time and reply delay per listing, with no occasion, account
  or text, so a listing's published response numbers do not change.
- `lessons` — they belong to the account that wrote them.
- `audit_log` and `corrections` entries.
- `stats_daily` aggregates.

Deleting an **account** (fresh confirmation) starts the same 7-day undo. When it lapses, the
worker runs every `onAccountPurge` hook — AI text usage (`aitext`), gift estimates (`gifts`),
MCP tokens (`@ed/mcp`), business memberships with ownership passed to another member
(`business`) — deletes the sessions, codes, recovery codes and authenticator secret, and
blanks the account row (email, username, name, password hash) so that retained records keep a
valid reference. The row itself stays as an anonymous tombstone.

> **Occasions owned by a deleted account.** When the account is purged, each personal
> occasion it owns is handed to its longest-standing project manager (who becomes the owner,
> with both grants); if there is none, the occasion is deleted with the account, running the
> same purge hooks as an occasion deletion. Business-owned occasions follow the business. The
> account's seats in other people's occasions end. Covered by
> `packages/core/test/account-purge-occasions.test.ts`.
