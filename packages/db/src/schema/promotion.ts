import { jsonb, pgTable } from "drizzle-orm/pg-core";
import { occasions } from "./occasions";
import { ref, updatedAt } from "./_helpers";

// Promotion exports (C-12): the description texts the planner edited, kept so the downloads
// say the same thing next time. Assets (image cards, calendar file, poster) are generated on
// request from the occasion's records and are not stored. Nothing here is ever posted anywhere.

export const PROMOTION_TEXT_KEYS = ["shortRo", "longRo", "shortEn", "longEn"] as const;
export type PromotionTextKey = (typeof PROMOTION_TEXT_KEYS)[number];
export type PromotionText = { value: string; aiGenerated: boolean; aiOriginal?: string | null };
export type PromotionTexts = Partial<Record<PromotionTextKey, PromotionText>>;

export const promotionCopies = pgTable("promotion_copies", {
  occasionId: ref("occasion_id")
    .primaryKey()
    .references(() => occasions.id, { onDelete: "cascade" }),
  texts: jsonb("texts").$type<PromotionTexts>().notNull().default({}),
  updatedAt: updatedAt(),
});
