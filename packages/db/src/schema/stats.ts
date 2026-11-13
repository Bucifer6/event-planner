import { bigint, index, jsonb, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { id, updatedAt } from "./_helpers";

/**
 * Daily aggregates of application events (INF11, D4). There is deliberately NO column that
 * could hold a visitor, account, session, device or IP: only day + metric + dimensions.
 * Written through @ed/core/stats (recordEvent / stat collectors).
 */
export const statsDaily = pgTable(
  "stats_daily",
  {
    id: id(),
    /** Europe/Bucharest calendar day, "YYYY-MM-DD". */
    day: text("day").notNull(),
    metric: text("metric").notNull(),
    /** Canonical "k=v&k=v" form of `dimensions` (sorted keys); "" when there are none. */
    dimensionKey: text("dimension_key").notNull().default(""),
    dimensions: jsonb("dimensions").$type<Record<string, string>>().notNull().default({}),
    value: bigint("value", { mode: "number" }).notNull().default(0),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("stats_daily_uq").on(t.day, t.metric, t.dimensionKey),
    index("stats_daily_metric_idx").on(t.metric, t.day),
  ],
);
