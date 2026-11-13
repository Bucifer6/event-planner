import { bigint, index, integer, pgTable, primaryKey, text } from "drizzle-orm/pg-core";
import { z } from "zod";
import { createdAt, id, timestamptz, updatedAt } from "./_helpers";

export const ASSET_OWNER_TYPES = ["occasion", "business", "account"] as const;
export type AssetOwnerType = (typeof ASSET_OWNER_TYPES)[number];
export const assetOwnerTypeSchema = z.enum(ASSET_OWNER_TYPES);

export const ASSET_KINDS = ["image", "pdf"] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

export const ASSET_SCAN_STATES = ["pending", "clean", "infected"] as const;
export type AssetScanState = (typeof ASSET_SCAN_STATES)[number];

/**
 * Uploaded files (INF3, SEC4). Written through @ed/storage only. An asset can be read only
 * when scan_state = 'clean' AND visible_at IS NOT NULL AND deleted_at IS NULL.
 */
export const assets = pgTable(
  "assets",
  {
    id: id(),
    ownerType: text("owner_type").$type<AssetOwnerType>().notNull(),
    ownerId: text("owner_id").notNull(),
    kind: text("kind").$type<AssetKind>().notNull(),
    mime: text("mime").notNull(),
    /** Original file name as uploaded (shown when a limit asks which asset to remove). */
    name: text("name").notNull(),
    /** Stored size (after re-encoding); this is what counts towards fair use. */
    bytes: integer("bytes").notNull(),
    sha256: text("sha256").notNull(),
    storageKey: text("storage_key").notNull(),
    scanState: text("scan_state").$type<AssetScanState>().notNull().default("pending"),
    visibleAt: timestamptz("visible_at"),
    createdBy: text("created_by"),
    createdAt: createdAt(),
    deletedAt: timestamptz("deleted_at"),
    /** Set once the stored object itself has been removed (30 days after deleted_at). */
    purgedAt: timestamptz("purged_at"),
  },
  (t) => [
    index("assets_owner_idx").on(t.ownerType, t.ownerId, t.deletedAt),
    index("assets_deleted_idx").on(t.deletedAt, t.purgedAt),
  ],
);

/** Fair-use counters (Q6, Q9), updated in the same transaction as the asset row. */
export const storageUsage = pgTable(
  "storage_usage",
  {
    ownerType: text("owner_type").$type<AssetOwnerType>().notNull(),
    ownerId: text("owner_id").notNull(),
    bytes: bigint("bytes", { mode: "number" }).notNull().default(0),
    files: integer("files").notNull().default(0),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.ownerType, t.ownerId] })],
);
