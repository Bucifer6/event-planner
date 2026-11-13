import { index, jsonb, pgTable, text } from "drizzle-orm/pg-core";
import { createdAt, id, ref } from "./_helpers";

/**
 * Corrections (principle 4): a recorded FACT — a payment, a received quantity, an arrival —
 * is never silently edited. Whoever changes one writes a row here, in the same transaction,
 * saying what it was, what it became and why. Append-only at the database level
 * (src/sql/010_corrections_append_only.sql). Written through @ed/core/corrections only.
 */
export const corrections = pgTable(
  "corrections",
  {
    id: id(),
    /** NULL for facts that do not belong to an occasion. Kept after the occasion is purged. */
    occasionId: ref("occasion_id"),
    targetTable: text("target_table").notNull(),
    targetId: text("target_id").notNull(),
    field: text("field").notNull(),
    before: jsonb("before"),
    after: jsonb("after"),
    reason: text("reason").notNull(),
    actorKind: text("actor_kind").notNull(),
    actorId: text("actor_id"),
    createdAt: createdAt(),
  },
  (t) => [
    index("corrections_target_idx").on(t.targetTable, t.targetId, t.createdAt),
    index("corrections_occasion_idx").on(t.occasionId),
  ],
);
