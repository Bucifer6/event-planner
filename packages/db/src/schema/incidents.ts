import { index, pgTable, text } from "drizzle-orm/pg-core";
import { id, timestamptz } from "./_helpers";

/**
 * Incident log (LAU5). While an incident is unresolved, guest-facing pages show its
 * plain-language message. Written through @ed/core/incidents only.
 */
export const incidents = pgTable(
  "incidents",
  {
    id: id(),
    /** Plain-language message; NULL = the default "Ceva nu funcționează…" text. */
    messageRo: text("message_ro"),
    messageEn: text("message_en"),
    /** Internal note for the console log. Never shown to guests. */
    internalNote: text("internal_note"),
    startedAt: timestamptz("started_at").notNull(),
    resolvedAt: timestamptz("resolved_at"),
    createdBy: text("created_by"),
    resolvedBy: text("resolved_by"),
  },
  (t) => [index("incidents_active_idx").on(t.resolvedAt, t.startedAt)],
);
