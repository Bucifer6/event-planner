import { boolean, index, integer, jsonb, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { z } from "zod";
import { createdAt, id, ref, timestamptz, updatedAt } from "./_helpers";
import { approvalRequests, staffMembers } from "./staff";

// Production deployments started from the console (R0-14, W10, DEP1–DEP7).
// Written through @ed/core/deploys only. One row per deploy or rollback; the row IS the
// deploy history shown in the console (DEP6). Rows are never deleted.

export const DEPLOY_STATES = [
  /** Waiting for a second person (W9). Nothing has happened yet. */
  "requested",
  /** Approved (or emergency); the workflow was dispatched and has not reported yet. */
  "approved",
  /** The pipeline reported its start; `stage` says where it is. */
  "running",
  "succeeded",
  /** Stopped without the new release going live, or a rollback that was refused (DEP5). */
  "failed",
  /** The new release failed its health checks and the previous one was put back (DEP4). */
  "rolled_back",
  /** The approval request was rejected or withdrawn, or the dispatch never started. */
  "cancelled",
] as const;
export type DeployState = (typeof DEPLOY_STATES)[number];
export const deployStateSchema = z.enum(DEPLOY_STATES);

export const DEPLOY_KINDS = ["deploy", "rollback"] as const;
export type DeployKind = (typeof DEPLOY_KINDS)[number];

/** Pipeline stages in the order they run (deploy.yml). */
export const DEPLOY_STAGES = [
  "verify",
  "build",
  "backup",
  "migrate",
  "roll",
  "health",
  "rollback",
  "done",
] as const;
export type DeployStage = (typeof DEPLOY_STAGES)[number];
export const deployStageSchema = z.enum(DEPLOY_STAGES);

export const DEPLOY_CI_STATUSES = ["success", "failure", "pending", "unknown"] as const;
export type DeployCiStatus = (typeof DEPLOY_CI_STATUSES)[number];

/** One entry of the progress log the console shows. Fixed vocabulary + a short note; no secrets. */
export type DeployLogEntry = {
  at: string;
  event: string;
  stage?: DeployStage;
  note?: string;
};

export const deploys = pgTable(
  "deploys",
  {
    id: id(),
    kind: text("kind").$type<DeployKind>().notNull().default("deploy"),
    /** The release tag (vX.Y.Z). A deploy is always a tag, never a branch head (DEP2/DEP3). */
    tag: text("tag").notNull(),
    /** The commit the tag pointed at when the deploy was requested. */
    commitHash: text("commit_hash").notNull(),
    /** The release that was live before; the automatic rollback target (DEP4). */
    previousTag: text("previous_tag"),
    requestedByStaffId: ref("requested_by_staff_id")
      .notNull()
      .references(() => staffMembers.id, { onDelete: "restrict" }),
    /** NULL for an emergency deploy and for a one-person rollback (DEP3, DEP5). */
    approvedByStaffId: ref("approved_by_staff_id").references(() => staffMembers.id, {
      onDelete: "restrict",
    }),
    approvalRequestId: ref("approval_request_id").references(() => approvalRequests.id, {
      onDelete: "restrict",
    }),
    /** DEP3: one security administrator alone; audit-marked, reason required. */
    emergency: boolean("emergency").notNull().default(false),
    /** Why: the request reason, the emergency reason, or the rollback reason given by staff. */
    reason: text("reason"),
    /** CI result on that exact commit when requested (DEP7). */
    ciStatus: text("ci_status").$type<DeployCiStatus>().notNull().default("unknown"),
    state: text("state").$type<DeployState>().notNull().default("requested"),
    stage: text("stage").$type<DeployStage>(),
    /**
     * "production" while the deploy is approved or running, NULL otherwise. The unique index
     * on it is what makes "deploys are disabled while one is running" true under races (DEP6).
     */
    activeLock: text("active_lock"),
    startedAt: timestamptz("started_at"),
    finishedAt: timestamptz("finished_at"),
    durationMs: integer("duration_ms"),
    /** Why the release was rolled back, or why a rollback was refused (DEP4, DEP5). */
    rollbackReason: text("rollback_reason"),
    log: jsonb("log").$type<DeployLogEntry[]>().notNull().default([]),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("deploys_active_lock_uq").on(t.activeLock),
    index("deploys_state_idx").on(t.state, t.createdAt),
    index("deploys_created_idx").on(t.createdAt),
  ],
);
