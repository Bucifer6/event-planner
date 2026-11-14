import { boolean, index, integer, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { z } from "zod";
import { accounts } from "./accounts";
import { createdAt, id, ref, timestamptz, updatedAt } from "./_helpers";

// Directory picklists (P2, PRD §8 definitions, W4): the fixed launch categories and the fixed
// geography (41 counties + București, localities per county). Seeded by seed/categories.ts
// and seed/geography.ts, afterwards managed only from the console (W4) through
// @ed/core/geography. Listings reference these rows by id/code — there is no free-text
// category or place anywhere in the product.

/** A directory category. `slug` is stable (URLs, seeds); the names can be renamed (W4). */
export const categories = pgTable(
  "categories",
  {
    id: id(),
    slug: text("slug").notNull(),
    nameRo: text("name_ro").notNull(),
    nameEn: text("name_en").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    /** false = retired: no longer offered in forms or pages; existing rows keep referencing it. */
    active: boolean("active").notNull().default(true),
    /** false = its public directory pages are unpublished (W4); still usable on listings. */
    published: boolean("published").notNull().default(true),
    /** Set when the category was merged into another one (W4). */
    mergedIntoId: text("merged_into_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("categories_slug_uq").on(t.slug), index("categories_sort_idx").on(t.sortOrder)],
);

/** A county (județ) or București. `code` is the stable key (vehicle-plate code: CJ, IF, B…). */
export const counties = pgTable(
  "counties",
  {
    code: text("code").primaryKey(),
    slug: text("slug").notNull(),
    nameRo: text("name_ro").notNull(),
    nameEn: text("name_en").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    active: boolean("active").notNull().default(true),
    /** Operator-chosen launch area (W4): shown first on the directory index. */
    launchArea: boolean("launch_area").notNull().default(false),
    /** false = the county's public directory pages are unpublished (W4). */
    published: boolean("published").notNull().default(true),
    mergedIntoCode: text("merged_into_code"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("counties_slug_uq").on(t.slug)],
);

export const LOCALITY_KINDS = ["municipiu", "oras", "comuna", "sector"] as const;
export type LocalityKind = (typeof LOCALITY_KINDS)[number];
export const localityKindSchema = z.enum(LOCALITY_KINDS);

/** A locality inside a county (for București: sectors 1–6). */
export const localities = pgTable(
  "localities",
  {
    id: id(),
    countyCode: ref("county_code")
      .notNull()
      .references(() => counties.code, { onDelete: "restrict" }),
    /** Stable within its county. */
    slug: text("slug").notNull(),
    nameRo: text("name_ro").notNull(),
    /** NULL = same as Romanian. */
    nameEn: text("name_en"),
    kind: text("kind").$type<LocalityKind>().notNull().default("oras"),
    /** County seat (reședință de județ). */
    countySeat: boolean("county_seat").notNull().default(false),
    /** P6: supply justifies a public locality page (operator toggle, W4). */
    publicPage: boolean("public_page").notNull().default(false),
    active: boolean("active").notNull().default(true),
    mergedIntoId: text("merged_into_id"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("localities_county_slug_uq").on(t.countyCode, t.slug),
    index("localities_county_idx").on(t.countyCode, t.sortOrder),
  ],
);

export const DIRECTORY_LINK_SCOPES = ["account", "occasion"] as const;
export type DirectoryLinkScope = (typeof DIRECTORY_LINK_SCOPES)[number];

/**
 * P7: where the "Vezi firme de <categorie> în <zona>" task link is switched off.
 * scope "account"  → subjectId = account id: off everywhere for that person;
 * scope "occasion" → subjectId = occasion id: off for everyone on that occasion.
 * A row means OFF; deleting it switches the link back on.
 */
export const directoryLinkPrefs = pgTable(
  "directory_link_prefs",
  {
    id: id(),
    scope: text("scope").$type<DirectoryLinkScope>().notNull(),
    subjectId: text("subject_id").notNull(),
    setByAccountId: ref("set_by_account_id").references(() => accounts.id, { onDelete: "set null" }),
    dismissedAt: timestamptz("dismissed_at").notNull(),
  },
  (t) => [uniqueIndex("directory_link_prefs_uq").on(t.scope, t.subjectId)],
);
