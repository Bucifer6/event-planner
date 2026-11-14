import { boolean, index, jsonb, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { z } from "zod";
import { accounts } from "./accounts";
import { createdAt, id, ref, timestamptz, updatedAt } from "./_helpers";

// Occasions and their members (A1, A5, A11, D2). Access is decided only in @ed/core/access.

export const OCCASION_KINDS = [
  "picnic",
  "aniversare",
  "nunta",
  "botez",
  "revelion",
  "voiaj_solo",
  "voiaj_grup",
  "blank",
] as const;
export type OccasionKind = (typeof OCCASION_KINDS)[number];
export const occasionKindSchema = z.enum(OCCASION_KINDS);

export const OCCASION_STATUSES = ["planning", "cancelled", "postponed", "closed"] as const;
export type OccasionStatus = (typeof OCCASION_STATUSES)[number];
export const occasionStatusSchema = z.enum(OCCASION_STATUSES);

export const OCCASION_DATE_MODES = ["date", "range", "poll"] as const;
export type OccasionDateMode = (typeof OCCASION_DATE_MODES)[number];
export const occasionDateModeSchema = z.enum(OCCASION_DATE_MODES);

export const OCCASION_ROLES = [
  "owner",
  "pm",
  "workstream_lead",
  "contributor",
  "supplier",
  "guest",
] as const;
export type OccasionRole = (typeof OCCASION_ROLES)[number];
export const occasionRoleSchema = z.enum(OCCASION_ROLES);

export const OCCASION_GRANTS = ["finance", "privateRequests"] as const;
export type OccasionGrant = (typeof OCCASION_GRANTS)[number];
export const occasionGrantSchema = z.enum(OCCASION_GRANTS);

export const occasions = pgTable(
  "occasions",
  {
    id: id(),
    ownerAccountId: ref("owner_account_id")
      .notNull()
      .references(() => accounts.id),
    /** Set when a business runs the occasion for a client (release P). */
    businessId: text("business_id"),
    title: text("title").notNull(),
    kind: text("kind").$type<OccasionKind>().notNull().default("blank"),
    status: text("status").$type<OccasionStatus>().notNull().default("planning"),
    dateMode: text("date_mode").$type<OccasionDateMode>().notNull().default("date"),
    /** NULL = not decided yet (date poll). */
    startsAt: timestamptz("starts_at"),
    endsAt: timestamptz("ends_at"),
    timezone: text("timezone").notNull().default("Europe/Bucharest"),
    venueName: text("venue_name"),
    venueAddress: text("venue_address"),
    /** Event brief (A11): why the occasion happens, and its 2–3 priorities. */
    purpose: text("purpose"),
    priorities: jsonb("priorities").$type<string[]>().notNull().default([]),
    locale: text("locale").$type<"ro" | "en">().notNull().default("ro"),
    closedAt: timestamptz("closed_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("occasions_owner_idx").on(t.ownerAccountId),
    index("occasions_business_idx").on(t.businessId),
    index("occasions_starts_idx").on(t.startsAt),
  ],
);

export const occasionMembers = pgTable(
  "occasion_members",
  {
    id: id(),
    occasionId: ref("occasion_id")
      .notNull()
      .references(() => occasions.id, { onDelete: "cascade" }),
    /** NULL until an emailed invitation is accepted. */
    accountId: ref("account_id").references(() => accounts.id),
    inviteEmail: text("invite_email"),
    /** SHA-256 of the emailed token (SEC8); cleared on acceptance. */
    inviteTokenHash: text("invite_token_hash"),
    role: text("role").$type<OccasionRole>().notNull(),
    /** D2: finance and private-request access are separate, explicit grants. */
    grantFinance: boolean("grant_finance").notNull().default(false),
    grantPrivateRequests: boolean("grant_private_requests").notNull().default(false),
    /** Free label shown beside the role, e.g. "nașă", "cavaler de onoare". */
    customLabel: text("custom_label"),
    createdAt: createdAt(),
    removedAt: timestamptz("removed_at"),
  },
  (t) => [
    uniqueIndex("occasion_members_occasion_account_uq").on(t.occasionId, t.accountId),
    uniqueIndex("occasion_members_invite_token_uq").on(t.inviteTokenHash),
    index("occasion_members_account_idx").on(t.accountId),
  ],
);
