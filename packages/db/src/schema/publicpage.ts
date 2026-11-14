import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { z } from "zod";
import { occasions } from "./occasions";
import { createdAt, id, ref, timestamptz, updatedAt } from "./_helpers";

// Public event page and its registrations (C-06, A8, SEC11).
//
// - One page per occasion, reached at /e/<slug>. Unpublished and closed pages answer exactly
//   like a slug that does not exist.
// - A registration states a name, an email and the SIZE of the party: adults and children as
//   two numbers. Nothing else about a child is ever stored (invariant 9).
// - Places come from the occasion's ONE shared capacity (capacity_claims key
//   "public:<registrationId>"); who does not fit waits in line (status "waitlisted").
// - The manage link's token is stored only as its SHA-256.

export const PUBLIC_QUESTION_KINDS = ["choice", "text"] as const;
export type PublicQuestionKind = (typeof PUBLIC_QUESTION_KINDS)[number];

export type PublicQuestionOption = { id: string; ro: string; en: string };
export type PublicQuestion = {
  id: string;
  kind: PublicQuestionKind;
  ro: string;
  en: string;
  options: PublicQuestionOption[];
  required: boolean;
  /** One level of conditional logic: shown only when question `questionId` was answered `optionId`. */
  showIf: { questionId: string; optionId: string } | null;
};

export type PublicAnswer = { optionId: string | null; text: string | null };

export const REGISTRATION_STATUSES = ["registered", "waitlisted", "cancelled"] as const;
export type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number];
export const registrationStatusSchema = z.enum(REGISTRATION_STATUSES);

export const publicPages = pgTable(
  "public_pages",
  {
    id: id(),
    occasionId: ref("occasion_id")
      .notNull()
      .references(() => occasions.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    published: boolean("published").notNull().default(false),
    titleRo: text("title_ro").notNull(),
    titleEn: text("title_en"),
    descriptionRo: text("description_ro"),
    descriptionEn: text("description_en"),
    showDate: boolean("show_date").notNull().default(true),
    showVenue: boolean("show_venue").notNull().default(true),
    showProgramme: boolean("show_programme").notNull().default(false),
    showMenu: boolean("show_menu").notNull().default(false),
    registrationEnabled: boolean("registration_enabled").notNull().default(false),
    /** NULL = from now / until the planner closes it. */
    registrationOpensAt: timestamptz("registration_opens_at"),
    registrationClosesAt: timestamptz("registration_closes_at"),
    /** true = registrations take places from the occasion's shared capacity (A8). */
    sharesCapacity: boolean("shares_capacity").notNull().default(true),
    questions: jsonb("questions").$type<PublicQuestion[]>().notNull().default([]),
    /** NULL = the platform's privacy notice. */
    privacyUrl: text("privacy_url"),
    /** Last queue number handed out (registrations are numbered in order of arrival). */
    registrationCounter: integer("registration_counter").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("public_pages_occasion_uq").on(t.occasionId), uniqueIndex("public_pages_slug_uq").on(t.slug)],
);

export const publicRegistrations = pgTable(
  "public_registrations",
  {
    id: id(),
    pageId: ref("page_id")
      .notNull()
      .references(() => publicPages.id, { onDelete: "cascade" }),
    occasionId: ref("occasion_id")
      .notNull()
      .references(() => occasions.id, { onDelete: "cascade" }),
    /** Order of arrival on this page — what the waiting list is ordered by. */
    queueNo: integer("queue_no").notNull(),
    name: text("name").notNull(),
    /** Lower-cased. Managers only (D2). */
    email: text("email").notNull(),
    adults: integer("party_adults").notNull(),
    /**
     * Invariant 9: how many children come — a number, nothing more. The COLUMN is named
     * party_juniors because the schema guard (guests-rsvp.test.ts) allows the word "children"
     * in exactly one column of the whole database.
     */
    children: integer("party_juniors").notNull().default(0),
    answers: jsonb("answers").$type<Record<string, PublicAnswer>>().notNull().default({}),
    language: text("language").$type<"ro" | "en">().notNull().default("ro"),
    status: text("status").$type<RegistrationStatus>().notNull(),
    manageTokenHash: text("manage_token_hash").notNull(),
    idempotencyKey: text("idempotency_key"),
    consentAt: timestamptz("consent_at").notNull(),
    promotedAt: timestamptz("promoted_at"),
    cancelledAt: timestamptz("cancelled_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("public_registrations_token_uq").on(t.manageTokenHash),
    uniqueIndex("public_registrations_idem_uq").on(t.pageId, t.idempotencyKey),
    /** One live registration per email and page; a cancelled one may register again. */
    uniqueIndex("public_registrations_email_uq")
      .on(t.pageId, t.email)
      .where(sql`${t.status} <> 'cancelled'`),
    index("public_registrations_page_idx").on(t.pageId, t.status, t.queueNo),
    index("public_registrations_occasion_idx").on(t.occasionId),
    check("public_registrations_counts_ck", sql`${t.adults} >= 1 AND ${t.children} >= 0`),
  ],
);
