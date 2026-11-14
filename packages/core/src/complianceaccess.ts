import {
  accounts,
  and,
  approvalDecisions,
  approvalRequests,
  complianceAccessGrants,
  desc,
  eq,
  inArray,
  occasions,
  staffMembers,
  COMPLIANCE_SUBJECT_TYPES,
  type ComplianceSubjectType,
  type StaffRole,
} from "@ed/db";
import { AppError } from "@ed/shared/errors";
import { newId } from "@ed/shared/ids";
import { z } from "zod";
import { registerApprovalAction, requestApproval } from "./approvals";
import { audit } from "./audit";
import type { Ctx, StaffActor } from "./context";
import { requireStaffRole } from "./staff";
import { inTx } from "./tx";

// Compliance access to retained data (W8, PRD 19.12): THREE people.
//
//   1. the privacy owner asks for time-boxed access to ONE data subject's records and states
//      the legal reason (e.g. a GDPR access request);
//   2. two OTHER staff members approve (approval action "compliance.access", approvalsNeeded 2);
//   3. for the next `hours` (default 24) the requester — and only the requester — may read
//      that subject's records through functions that call assertComplianceAccess().
//
// Every read under a grant is an audit row. In single-operator mode, or with only two people
// on the staff, the request simply waits: nobody can complete it.
//
// Later features that expose a data subject's records to staff must call:
//
//   await assertComplianceAccess(staffCtx, { subjectType: "account", subjectId }, "what is read");

export const COMPLIANCE_ACCESS_ACTION = "compliance.access";
export const COMPLIANCE_ACCESS_DEFAULT_HOURS = 24;
export const COMPLIANCE_ACCESS_MAX_HOURS = 72;
/** Who may see the list of requests (requester side + the people who can approve). */
export const COMPLIANCE_VIEW_ROLES: StaffRole[] = ["privacy_owner", "platform_admin", "security_administrator"];
const APPROVER_ROLES: StaffRole[] = ["privacy_owner", "platform_admin", "security_administrator"];

export type ComplianceGrant = typeof complianceAccessGrants.$inferSelect;

const zSubjectType = z.enum(COMPLIANCE_SUBJECT_TYPES);
const zSubject = z.object({ subjectType: zSubjectType, subjectId: z.string().min(1).max(64) });

const requestInput = zSubject.extend({
  legalReason: z.string().trim().min(10, "deploys.compliance.errors.reason").max(1000, "common.validation.tooLong"),
  hours: z.number().int().min(1).max(COMPLIANCE_ACCESS_MAX_HOURS).optional(),
});

/** Finds the account a data-subject request is about, by its login email. Privacy owner only. */
export async function findComplianceSubject(ctx: Ctx, input: { email: string }): Promise<{ subjectType: "account"; subjectId: string }> {
  requireStaffRole(ctx, "privacy_owner");
  const email = z.string().trim().toLowerCase().min(3).max(320).parse(input.email);
  const [row] = await ctx.db.select({ id: accounts.id }).from(accounts).where(eq(accounts.email, email));
  if (!row) throw new AppError("NOT_FOUND", "deploys.compliance.errors.subjectNotFound");
  return { subjectType: "account", subjectId: row.id };
}

async function subjectExists(ctx: Ctx, subjectType: ComplianceSubjectType, subjectId: string): Promise<boolean> {
  switch (subjectType) {
    case "account": {
      const [row] = await ctx.db.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, subjectId));
      return !!row;
    }
  }
}

/** Step 1: the privacy owner asks. Gives no access; it only opens the approval request. */
export async function requestComplianceAccess(
  ctx: Ctx,
  input: z.input<typeof requestInput>,
): Promise<{ grantId: string; approvalRequestId: string; singleOperatorMode: boolean }> {
  const staffId = requireStaffRole(ctx, "privacy_owner");
  const data = requestInput.parse(input);
  if (!(await subjectExists(ctx, data.subjectType, data.subjectId))) {
    throw new AppError("NOT_FOUND", "deploys.compliance.errors.subjectNotFound");
  }
  const hours = data.hours ?? COMPLIANCE_ACCESS_DEFAULT_HOURS;
  return inTx(ctx, async (tx) => {
    const grantId = newId();
    const approval = await requestApproval(tx, {
      action: COMPLIANCE_ACCESS_ACTION,
      payload: { grantId, subjectType: data.subjectType, subjectId: data.subjectId, hours },
      reason: data.legalReason,
    });
    await tx.db.insert(complianceAccessGrants).values({
      id: grantId,
      requesterStaffId: staffId,
      subjectType: data.subjectType,
      subjectId: data.subjectId,
      legalReason: data.legalReason,
      approvalRequestId: approval.id,
      hours,
      createdAt: tx.now,
    });
    await audit(tx, {
      action: "compliance_access.requested",
      objectType: "compliance_access_grant",
      objectId: grantId,
      after: { subjectType: data.subjectType, subjectId: data.subjectId, hours, legalReason: data.legalReason },
      meta: { approvalRequestId: approval.id },
    });
    return { grantId, approvalRequestId: approval.id, singleOperatorMode: approval.singleOperatorMode };
  });
}

const grantPayload = zSubject.extend({ grantId: z.string().min(1).max(64), hours: z.number().int().min(1).max(COMPLIANCE_ACCESS_MAX_HOURS) });

// Step 2: two people other than the requester. The clock starts when the second one approves.
registerApprovalAction(COMPLIANCE_ACCESS_ACTION, {
  roles: ["privacy_owner"],
  approverRoles: APPROVER_ROLES,
  approvalsNeeded: 2,
  input: grantPayload,
  describe: (p) => ({ key: "deploys.approvals.complianceAccess", params: { subject: p.subjectId, hours: p.hours } }),
  execute: async (ctx, p, request) => {
    const [row] = await ctx.db.select().from(complianceAccessGrants).where(eq(complianceAccessGrants.id, p.grantId)).for("update");
    if (!row || row.grantedAt || row.revokedAt || row.requesterStaffId !== request.requesterStaffId) {
      throw new AppError("CONFLICT", "deploys.compliance.errors.notPending");
    }
    const expiresAt = new Date(ctx.now.getTime() + row.hours * 3_600_000);
    await ctx.db.update(complianceAccessGrants).set({ grantedAt: ctx.now, expiresAt }).where(eq(complianceAccessGrants.id, row.id));
    const approvers = await ctx.db
      .select({ staffId: approvalDecisions.staffId })
      .from(approvalDecisions)
      .where(and(eq(approvalDecisions.requestId, request.id), eq(approvalDecisions.decision, "approved")));
    await audit(ctx, {
      action: "compliance_access.granted",
      objectType: "compliance_access_grant",
      objectId: row.id,
      meta: {
        subjectType: row.subjectType,
        subjectId: row.subjectId,
        requesterStaffId: row.requesterStaffId,
        approverStaffIds: approvers.map((a) => a.staffId),
        expiresAt: expiresAt.toISOString(),
      },
    });
  },
});

function isLive(grant: ComplianceGrant, now: Date): boolean {
  return !!grant.grantedAt && !grant.revokedAt && !!grant.expiresAt && grant.expiresAt.getTime() > now.getTime();
}

/**
 * Step 3, the guard: throws FORBIDDEN unless the acting staff member holds a LIVE grant for
 * exactly this subject (their own request, approved by two other people, not expired, not
 * revoked). Every successful call writes an audit row naming what was read.
 */
export async function assertComplianceAccess(
  ctx: Ctx,
  subject: { subjectType: ComplianceSubjectType; subjectId: string },
  what = "records",
): Promise<ComplianceGrant> {
  const staffId = requireStaffRole(ctx, "privacy_owner");
  const data = zSubject.parse(subject);
  const rows = await ctx.db
    .select()
    .from(complianceAccessGrants)
    .where(
      and(
        eq(complianceAccessGrants.requesterStaffId, staffId),
        eq(complianceAccessGrants.subjectType, data.subjectType),
        eq(complianceAccessGrants.subjectId, data.subjectId),
      ),
    )
    .orderBy(desc(complianceAccessGrants.createdAt));
  const grant = rows.find((r) => isLive(r, ctx.now));
  if (!grant) throw new AppError("FORBIDDEN", "deploys.compliance.errors.noGrant");
  await audit(ctx, {
    action: "compliance_access.read",
    objectType: data.subjectType,
    objectId: data.subjectId,
    meta: { grantId: grant.id, what: what.slice(0, 100), expiresAt: grant.expiresAt?.toISOString() ?? null },
  });
  return grant;
}

/** The requester (or a security administrator) ends a grant early. */
export async function revokeComplianceAccess(ctx: Ctx, input: { id: string }): Promise<void> {
  const staffId = requireStaffRole(ctx, "privacy_owner", "security_administrator");
  await inTx(ctx, async (tx) => {
    const [row] = await tx.db.select().from(complianceAccessGrants).where(eq(complianceAccessGrants.id, input.id)).for("update");
    if (!row) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
    const security = (tx.actor as StaffActor).roles.includes("security_administrator");
    if (row.requesterStaffId !== staffId && !security) throw new AppError("FORBIDDEN", "common.errors.FORBIDDEN");
    if (!isLive(row, tx.now)) throw new AppError("CONFLICT", "deploys.compliance.errors.notLive");
    await tx.db.update(complianceAccessGrants).set({ revokedAt: tx.now }).where(eq(complianceAccessGrants.id, row.id));
    await audit(tx, {
      action: "compliance_access.revoked",
      objectType: "compliance_access_grant",
      objectId: row.id,
      meta: { subjectType: row.subjectType, subjectId: row.subjectId },
    });
  });
}

export type ComplianceGrantStatus = "pending" | "live" | "expired" | "revoked" | "rejected" | "cancelled";

export type ComplianceGrantView = {
  id: string;
  subjectType: ComplianceSubjectType;
  subjectId: string;
  legalReason: string;
  hours: number;
  status: ComplianceGrantStatus;
  approvals: number;
  approvalsNeeded: number;
  approvalRequestId: string;
  requesterLabel: string | null;
  mine: boolean;
  createdAt: Date;
  grantedAt: Date | null;
  expiresAt: Date | null;
};

/** The requests and grants, newest first. Shows who asked and why — never the records. */
export async function listComplianceGrants(ctx: Ctx, input: { limit?: number } = {}): Promise<ComplianceGrantView[]> {
  const staffId = requireStaffRole(ctx, ...COMPLIANCE_VIEW_ROLES);
  const rows = await ctx.db
    .select({ grant: complianceAccessGrants, approval: approvalRequests, email: accounts.email, username: accounts.username })
    .from(complianceAccessGrants)
    .innerJoin(approvalRequests, eq(approvalRequests.id, complianceAccessGrants.approvalRequestId))
    .innerJoin(staffMembers, eq(staffMembers.id, complianceAccessGrants.requesterStaffId))
    .innerJoin(accounts, eq(accounts.id, staffMembers.accountId))
    .orderBy(desc(complianceAccessGrants.createdAt))
    .limit(Math.min(Math.max(input.limit ?? 50, 1), 200));
  const requestIds = rows.map((r) => r.approval.id);
  const decisions = requestIds.length
    ? await ctx.db
        .select({ requestId: approvalDecisions.requestId })
        .from(approvalDecisions)
        .where(and(inArray(approvalDecisions.requestId, requestIds), eq(approvalDecisions.decision, "approved")))
    : [];
  return rows.map(({ grant, approval, email, username }) => {
    const status: ComplianceGrantStatus = grant.revokedAt
      ? "revoked"
      : grant.grantedAt
        ? isLive(grant, ctx.now)
          ? "live"
          : "expired"
        : approval.state === "rejected"
          ? "rejected"
          : approval.state === "cancelled"
            ? "cancelled"
            : "pending";
    return {
      id: grant.id,
      subjectType: grant.subjectType,
      subjectId: grant.subjectId,
      legalReason: grant.legalReason,
      hours: grant.hours,
      status,
      approvals: decisions.filter((d) => d.requestId === approval.id).length,
      approvalsNeeded: approval.approvalsNeeded,
      approvalRequestId: approval.id,
      requesterLabel: email ?? username,
      mine: grant.requesterStaffId === staffId,
      createdAt: grant.createdAt,
      grantedAt: grant.grantedAt,
      expiresAt: grant.expiresAt,
    };
  });
}

export type DataSubjectExport = {
  filename: string;
  /** Pretty-printed JSON, ready to hand over. */
  json: string;
};

/**
 * The one concrete consumer so far: a minimal GDPR access export for an account — its
 * profile and the ids of the occasions it owns. Works only while the grant is live.
 */
export async function exportDataSubject(ctx: Ctx, input: { grantId: string }): Promise<DataSubjectExport> {
  const staffId = requireStaffRole(ctx, "privacy_owner");
  const [row] = await ctx.db
    .select()
    .from(complianceAccessGrants)
    .where(and(eq(complianceAccessGrants.id, z.string().min(1).max(64).parse(input.grantId)), eq(complianceAccessGrants.requesterStaffId, staffId)));
  if (!row) throw new AppError("FORBIDDEN", "deploys.compliance.errors.noGrant");
  const grant = await assertComplianceAccess(ctx, { subjectType: row.subjectType, subjectId: row.subjectId }, "data subject export");
  if (grant.id !== row.id) throw new AppError("FORBIDDEN", "deploys.compliance.errors.noGrant");

  const [account] = await ctx.db
    .select({
      id: accounts.id,
      kind: accounts.kind,
      email: accounts.email,
      username: accounts.username,
      locale: accounts.locale,
      emailVerifiedAt: accounts.emailVerifiedAt,
      deletionRequestedAt: accounts.deletionRequestedAt,
      deletedAt: accounts.deletedAt,
      createdAt: accounts.createdAt,
    })
    .from(accounts)
    .where(eq(accounts.id, row.subjectId));
  if (!account) throw new AppError("NOT_FOUND", "deploys.compliance.errors.subjectNotFound");
  const owned = await ctx.db
    .select({ id: occasions.id })
    .from(occasions)
    .where(eq(occasions.ownerAccountId, account.id))
    .orderBy(occasions.createdAt);

  const iso = (d: Date | null) => (d ? d.toISOString() : null);
  const body = {
    generatedAt: ctx.now.toISOString(),
    grant: { id: grant.id, legalReason: grant.legalReason, expiresAt: iso(grant.expiresAt) },
    subject: { type: row.subjectType, id: account.id },
    account: {
      id: account.id,
      kind: account.kind,
      email: account.email,
      username: account.username,
      locale: account.locale,
      emailVerifiedAt: iso(account.emailVerifiedAt),
      deletionRequestedAt: iso(account.deletionRequestedAt),
      deletedAt: iso(account.deletedAt),
      createdAt: iso(account.createdAt),
    },
    ownedOccasionIds: owned.map((o) => o.id),
  };
  await audit(ctx, {
    action: "compliance_access.exported",
    objectType: row.subjectType,
    objectId: row.subjectId,
    meta: { grantId: grant.id, occasions: owned.length },
  });
  return { filename: `data-subject-${account.id}-${ctx.now.toISOString().slice(0, 10)}.json`, json: JSON.stringify(body, null, 2) };
}
