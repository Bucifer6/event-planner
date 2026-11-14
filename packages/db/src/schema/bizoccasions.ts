import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { z } from "zod";
import { accounts } from "./accounts";
import { businessMembers, businesses } from "./business";
import { occasionMembers, occasions } from "./occasions";
import { createdAt, id, ref, timestamptz, updatedAt } from "./_helpers";

// Business occasions, shared libraries, branding and handover (P17–P23, MCP7).
// Written only through @ed/core/{bizoccasions,library,handover}. Read by @ed/core/access for
// the team path into a business-owned occasion.

/** One row per business: branding (P20) and what the team may see in its occasions (P17). */
export const businessProfiles = pgTable("business_profiles", {
  businessId: ref("business_id")
    .primaryKey()
    .references(() => businesses.id, { onDelete: "cascade" }),
  /** Name shown to guests; NULL = the business name. */
  displayName: text("display_name"),
  /** Image asset owned by the business. */
  logoAssetId: text("logo_asset_id"),
  /** "#rrggbb"; NULL = the EventDesk accent. */
  accentColor: text("accent_color"),
  /** D2: the grants the TEAM path carries into the business's occasions. */
  teamGrantFinance: boolean("team_grant_finance").notNull().default(true),
  teamGrantPrivateRequests: boolean("team_grant_private_requests").notNull().default(false),
  updatedAt: updatedAt(),
});

/**
 * A team member who took a real place in a business occasion (so tasks can be assigned to
 * them). The occasion_members row it points to is valid only while this row exists AND the
 * business membership is live — @ed/core/access checks both. Deleted at handover.
 */
export const businessOccasionSeats = pgTable(
  "business_occasion_seats",
  {
    id: id(),
    occasionId: ref("occasion_id")
      .notNull()
      .references(() => occasions.id, { onDelete: "cascade" }),
    businessId: ref("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    businessMemberId: ref("business_member_id")
      .notNull()
      .references(() => businessMembers.id, { onDelete: "cascade" }),
    occasionMemberId: ref("occasion_member_id")
      .notNull()
      .references(() => occasionMembers.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("business_occasion_seats_member_uq").on(t.occasionMemberId),
    index("business_occasion_seats_occasion_idx").on(t.occasionId),
  ],
);

/** P22: the record that a business handed an occasion to its client. Never updated. */
export const occasionHandovers = pgTable(
  "occasion_handovers",
  {
    id: id(),
    /** Not a foreign key: the record outlives the occasion. */
    occasionId: text("occasion_id").notNull(),
    businessId: ref("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    /** What the business may still see afterwards: the title and the date, nothing else. */
    occasionTitle: text("occasion_title").notNull(),
    occasionStartsAt: timestamptz("occasion_starts_at"),
    toAccountId: ref("to_account_id").references(() => accounts.id, { onDelete: "set null" }),
    byAccountId: ref("by_account_id").references(() => accounts.id, { onDelete: "set null" }),
    teamAccessEnded: integer("team_access_ended").notNull().default(0),
    mcpTokensRevoked: integer("mcp_tokens_revoked").notNull().default(0),
    at: timestamptz("at").notNull(),
  },
  (t) => [uniqueIndex("occasion_handovers_occasion_uq").on(t.occasionId), index("occasion_handovers_business_idx").on(t.businessId, t.at)],
);

export const LIBRARY_KINDS = ["template", "checklist", "contact", "asset"] as const;
export type LibraryKind = (typeof LIBRARY_KINDS)[number];
export const libraryKindSchema = z.enum(LIBRARY_KINDS);

export type LibraryTemplateTask = { id: string; title: string; offsetMonths: number; offsetDays: number };
export type LibraryBody =
  | { kind: "template"; tasks: LibraryTemplateTask[] }
  | { kind: "checklist"; items: string[] }
  | { kind: "contact"; category: string | null; person: string | null; email: string | null; phone: string | null; notes: string | null }
  | { kind: "asset"; assetKind: "image" | "pdf" };

/** P19: reusable things of a business — task templates, checklists, supplier contacts, files. */
export const businessLibraryItems = pgTable(
  "business_library_items",
  {
    id: id(),
    businessId: ref("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    kind: text("kind").$type<LibraryKind>().notNull(),
    title: text("title").notNull(),
    body: jsonb("body").$type<LibraryBody>().notNull(),
    /** kind "asset": the file (owner type "business"). */
    assetId: text("asset_id"),
    createdByAccountId: ref("created_by_account_id").references(() => accounts.id, { onDelete: "set null" }),
    archivedAt: timestamptz("archived_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("business_library_items_business_idx").on(t.businessId, t.kind, t.archivedAt),
    check("business_library_items_kind_ck", sql`${t.kind} in ('template', 'checklist', 'contact', 'asset')`),
  ],
);

/**
 * A library file shared into an occasion. The row is what keeps the file readable for the
 * occasion's members — it survives a plan lapse (P23) and a handover (P22).
 */
export const businessLibraryLinks = pgTable(
  "business_library_links",
  {
    id: id(),
    itemId: ref("item_id")
      .notNull()
      .references(() => businessLibraryItems.id, { onDelete: "cascade" }),
    occasionId: ref("occasion_id")
      .notNull()
      .references(() => occasions.id, { onDelete: "cascade" }),
    /** Copied at share time so the occasion keeps what it was given. */
    title: text("title").notNull(),
    assetId: text("asset_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("business_library_links_uq").on(t.itemId, t.occasionId), index("business_library_links_occasion_idx").on(t.occasionId)],
);
