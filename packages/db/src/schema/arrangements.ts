import { index, integer, jsonb, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { z } from "zod";
import { accounts } from "./accounts";
import { occasions } from "./occasions";
import { createdAt, id, ref, timestamptz, updatedAt } from "./_helpers";

// Visual flower arrangement designer (C-13, F3–F6).
//
// `arrangement_designs` is the named design; each save is an immutable
// `arrangement_versions` row (guarded by src/sql/040_stationery_guards.sql). A quote request
// (F5) points at one version through `arrangement_quote_requests`, so an accepted quote and a
// later design change can be shown side by side (F6).

export const ARRANGEMENT_FORMS = ["round_bouquet", "cascade", "low_table", "tall", "arch", "wreath", "candle"] as const;
export type ArrangementForm = (typeof ARRANGEMENT_FORMS)[number];
export const arrangementFormSchema = z.enum(ARRANGEMENT_FORMS);

export const ARRANGEMENT_SOURCES = ["planner", "assistant"] as const;
export type ArrangementSource = (typeof ARRANGEMENT_SOURCES)[number];

/**
 * One catalogue variety in a design, with what the catalogue said when the version was saved.
 * Prices are indicative (never a quote); NULL = the business published no price per stem.
 */
export type ArrangementLine = {
  catalogueItemId: string;
  stems: number;
  /** One of the variety's published colours, or null when it has none / none was chosen. */
  colour: string | null;
  varietyName: string;
  kind: "flower" | "foliage";
  listingId: string;
  listingName: string;
  pricePerStemMinor: number | null;
  currency: string;
  seasonMonths: number[];
};

export const arrangementDesigns = pgTable(
  "arrangement_designs",
  {
    id: id(),
    occasionId: ref("occasion_id")
      .notNull()
      .references(() => occasions.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    currentVersion: integer("current_version").notNull().default(0),
    createdByAccountId: ref("created_by_account_id").references(() => accounts.id, { onDelete: "set null" }),
    archivedAt: timestamptz("archived_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("arrangement_designs_occasion_idx").on(t.occasionId)],
);

export const arrangementVersions = pgTable(
  "arrangement_versions",
  {
    id: id(),
    designId: ref("design_id")
      .notNull()
      .references(() => arrangementDesigns.id, { onDelete: "cascade" }),
    occasionId: ref("occasion_id")
      .notNull()
      .references(() => occasions.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    form: text("form").$type<ArrangementForm>().notNull(),
    lines: jsonb("lines").$type<ArrangementLine[]>().notNull(),
    note: text("note"),
    source: text("source").$type<ArrangementSource>().notNull().default("planner"),
    createdByAccountId: ref("created_by_account_id").references(() => accounts.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("arrangement_versions_design_version_uq").on(t.designId, t.version), index("arrangement_versions_occasion_idx").on(t.occasionId)],
);

/** Which design version a quote request (an enquiry thread) carried. */
export const arrangementQuoteRequests = pgTable(
  "arrangement_quote_requests",
  {
    id: id(),
    occasionId: ref("occasion_id")
      .notNull()
      .references(() => occasions.id, { onDelete: "cascade" }),
    designId: ref("design_id")
      .notNull()
      .references(() => arrangementDesigns.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    /** enquiries.id — plain text: the thread belongs to the enquiries domain. */
    enquiryId: text("enquiry_id").notNull(),
    listingId: text("listing_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("arrangement_quote_requests_enquiry_uq").on(t.enquiryId), index("arrangement_quote_requests_design_idx").on(t.designId)],
);
