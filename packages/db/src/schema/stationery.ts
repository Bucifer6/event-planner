import { boolean, index, integer, jsonb, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { z } from "zod";
import { accounts } from "./accounts";
import { occasions } from "./occasions";
import { createdAt, id, ref, timestamptz, updatedAt } from "./_helpers";

// Invitation and stationery designer (C-04).
//
// One stationery set per occasion; every save is a new immutable `stationery_versions` row.
// A print-ready PDF may be made only for a version a manager has marked as proofed
// ("Am verificat proba") — the proof mark is the one thing that may change on a version row
// (guarded by src/sql/040_stationery_guards.sql). Any other change is a new, unproofed version.

export const STATIONERY_LOCALES = ["ro", "en"] as const;
export type StationeryLocale = (typeof STATIONERY_LOCALES)[number];
export const stationeryLocaleSchema = z.enum(STATIONERY_LOCALES);

/** The editable text fields of a design, the same for every piece. */
export const STATIONERY_TEXT_FIELDS = [
  "kicker",
  "names",
  "wording",
  "date",
  "time",
  "venue",
  "address",
  "rsvp",
  "saveTheDate",
  "menuTitle",
  "menuBody",
  "thanks",
] as const;
export type StationeryTextField = (typeof STATIONERY_TEXT_FIELDS)[number];

/**
 * One text of the set. `aiGenerated` stays true for text accepted from the AI text feature
 * until the user edits it substantially (INF7); `aiOriginal` is the accepted suggestion the
 * later edits are measured against.
 */
export type StationeryText = { value: string; aiGenerated: boolean; aiOriginal?: string | null };
export type StationeryTexts = Record<StationeryTextField, StationeryText>;

export const stationerySets = pgTable("stationery_sets", {
  occasionId: ref("occasion_id")
    .primaryKey()
    .references(() => occasions.id, { onDelete: "cascade" }),
  /** Number of the newest version (0 = none saved yet). */
  currentVersion: integer("current_version").notNull().default(0),
  /** The version whose wording and colourway the guest link's invitation plate adopts. NULL = the standard plate. */
  digitalVersion: integer("digital_version"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const stationeryVersions = pgTable(
  "stationery_versions",
  {
    id: id(),
    occasionId: ref("occasion_id")
      .notNull()
      .references(() => occasions.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    designKey: text("design_key").notNull(),
    colourwayKey: text("colourway_key").notNull(),
    locale: text("locale").$type<StationeryLocale>().notNull().default("ro"),
    texts: jsonb("texts").$type<StationeryTexts>().notNull(),
    /** Print the household's QR on the invitation (C-09). */
    qrOnInvitation: boolean("qr_on_invitation").notNull().default(false),
    createdByAccountId: ref("created_by_account_id").references(() => accounts.id, { onDelete: "set null" }),
    /** "Am verificat proba": set once by a manager; never cleared. */
    proofedAt: timestamptz("proofed_at"),
    proofedByAccountId: ref("proofed_by_account_id").references(() => accounts.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("stationery_versions_occasion_version_uq").on(t.occasionId, t.version), index("stationery_versions_occasion_idx").on(t.occasionId)],
);
