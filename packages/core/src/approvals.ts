import {
  accounts,
  and,
  approvalDecisions,
  approvalRequests,
  desc,
  eq,
  inArray,
  staffMembers,
  type ApprovalState,
  type StaffRole,
} from "@ed/db";
import { AppError } from "@ed/shared/errors";
import { z } from "zod";
import { audit } from "./audit";
import type { Ctx } from "./context";
import { SIGN_IN_LIMIT_DEFAULTS, SIGN_IN_LIMITS_SETTING } from "./ratelimit";
import {
  applyStaffRoles,
  countActiveStaff,
  hasStaffRole,
  requireStaffRole,
  staffRolesInput,
  writeSetting,
} from "./staff";
import { inTx } from "./tx";

// Second-person approvals (W9, SEC10). Irreversible console actions are never run directly:
//
//   registerApprovalAction("refund.issue", {
//     roles: ["commercial_manager"],            // who may REQUEST it
//     approverRoles: ["commercial_manager"],    // who may APPROVE it (default: same roles)
//     approvalsNeeded: 1,                       // other people needed; 2 = three-person rule
//     input: z.object({ … }),                   // validates the payload at request time
//     describe: (p) => ({ key: "console.approvals.actions.refund", params: { … } }),
//     execute: async (ctx, p) => { … },         // runs ONCE, inside the approving transaction
//   });
//
//   await requestApproval(staffCtx, { action: "refund.issue", payload, reason });
//   await approveRequest(otherStaffCtx, id);    // the requester can never approve their own
//
// Single-operator restricted mode (W9): while fewer than two people hold a staff role the
// request simply waits — nobody else exists to approve it, so it has no effect. The mode is
// stored on the request and written to the audit log.

export type ApprovalText = { key: string; params?: Record<string, string | number> };

export type ApprovalActionDef<P = unknown> = {
  /** Staff roles allowed to request the action. */
  roles: StaffRole[];
  /** Staff roles allowed to approve or reject it. Defaults to `roles`. */
  approverRoles?: StaffRole[];
  /** Approvals by people OTHER than the requester. Default 1 (two people); 2 = three people. */
  approvalsNeeded?: number;
  input?: z.ZodType<P>;
  /** One-line description for the queue (an i18n key + params). No secrets. */
  describe: (payload: P) => ApprovalText;
  /** Does the thing. Runs once, in the transaction that records the final approval. */
  execute: (ctx: Ctx, payload: P, request: { id: string; requesterStaffId: string }) => Promise<void>;
};

const g = globalThis as unknown as { __edApprovalActions?: Map<string, ApprovalActionDef<never>> };
function registry(): Map<string, ApprovalActionDef<never>> {
  return (g.__edApprovalActions ??= new Map());
}

/** Registers (or replaces) an approval-gated action. Name: "<domain>.<verb>". */
export function registerApprovalAction<P>(action: string, def: ApprovalActionDef<P>): void {
  if (!/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/.test(action)) {
    throw new Error(`Invalid approval action "${action}" (expected "<domain>.<verb>")`);
  }
  if (def.roles.length === 0) throw new Error(`Approval action "${action}" needs at least one role`);
  const needed = def.approvalsNeeded ?? 1;
  if (!Number.isInteger(needed) || needed < 1 || needed > 5) {
    throw new Error(`Approval action "${action}": approvalsNeeded must be 1–5`);
  }
  registry().set(action, def as unknown as ApprovalActionDef<never>);
}

export function listApprovalActions(): string[] {
  return [...registry().keys()].sort();
}

function defFor(action: string): ApprovalActionDef<unknown> {
  const def = registry().get(action);
  if (!def) throw new AppError("VALIDATION", "console.errors.unknownApprovalAction");
  return def as unknown as ApprovalActionDef<unknown>;
}

export type ApprovalRequest = typeof approvalRequests.$inferSelect;

const requestInput = z.object({
  action: z.string().min(3).max(120),
  payload: z.unknown(),
  reason: z.string().trim().min(3, "common.validation.required").max(1000),
});

/**
 * Queues an action for a second person. Changes nothing else. The requester must hold one
 * of the action's roles.
 */
export async function requestApproval(
  ctx: Ctx,
  input: { action: string; payload: unknown; reason: string },
): Promise<ApprovalRequest> {
  const data = requestInput.parse(input);
  const def = defFor(data.action);
  const staffId = requireStaffRole(ctx, ...def.roles);
  const payload: unknown = def.input ? def.input.parse(data.payload) : data.payload;
  return inTx(ctx, async (tx) => {
    const single = (await countActiveStaff(tx)) < 2;
    const [row] = await tx.db
      .insert(approvalRequests)
      .values({
        action: data.action,
        payload: JSON.parse(JSON.stringify(payload ?? {})) as unknown,
        requesterStaffId: staffId,
        reason: data.reason,
        singleOperatorMode: single,
        approvalsNeeded: def.approvalsNeeded ?? 1,
        createdAt: tx.now,
      })
      .returning();
    await audit(tx, {
      action: "approval.requested",
      objectType: "approval_request",
      objectId: row!.id,
      after: { action: data.action, payload: row!.payload, reason: data.reason },
      meta: { singleOperatorMode: single, approvalsNeeded: row!.approvalsNeeded },
    });
    return row!;
  });
}

async function lockPending(tx: Ctx, id: string): Promise<ApprovalRequest> {
  const requestId = z.string().min(1).max(64).parse(id);
  const [row] = await tx.db
    .select()
    .from(approvalRequests)
    .where(eq(approvalRequests.id, requestId))
    .for("update");
  if (!row) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  if (row.state !== "pending") throw new AppError("CONFLICT", "console.errors.alreadyDecided");
  return row;
}

function requireApprover(ctx: Ctx, request: ApprovalRequest, def: ApprovalActionDef<unknown>): string {
  const staffId = requireStaffRole(ctx, ...(def.approverRoles ?? def.roles));
  // W9: the person who asked can never be the person who approves.
  if (staffId === request.requesterStaffId) {
    throw new AppError("FORBIDDEN", "console.errors.ownRequest");
  }
  return staffId;
}

export type ApproveResult = {
  request: ApprovalRequest;
  /** True when this approval was the last one needed and the action ran. */
  executed: boolean;
  /** Approvals still missing (three-person actions). */
  remaining: number;
};

/**
 * Records one person's approval. When enough OTHER people have approved, the action runs —
 * in the same transaction, so a failing action leaves the request pending and unapproved.
 */
export async function approveRequest(ctx: Ctx, id: string): Promise<ApproveResult> {
  return inTx(ctx, async (tx) => {
    const request = await lockPending(tx, id);
    const def = defFor(request.action);
    const staffId = requireApprover(tx, request, def);
    const inserted = await tx.db
      .insert(approvalDecisions)
      .values({ requestId: request.id, staffId, decision: "approved", at: tx.now })
      .onConflictDoNothing()
      .returning({ id: approvalDecisions.id });
    if (!inserted[0]) throw new AppError("CONFLICT", "console.errors.alreadyApprovedByYou");
    const approvals = await tx.db
      .select({ staffId: approvalDecisions.staffId })
      .from(approvalDecisions)
      .where(and(eq(approvalDecisions.requestId, request.id), eq(approvalDecisions.decision, "approved")));
    const remaining = Math.max(0, request.approvalsNeeded - approvals.length);
    await audit(tx, {
      action: "approval.approved",
      objectType: "approval_request",
      objectId: request.id,
      meta: {
        action: request.action,
        requestedInSingleOperatorMode: request.singleOperatorMode,
        approvals: approvals.length,
        approvalsNeeded: request.approvalsNeeded,
      },
    });
    if (remaining > 0) return { request, executed: false, remaining };

    const payload: unknown = def.input ? def.input.parse(request.payload) : request.payload;
    await def.execute(tx, payload, { id: request.id, requesterStaffId: request.requesterStaffId });
    const [done] = await tx.db
      .update(approvalRequests)
      .set({ state: "approved", approverStaffId: staffId, decidedAt: tx.now, executedAt: tx.now })
      .where(eq(approvalRequests.id, request.id))
      .returning();
    await audit(tx, {
      action: "approval.executed",
      objectType: "approval_request",
      objectId: request.id,
      meta: { action: request.action, requesterStaffId: request.requesterStaffId },
    });
    return { request: done!, executed: true, remaining: 0 };
  });
}

/** One eligible person (never the requester) saying no ends the request. Nothing runs. */
export async function rejectRequest(
  ctx: Ctx,
  id: string,
  input: { reason: string },
): Promise<ApprovalRequest> {
  const reason = z.string().trim().min(3, "common.validation.required").max(1000).parse(input.reason);
  return inTx(ctx, async (tx) => {
    const request = await lockPending(tx, id);
    const staffId = requireApprover(tx, request, defFor(request.action));
    await tx.db
      .insert(approvalDecisions)
      .values({ requestId: request.id, staffId, decision: "rejected", at: tx.now })
      .onConflictDoUpdate({
        target: [approvalDecisions.requestId, approvalDecisions.staffId],
        set: { decision: "rejected", at: tx.now },
      });
    const [row] = await tx.db
      .update(approvalRequests)
      .set({ state: "rejected", approverStaffId: staffId, decisionReason: reason, decidedAt: tx.now })
      .where(eq(approvalRequests.id, request.id))
      .returning();
    await audit(tx, {
      action: "approval.rejected",
      objectType: "approval_request",
      objectId: request.id,
      meta: { action: request.action, reason },
    });
    return row!;
  });
}

/** The requester withdraws their own pending request. */
export async function cancelRequest(ctx: Ctx, id: string): Promise<ApprovalRequest> {
  const staffId = requireStaffRole(ctx);
  return inTx(ctx, async (tx) => {
    const request = await lockPending(tx, id);
    if (request.requesterStaffId !== staffId) throw new AppError("FORBIDDEN", "common.errors.FORBIDDEN");
    const [row] = await tx.db
      .update(approvalRequests)
      .set({ state: "cancelled", decidedAt: tx.now })
      .where(eq(approvalRequests.id, request.id))
      .returning();
    await audit(tx, {
      action: "approval.cancelled",
      objectType: "approval_request",
      objectId: request.id,
      meta: { action: request.action },
    });
    return row!;
  });
}

export type ApprovalListItem = {
  id: string;
  action: string;
  description: ApprovalText | null;
  reason: string;
  decisionReason: string | null;
  state: ApprovalState;
  singleOperatorMode: boolean;
  approvalsNeeded: number;
  approvals: number;
  requesterLabel: string | null;
  mine: boolean;
  /** This staff member may approve or reject it right now. */
  canDecide: boolean;
  createdAt: Date;
  decidedAt: Date | null;
  executedAt: Date | null;
};

/** The approval queue (any staff member sees it; `canDecide` says who may act). */
export async function listApprovals(
  ctx: Ctx,
  input: { state?: ApprovalState | "all"; limit?: number } = {},
): Promise<ApprovalListItem[]> {
  const staffId = requireStaffRole(ctx);
  const state = input.state ?? "pending";
  const rows = await ctx.db
    .select({
      request: approvalRequests,
      email: accounts.email,
      username: accounts.username,
    })
    .from(approvalRequests)
    .innerJoin(staffMembers, eq(staffMembers.id, approvalRequests.requesterStaffId))
    .innerJoin(accounts, eq(accounts.id, staffMembers.accountId))
    .where(state === "all" ? undefined : eq(approvalRequests.state, state))
    .orderBy(desc(approvalRequests.createdAt))
    .limit(Math.min(Math.max(input.limit ?? 100, 1), 500));
  const ids = rows.map((r) => r.request.id);
  const decisions = ids.length
    ? await ctx.db
        .select({
          requestId: approvalDecisions.requestId,
          staffId: approvalDecisions.staffId,
          decision: approvalDecisions.decision,
        })
        .from(approvalDecisions)
        .where(inArray(approvalDecisions.requestId, ids))
    : [];
  return rows.map(({ request: r, email, username }) => {
    const def = registry().get(r.action) as unknown as ApprovalActionDef<unknown> | undefined;
    const approved = decisions.filter((d) => d.requestId === r.id && d.decision === "approved");
    let description: ApprovalText | null;
    try {
      description = def ? def.describe(r.payload) : null;
    } catch {
      description = null;
    }
    const mine = r.requesterStaffId === staffId;
    return {
      id: r.id,
      action: r.action,
      description,
      reason: r.reason,
      decisionReason: r.decisionReason,
      state: r.state,
      singleOperatorMode: r.singleOperatorMode,
      approvalsNeeded: r.approvalsNeeded,
      approvals: approved.length,
      requesterLabel: email ?? username,
      mine,
      canDecide:
        r.state === "pending" &&
        !mine &&
        !!def &&
        hasStaffRole(ctx, ...(def.approverRoles ?? def.roles)) &&
        !approved.some((d) => d.staffId === staffId),
      createdAt: r.createdAt,
      decidedAt: r.decidedAt,
      executedAt: r.executedAt,
    };
  });
}

/* ── Built-in approval actions ──────────────────────────────────────────── */

export const STAFF_SET_ROLES_ACTION = "staff.set_roles";
export const SIGN_IN_LIMITS_ACTION = "security.sign_in_limits.set";

/** Partial override of the SEC16 sign-in limits; a missing key keeps its default. */
export const signInLimitsInput = z
  .object(
    Object.fromEntries(
      Object.keys(SIGN_IN_LIMIT_DEFAULTS).map((k) => [k, z.number().int().min(1).max(100_000)]),
    ) as Record<keyof typeof SIGN_IN_LIMIT_DEFAULTS, z.ZodNumber>,
  )
  .partial()
  .strict();

// W8: staff roles change only with a second platform_admin.
registerApprovalAction(STAFF_SET_ROLES_ACTION, {
  roles: ["platform_admin"],
  input: staffRolesInput,
  describe: (p): ApprovalText =>
    p.roles.length > 0
      ? {
          key: "console.approvals.actions.staffSetRoles",
          params: { who: p.label ?? p.accountId, count: p.roles.length },
        }
      : { key: "console.approvals.actions.staffRemove", params: { who: p.label ?? p.accountId } },
  execute: (ctx, p) => applyStaffRoles(ctx, p),
});

// SEC16: the sign-in rate limits change only with a second security administrator.
registerApprovalAction(SIGN_IN_LIMITS_ACTION, {
  roles: ["security_administrator"],
  input: signInLimitsInput,
  describe: (p) => ({
    key: "console.approvals.actions.signInLimits",
    params: { count: Object.keys(p).length },
  }),
  execute: (ctx, p) => writeSetting(ctx, SIGN_IN_LIMITS_SETTING, p),
});
