import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { z } from "zod";
import { accounts, sessions } from "./accounts";
import { createdAt, id, ref, timestamptz, updatedAt } from "./_helpers";

// Platform staff, console sessions and second-person approvals (S5, W8, W9, SEC10).
// Written through @ed/core/staff and @ed/core/approvals only.

export const STAFF_ROLES = [
  "platform_admin",
  "content_editor",
  "listing_moderator",
  "commercial_manager",
  "privacy_owner",
  "security_administrator",
] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];
export const staffRoleSchema = z.enum(STAFF_ROLES);

/** One row per person on the platform's staff. One person may hold several roles. */
export const staffMembers = pgTable(
  "staff_members",
  {
    id: id(),
    accountId: ref("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "restrict" }),
    roles: text("roles").array().$type<StaffRole[]>().notNull().default(sql`'{}'::text[]`),
    /** A revoked staff member keeps the row (audit references it) with active = false. */
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("staff_members_account_uq").on(t.accountId)],
);

/**
 * Console session (S5): at most one per web session. It lives 12 hours from the two-step
 * sign-in that opened the web session and dies after 30 minutes without console activity.
 * Once ended it is never reopened — the person signs in again (with the second step).
 */
export const consoleSessions = pgTable(
  "console_sessions",
  {
    id: id(),
    staffId: ref("staff_id")
      .notNull()
      .references(() => staffMembers.id, { onDelete: "cascade" }),
    sessionId: ref("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    startedAt: timestamptz("started_at").notNull(),
    lastSeenAt: timestamptz("last_seen_at").notNull(),
    /** Absolute limit: web sign-in time + 12 h. */
    expiresAt: timestamptz("expires_at").notNull(),
    endedAt: timestamptz("ended_at"),
    endedReason: text("ended_reason").$type<"idle" | "absolute" | "left">(),
  },
  (t) => [
    uniqueIndex("console_sessions_session_uq").on(t.sessionId),
    index("console_sessions_staff_idx").on(t.staffId, t.startedAt),
  ],
);

export const APPROVAL_STATES = ["pending", "approved", "rejected", "cancelled"] as const;
export type ApprovalState = (typeof APPROVAL_STATES)[number];
export const approvalStateSchema = z.enum(APPROVAL_STATES);

/**
 * A request for an action that needs a second person (W9). Nothing happens until it is
 * approved by enough other staff members; then the registered executor runs once.
 */
export const approvalRequests = pgTable(
  "approval_requests",
  {
    id: id(),
    /** Registered action name, e.g. "staff.set_roles". */
    action: text("action").notNull(),
    payload: jsonb("payload").notNull(),
    requesterStaffId: ref("requester_staff_id")
      .notNull()
      .references(() => staffMembers.id, { onDelete: "restrict" }),
    /** The staff member whose approval completed the request (the last one needed). */
    approverStaffId: ref("approver_staff_id").references(() => staffMembers.id, {
      onDelete: "restrict",
    }),
    state: text("state").$type<ApprovalState>().notNull().default("pending"),
    /** Why the requester asks for it. */
    reason: text("reason").notNull(),
    /** Why it was rejected or cancelled. */
    decisionReason: text("decision_reason"),
    /** True when fewer than two active staff existed at request time (W9). */
    singleOperatorMode: boolean("single_operator_mode").notNull().default(false),
    /** Approvals by OTHER people this action needs (1 = two people, 2 = three people). */
    approvalsNeeded: integer("approvals_needed").notNull().default(1),
    createdAt: createdAt(),
    decidedAt: timestamptz("decided_at"),
    executedAt: timestamptz("executed_at"),
  },
  (t) => [
    index("approval_requests_state_idx").on(t.state, t.createdAt),
    index("approval_requests_requester_idx").on(t.requesterStaffId, t.createdAt),
  ],
);

/** One row per staff member who approved or rejected a request (unique per person). */
export const approvalDecisions = pgTable(
  "approval_decisions",
  {
    id: id(),
    requestId: ref("request_id")
      .notNull()
      .references(() => approvalRequests.id, { onDelete: "cascade" }),
    staffId: ref("staff_id")
      .notNull()
      .references(() => staffMembers.id, { onDelete: "restrict" }),
    decision: text("decision").$type<"approved" | "rejected">().notNull(),
    at: timestamptz("at").notNull(),
  },
  (t) => [uniqueIndex("approval_decisions_uq").on(t.requestId, t.staffId)],
);
