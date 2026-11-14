import { index, integer, pgTable, primaryKey, text } from "drizzle-orm/pg-core";
import { accounts } from "./accounts";
import { createdAt, id, ref, timestamptz, updatedAt } from "./_helpers";

// AI text feature (INF7, Q6): wording suggestions only. The quota is ten results per account
// per calendar month, counted here; the texts themselves are not stored by this feature —
// a suggestion lives only in the edit box until the user accepts it into their own record.

export const AI_TEXT_PURPOSES = ["invitation", "save_the_date", "thanks", "message", "promotion"] as const;
export type AiTextPurpose = (typeof AI_TEXT_PURPOSES)[number];

/** One row per account and month ("2026-11", Europe/Bucharest); `used` never exceeds the monthly limit. */
export const aiTextUsage = pgTable(
  "ai_text_usage",
  {
    accountId: ref("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    month: text("month").notNull(),
    used: integer("used").notNull().default(0),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.accountId, t.month] })],
);

/** What was asked for and which provider/model answered — never the text. */
export const aiTextResults = pgTable(
  "ai_text_results",
  {
    id: id(),
    accountId: ref("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    month: text("month").notNull(),
    purpose: text("purpose").$type<AiTextPurpose>().notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    /** Set when the user accepted the suggestion (possibly edited) into their own text. */
    acceptedAt: timestamptz("accepted_at"),
    createdAt: createdAt(),
  },
  (t) => [index("ai_text_results_account_month_idx").on(t.accountId, t.month)],
);
