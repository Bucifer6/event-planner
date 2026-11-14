import { index, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { accounts } from "./accounts";
import { createdAt, id, ref, updatedAt } from "./_helpers";
import type { OccasionKind } from "./occasions";

/**
 * Lessons learned at closeout (B10). They belong to the ACCOUNT that wrote them, not to the
 * occasion: they are offered again when the same person plans their next occasion and survive
 * the occasion's deletion (occasion_id has no foreign key; the title is a snapshot).
 */
export const lessons = pgTable(
  "lessons",
  {
    id: id(),
    accountId: ref("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    occasionKind: text("occasion_kind").$type<OccasionKind>().notNull(),
    occasionId: ref("occasion_id").notNull(),
    occasionTitle: text("occasion_title").notNull(),
    body: text("body").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("lessons_account_occasion_uq").on(t.accountId, t.occasionId),
    index("lessons_account_kind_idx").on(t.accountId, t.occasionKind),
  ],
);
