import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { z } from "zod";
import { accounts } from "./accounts";
import { occasions } from "./occasions";
import { createdAt, id, ref, timestamptz, updatedAt } from "./_helpers";

// Guests, invitations, RSVP, date polls, shared capacity and contributions
// (A6, A7, A8, A9, A13, S6, SEC2, INF5, L2).
//
// INVARIANT 9 — children are never persons. The ONLY thing stored about children is how many
// attend, per household response (`rsvp_responses.children_count`). No table here may gain a
// column describing a child (name, age, birth date, …): packages/db/test/guests-schema.test.ts
// fails the build if one appears. `guests` rows are named ADULTS only.

export const GUEST_LANGUAGES = ["ro", "en"] as const;
export type GuestLanguage = (typeof GUEST_LANGUAGES)[number];
export const guestLanguageSchema = z.enum(GUEST_LANGUAGES);

export const INVITATION_EXPIRY_MODES = ["never", "rsvp_deadline", "closeout"] as const;
export type InvitationExpiryMode = (typeof INVITATION_EXPIRY_MODES)[number];
export const invitationExpiryModeSchema = z.enum(INVITATION_EXPIRY_MODES);

export const RSVP_ATTENDING = ["yes", "no", "maybe"] as const;
export type RsvpAttending = (typeof RSVP_ATTENDING)[number];
export const rsvpAttendingSchema = z.enum(RSVP_ATTENDING);

export const RSVP_QUESTION_KINDS = [
  "menu_choice",
  "allergies",
  "accommodation",
  "transport",
  "free_text",
  "single_choice",
] as const;
export type RsvpQuestionKind = (typeof RSVP_QUESTION_KINDS)[number];
export const rsvpQuestionKindSchema = z.enum(RSVP_QUESTION_KINDS);

/** One selectable answer of a question, in both languages. */
export type RsvpQuestionOption = { id: string; ro: string; en: string };

export const POLL_STATUSES = ["open", "confirmed", "closed"] as const;
export type PollStatus = (typeof POLL_STATUSES)[number];
export const pollStatusSchema = z.enum(POLL_STATUSES);

export const POLL_VOTES = ["yes", "maybe", "no"] as const;
export type PollVote = (typeof POLL_VOTES)[number];
export const pollVoteSchema = z.enum(POLL_VOTES);

/** Per-occasion RSVP settings and the "changed since your last visit" revision (INF5). */
export const occasionGuestSettings = pgTable("occasion_guest_settings", {
  occasionId: ref("occasion_id")
    .primaryKey()
    .references(() => occasions.id, { onDelete: "cascade" }),
  /** After this instant guests can no longer answer or change their answer. NULL = open. */
  rsvpDeadline: timestamptz("rsvp_deadline"),
  /** Bumped by planner-side changes guests should notice (bumpGuestRevision). */
  guestRevision: integer("guest_revision").notNull().default(0),
  guestRevisionAt: timestamptz("guest_revision_at"),
  /** i18n key that says what changed, e.g. "rsvp.changes.date". */
  guestRevisionReasonKey: text("guest_revision_reason_key"),
  updatedAt: updatedAt(),
});

export const rsvpQuestions = pgTable(
  "rsvp_questions",
  {
    id: id(),
    occasionId: ref("occasion_id")
      .notNull()
      .references(() => occasions.id, { onDelete: "cascade" }),
    kind: text("kind").$type<RsvpQuestionKind>().notNull(),
    textRo: text("text_ro").notNull(),
    textEn: text("text_en").notNull(),
    options: jsonb("options").$type<RsvpQuestionOption[]>().notNull().default([]),
    required: boolean("required").notNull().default(false),
    position: integer("position").notNull().default(0),
    /** Removed questions are archived so given answers stay readable. */
    archivedAt: timestamptz("archived_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("rsvp_questions_occasion_idx").on(t.occasionId, t.position)],
);

export const households = pgTable(
  "households",
  {
    id: id(),
    occasionId: ref("occasion_id")
      .notNull()
      .references(() => occasions.id, { onDelete: "cascade" }),
    /** Label on the invitation: "Familia Popescu". */
    name: text("name").notNull(),
    leadName: text("lead_name"),
    /** Captured at RSVP for change notices (INF5), or typed by a manager. Managers only (D2). */
    leadEmail: text("lead_email"),
    language: text("language").$type<GuestLanguage>().notNull().default("ro"),
    /** How many people the planner expects from this household. NULL = unknown. */
    expectedPartySize: integer("expected_party_size"),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("households_occasion_idx").on(t.occasionId)],
);

/** Named ADULT persons of a household. Never a child (invariant 9). */
export const guests = pgTable(
  "guests",
  {
    id: id(),
    occasionId: ref("occasion_id")
      .notNull()
      .references(() => occasions.id, { onDelete: "cascade" }),
    householdId: ref("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    fullName: text("full_name").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("guests_household_idx").on(t.householdId), index("guests_occasion_idx").on(t.occasionId)],
);

/** One link per household. Only the SHA-256 of the token is stored (SEC2, SEC8). */
export const invitations = pgTable(
  "invitations",
  {
    id: id(),
    occasionId: ref("occasion_id")
      .notNull()
      .references(() => occasions.id, { onDelete: "cascade" }),
    householdId: ref("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    /** Printed-QR identifier (stationery, a later release). */
    qrId: text("qr_id"),
    language: text("language").$type<GuestLanguage>().notNull().default("ro"),
    expiryMode: text("expiry_mode").$type<InvitationExpiryMode>().notNull().default("never"),
    /** Fixed expiry instant, when the mode has one. */
    expiresAt: timestamptz("expires_at"),
    revokedAt: timestamptz("revoked_at"),
    lastViewedAt: timestamptz("last_viewed_at"),
    /** occasion_guest_settings.guest_revision the household has already seen. */
    seenRevision: integer("seen_revision").notNull().default(0),
    emailedAt: timestamptz("emailed_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("invitations_token_hash_uq").on(t.tokenHash),
    uniqueIndex("invitations_household_uq").on(t.householdId),
    uniqueIndex("invitations_qr_uq").on(t.qrId),
    index("invitations_occasion_idx").on(t.occasionId),
  ],
);

/** The household's answer. Counts only: adults and children are numbers, never rows. */
export const rsvpResponses = pgTable(
  "rsvp_responses",
  {
    id: id(),
    occasionId: ref("occasion_id")
      .notNull()
      .references(() => occasions.id, { onDelete: "cascade" }),
    householdId: ref("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    attending: text("attending").$type<RsvpAttending>().notNull(),
    adultsCount: integer("adults_count").notNull().default(0),
    /** Invariant 9: the only datum about children anywhere — how many come. */
    childrenCount: integer("children_count").notNull().default(0),
    answeredAt: timestamptz("answered_at").notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("rsvp_responses_household_uq").on(t.householdId),
    index("rsvp_responses_occasion_idx").on(t.occasionId),
    check("rsvp_responses_counts_ck", sql`${t.adultsCount} >= 0 AND ${t.childrenCount} >= 0`),
  ],
);

export const rsvpAnswers = pgTable(
  "rsvp_answers",
  {
    id: id(),
    occasionId: ref("occasion_id")
      .notNull()
      .references(() => occasions.id, { onDelete: "cascade" }),
    householdId: ref("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    questionId: ref("question_id")
      .notNull()
      .references(() => rsvpQuestions.id, { onDelete: "cascade" }),
    /** Chosen option id (choice questions). */
    optionId: text("option_id"),
    /** Typed answer (text questions). */
    valueText: text("value_text"),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("rsvp_answers_household_question_uq").on(t.householdId, t.questionId)],
);

/* ── Date polls (A7) ─────────────────────────────────────────────────────── */

export const datePolls = pgTable(
  "date_polls",
  {
    id: id(),
    occasionId: ref("occasion_id")
      .notNull()
      .references(() => occasions.id, { onDelete: "cascade" }),
    status: text("status").$type<PollStatus>().notNull().default("open"),
    confirmedOptionId: text("confirmed_option_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("date_polls_occasion_idx").on(t.occasionId)],
);

export const datePollOptions = pgTable(
  "date_poll_options",
  {
    id: id(),
    pollId: ref("poll_id")
      .notNull()
      .references(() => datePolls.id, { onDelete: "cascade" }),
    occasionId: ref("occasion_id")
      .notNull()
      .references(() => occasions.id, { onDelete: "cascade" }),
    startsAt: timestamptz("starts_at").notNull(),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("date_poll_options_poll_starts_uq").on(t.pollId, t.startsAt),
    index("date_poll_options_poll_idx").on(t.pollId),
  ],
);

/** A household's vote on one candidate date. Votes never reserve places (A7). */
export const datePollVotes = pgTable(
  "date_poll_votes",
  {
    id: id(),
    pollId: ref("poll_id")
      .notNull()
      .references(() => datePolls.id, { onDelete: "cascade" }),
    optionId: ref("option_id")
      .notNull()
      .references(() => datePollOptions.id, { onDelete: "cascade" }),
    householdId: ref("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    vote: text("vote").$type<PollVote>().notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("date_poll_votes_option_household_uq").on(t.optionId, t.householdId)],
);

/* ── Shared capacity (A8) ────────────────────────────────────────────────── */

/** One count shared by invited households and public registrations. */
export const occasionCapacity = pgTable(
  "occasion_capacity",
  {
    occasionId: ref("occasion_id")
      .primaryKey()
      .references(() => occasions.id, { onDelete: "cascade" }),
    /** NULL = unlimited. */
    total: integer("total"),
    taken: integer("taken").notNull().default(0),
    updatedAt: updatedAt(),
  },
  (t) => [check("occasion_capacity_taken_ck", sql`${t.taken} >= 0 AND (${t.total} IS NULL OR ${t.total} >= 0)`)],
);

/** Who holds how many places. `claim_key` makes a claim idempotent ("rsvp:<householdId>"). */
export const capacityClaims = pgTable(
  "capacity_claims",
  {
    id: id(),
    occasionId: ref("occasion_id")
      .notNull()
      .references(() => occasions.id, { onDelete: "cascade" }),
    claimKey: text("claim_key").notNull(),
    places: integer("places").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("capacity_claims_occasion_key_uq").on(t.occasionId, t.claimKey),
    check("capacity_claims_places_ck", sql`${t.places} >= 0`),
  ],
);

/* ── Contributions, "Cine ce aduce" (A9) ─────────────────────────────────── */

export const contributionNeeds = pgTable(
  "contribution_needs",
  {
    id: id(),
    occasionId: ref("occasion_id")
      .notNull()
      .references(() => occasions.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    note: text("note"),
    unitsNeeded: integer("units_needed").notNull(),
    unitsClaimed: integer("units_claimed").notNull().default(0),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("contribution_needs_occasion_idx").on(t.occasionId, t.position),
    check(
      "contribution_needs_units_ck",
      sql`${t.unitsNeeded} >= 1 AND ${t.unitsClaimed} >= 0 AND ${t.unitsClaimed} <= ${t.unitsNeeded}`,
    ),
  ],
);

/** A claim by a household (guest link) or by a member (in the app) — exactly one of the two. */
export const contributionClaims = pgTable(
  "contribution_claims",
  {
    id: id(),
    needId: ref("need_id")
      .notNull()
      .references(() => contributionNeeds.id, { onDelete: "cascade" }),
    occasionId: ref("occasion_id")
      .notNull()
      .references(() => occasions.id, { onDelete: "cascade" }),
    householdId: ref("household_id").references(() => households.id, { onDelete: "cascade" }),
    accountId: ref("account_id").references(() => accounts.id),
    units: integer("units").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("contribution_claims_need_household_uq").on(t.needId, t.householdId),
    uniqueIndex("contribution_claims_need_account_uq").on(t.needId, t.accountId),
    check("contribution_claims_units_ck", sql`${t.units} >= 1`),
    check(
      "contribution_claims_holder_ck",
      sql`(${t.householdId} IS NULL) <> (${t.accountId} IS NULL)`,
    ),
  ],
);
