import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgTable, text } from "drizzle-orm/pg-core";
import { z } from "zod";
import { businesses, listings } from "./business";
import { createdAt, currency, id, moneyMinor, ref, timestamptz, updatedAt } from "./_helpers";

// Flower catalogues (F1, F2). Written only through @ed/core/catalogues.
//
// Like a listing, a catalogue's PUBLIC content (its name and the catalogue_items rows) is
// written only when a moderator approves a revision in the shared queue (kind "catalogue").
// What the business types lives in `draft` until then; the live version stays up meanwhile.

export const CATALOGUE_STATES = ["draft", "pending", "live", "retired"] as const;
export type CatalogueState = (typeof CATALOGUE_STATES)[number];
export const catalogueStateSchema = z.enum(CATALOGUE_STATES);

/** F1: the fixed colour palette. No free-text colours. */
export const CATALOGUE_COLOURS = [
  "white",
  "cream",
  "yellow",
  "orange",
  "peach",
  "pink",
  "red",
  "burgundy",
  "purple",
  "lilac",
  "blue",
  "green",
] as const;
export type CatalogueColour = (typeof CATALOGUE_COLOURS)[number];
export const catalogueColourSchema = z.enum(CATALOGUE_COLOURS);

export const CATALOGUE_ITEM_KINDS = ["flower", "foliage"] as const;
export type CatalogueItemKind = (typeof CATALOGUE_ITEM_KINDS)[number];

/** One variety as a business proposes it. `id` is stable across edits (designs refer to it). */
export type CatalogueItemPayload = {
  id: string;
  kind: CatalogueItemKind;
  varietyName: string;
  imageAssetId: string | null;
  /** Months in season, 1–12. Empty = unknown. */
  seasonMonths: number[];
  /** Indicative prices in minor units. null = unknown (never 0). */
  pricePerStemMinor: number | null;
  pricePerBunchMinor: number | null;
  colours: CatalogueColour[];
  notes: string | null;
};

/** What a moderator approves for a catalogue. */
export type CataloguePayload = { name: string; items: CatalogueItemPayload[] };

export const flowerCatalogues = pgTable(
  "flower_catalogues",
  {
    id: id(),
    businessId: ref("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    listingId: ref("listing_id")
      .notNull()
      .references(() => listings.id, { onDelete: "cascade" }),
    /** LIVE name (the working name until the first approval). */
    name: text("name").notNull(),
    state: text("state").$type<CatalogueState>().notNull().default("draft"),
    /** The business's working copy (not public, not yet submitted). */
    draft: jsonb("draft").$type<CataloguePayload>(),
    liveRevisionId: text("live_revision_id"),
    publishedAt: timestamptz("published_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("flower_catalogues_business_idx").on(t.businessId),
    index("flower_catalogues_listing_idx").on(t.listingId, t.state),
    check("flower_catalogues_state_ck", sql`${t.state} in ('draft', 'pending', 'live', 'retired')`),
  ],
);

/** LIVE items of a catalogue. Rewritten (ids kept) when a revision is approved. */
export const catalogueItems = pgTable(
  "catalogue_items",
  {
    id: id(),
    catalogueId: ref("catalogue_id")
      .notNull()
      .references(() => flowerCatalogues.id, { onDelete: "cascade" }),
    businessId: ref("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    kind: text("kind").$type<CatalogueItemKind>().notNull().default("flower"),
    varietyName: text("variety_name").notNull(),
    imageAssetId: text("image_asset_id"),
    seasonMonths: jsonb("season_months").$type<number[]>().notNull().default([]),
    /** NULL = unknown, never 0. */
    pricePerStemMinor: moneyMinor("price_per_stem_minor"),
    pricePerBunchMinor: moneyMinor("price_per_bunch_minor"),
    currency: currency(),
    colours: jsonb("colours").$type<CatalogueColour[]>().notNull().default([]),
    notes: text("notes"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("catalogue_items_catalogue_idx").on(t.catalogueId, t.sortOrder),
    check("catalogue_items_kind_ck", sql`${t.kind} in ('flower', 'foliage')`),
    check(
      "catalogue_items_price_ck",
      sql`(${t.pricePerStemMinor} is null or ${t.pricePerStemMinor} > 0) and (${t.pricePerBunchMinor} is null or ${t.pricePerBunchMinor} > 0)`,
    ),
  ],
);
