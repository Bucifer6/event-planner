import { index, jsonb, pgTable, text } from "drizzle-orm/pg-core";
import { z } from "zod";
import { createdAt, id, ref } from "./_helpers";
import { occasions } from "./occasions";

// Plan notes (MCP tools propose_supplier_shortlist, propose_budget_note, propose_budget):
// planner-side notes attached to an occasion. A note is ONLY a note: it notifies nobody,
// sends no enquiry and changes no plan data. Access is decided in @ed/core/plannotes
// (budget notes need the finance grant, D2).

export const PLAN_NOTE_KINDS = ["supplier_shortlist", "budget_note"] as const;
export type PlanNoteKind = (typeof PLAN_NOTE_KINDS)[number];
export const planNoteKindSchema = z.enum(PLAN_NOTE_KINDS);

export const PLAN_NOTE_SOURCES = ["external_assistant", "planner"] as const;
export type PlanNoteSource = (typeof PLAN_NOTE_SOURCES)[number];

/** One shortlisted directory listing, as it was when the note was made. */
export type PlanNoteShortlistItem = {
  listingId: string;
  name: string;
  /** Why it was picked, in the assistant's own words. */
  reason: string | null;
  /** P14: the paid label the listing carried in the search result, kept verbatim. */
  featured: boolean;
};

export const planNotes = pgTable(
  "plan_notes",
  {
    id: id(),
    occasionId: ref("occasion_id")
      .notNull()
      .references(() => occasions.id, { onDelete: "cascade" }),
    kind: text("kind").$type<PlanNoteKind>().notNull(),
    title: text("title"),
    body: text("body"),
    /** Shortlist notes: the listings to consider. */
    items: jsonb("items").$type<PlanNoteShortlistItem[]>().notNull().default([]),
    /** Budget notes: the category the note is about (plain id; NULL = the budget as a whole). */
    budgetCategoryId: text("budget_category_id"),
    /** MCP5: "external_assistant" notes carry the label "creat cu un asistent extern". */
    source: text("source").$type<PlanNoteSource>().notNull().default("planner"),
    /** The What-if preview this note was applied from (SEC15: it records the proposing token). */
    previewId: text("preview_id"),
    createdByAccountId: text("created_by_account_id"),
    createdAt: createdAt(),
  },
  (t) => [index("plan_notes_occasion_idx").on(t.occasionId, t.kind)],
);
