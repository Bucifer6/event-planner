import { index, pgTable, text } from "drizzle-orm/pg-core";
import { z } from "zod";
import { createdAt, id, timestamptz, updatedAt } from "./_helpers";

// DSA notice-and-action intake (LAU8). Written through @ed/core/reports only.
// Launch-checklist records and the published legal versions live in platform_settings
// (keys "launch.checklist", "launch.records", "legal.published") — see @ed/core/compliance.

export const CONTENT_REPORT_STATES = ["received", "reviewing", "actioned", "dismissed"] as const;
export type ContentReportState = (typeof CONTENT_REPORT_STATES)[number];
export const contentReportStateSchema = z.enum(CONTENT_REPORT_STATES);

export const CONTENT_REPORT_REASONS = [
  "illegal_content",
  "fraud",
  "intellectual_property",
  "privacy",
  "false_information",
  "offensive",
  "other",
] as const;
export type ContentReportReason = (typeof CONTENT_REPORT_REASONS)[number];
export const contentReportReasonSchema = z.enum(CONTENT_REPORT_REASONS);

export const contentReports = pgTable(
  "content_reports",
  {
    id: id(),
    /** Short human reference shown to the reporter ("R-7K2M9QXA"). */
    reference: text("reference").notNull(),
    /** What is reported, as the reporter gave it: a URL or a listing reference. */
    targetRef: text("target_ref").notNull(),
    /** Set when the report came from a known object (e.g. "listing", "business"). */
    targetType: text("target_type"),
    targetId: text("target_id"),
    reasonCategory: text("reason_category").$type<ContentReportReason>().notNull(),
    description: text("description").notNull(),
    /** SHA-256 of the lower-cased contact, for spotting repeat reports. NULL = anonymous. */
    reporterContactHash: text("reporter_contact_hash"),
    /**
     * The contact itself, in plain text: the reporter must be told the decision (DSA art.
     * 16(5)), which a hash cannot do. Visible only to the moderating staff roles; cleared by
     * the retention rule six months after the decision.
     */
    reporterContact: text("reporter_contact"),
    locale: text("locale").$type<"ro" | "en">().notNull().default("ro"),
    state: text("state").$type<ContentReportState>().notNull().default("received"),
    /** Statement of reasons that is GIVEN TO THE AFFECTED PARTY (LAU8, DSA art. 17). */
    reasonGivenToAffected: text("reason_given_to_affected"),
    /** Staff-only note; never shown outside the console. */
    internalNote: text("internal_note"),
    decidedByStaffId: text("decided_by_staff_id"),
    decidedAt: timestamptz("decided_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("content_reports_state_idx").on(t.state, t.createdAt),
    index("content_reports_target_idx").on(t.targetType, t.targetId),
    index("content_reports_reference_idx").on(t.reference),
  ],
);
