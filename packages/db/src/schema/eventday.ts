import { index, jsonb, pgTable, text } from "drizzle-orm/pg-core";
import { z } from "zod";
import { createdAt, id, ref, timestamptz, updatedAt } from "./_helpers";
import { occasions } from "./occasions";
import { tasks } from "./tasks";

// Event day (B7) and readiness decisions (B8).
//
// The event-day view has NO state of its own: Pregătit / În desfășurare / În așteptare / Gata
// are the task statuses todo / doing / waiting / done of the same task rows (principle 2).
// The only thing a day adds to a task is its time of day, kept here beside the task.

export const taskDayState = pgTable(
  "task_day_state",
  {
    taskId: ref("task_id")
      .primaryKey()
      .references(() => tasks.id, { onDelete: "cascade" }),
    occasionId: ref("occasion_id")
      .notNull()
      .references(() => occasions.id, { onDelete: "cascade" }),
    /** "HH:MM" local time in the occasion's zone. NULL = no fixed time. */
    startTime: text("start_time"),
    /** Phone number to call for this moment of the day (one tap away). */
    contactPhone: text("contact_phone"),
    updatedAt: updatedAt(),
  },
  (t) => [index("task_day_state_occasion_idx").on(t.occasionId)],
);

export const READINESS_DECISIONS = ["hold", "proceed", "conditions"] as const;
export type ReadinessDecisionKind = (typeof READINESS_DECISIONS)[number];
export const readinessDecisionSchema = z.enum(READINESS_DECISIONS);

export const EVIDENCE_TYPES = ["task", "delivery", "briefing_ack", "note"] as const;
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];
export type ReadinessEvidence = {
  type: EvidenceType;
  /** Id of the task / delivery / briefing acknowledgement. Absent for notes. */
  refId?: string;
  /** What it was called when the decision was taken (kept even if the record changes). */
  label: string;
  /** Notes carry a link. */
  url?: string;
};

/** Hold / Proceed / Proceed with conditions, with evidence. Append-only (DB guard). */
export const readinessDecisions = pgTable(
  "readiness_decisions",
  {
    id: id(),
    occasionId: ref("occasion_id")
      .notNull()
      .references(() => occasions.id, { onDelete: "cascade" }),
    decision: text("decision").$type<ReadinessDecisionKind>().notNull(),
    /** Required for "conditions": what must hold. */
    conditions: text("conditions"),
    note: text("note"),
    evidence: jsonb("evidence").$type<ReadinessEvidence[]>().notNull(),
    decidedByMemberId: text("decided_by_member_id"),
    decidedByAccountId: text("decided_by_account_id"),
    decidedByName: text("decided_by_name"),
    decidedAt: timestamptz("decided_at").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("readiness_decisions_occasion_idx").on(t.occasionId, t.decidedAt)],
);
