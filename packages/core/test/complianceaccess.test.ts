import { accounts, auditLog, complianceAccessGrants, eq, occasions, staffMembers, type StaffRole } from "@ed/db";
import { setupTestDb, type TestDb } from "@ed/db/testing";
import { isAppError } from "@ed/shared/errors";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { approveRequest, rejectRequest } from "../src/approvals";
import {
  assertComplianceAccess,
  COMPLIANCE_ACCESS_DEFAULT_HOURS,
  exportDataSubject,
  findComplianceSubject,
  listComplianceGrants,
  requestComplianceAccess,
  revokeComplianceAccess,
} from "../src/complianceaccess";
import { makeCtx, type Ctx } from "../src/context";

// W8 / PRD 19.12: compliance access to retained data needs three people.

let t: TestDb;
const T0 = new Date("2026-06-01T08:00:00Z");
const hours = (n: number) => new Date(T0.getTime() + n * 3_600_000);
let seq = 0;

type Person = { staffId: string; at: (now: Date) => Ctx };
async function mkStaff(roles: StaffRole[]): Promise<Person> {
  const [account] = await t.db.insert(accounts).values({ kind: "email", email: `staff${++seq}@example.test` }).returning({ id: accounts.id });
  const [staff] = await t.db.insert(staffMembers).values({ accountId: account!.id, roles }).returning({ id: staffMembers.id });
  return { staffId: staff!.id, at: (now) => makeCtx(t.db, { kind: "staff", accountId: account!.id, staffId: staff!.id, roles }, { now }) };
}

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "ok";
  } catch (e) {
    if (isAppError(e)) return e.code;
    // zod input errors are turned into VALIDATION by the action wrapper
    if (e instanceof Error && e.name === "ZodError") return "VALIDATION";
    throw e;
  }
}

async function auditFor(objectId: string): Promise<string[]> {
  const rows = await t.db.select({ action: auditLog.action }).from(auditLog).where(eq(auditLog.objectId, objectId)).orderBy(auditLog.at);
  return rows.map((r) => r.action);
}

let privacy: Person;
let privacy2: Person;
let admin: Person;
let security: Person;
let moderator: Person;
let subjectId: string;
let occasionIds: string[];

beforeAll(async () => {
  t = await setupTestDb();
  privacy = await mkStaff(["privacy_owner"]);
  privacy2 = await mkStaff(["privacy_owner"]);
  admin = await mkStaff(["platform_admin"]);
  security = await mkStaff(["security_administrator"]);
  moderator = await mkStaff(["listing_moderator"]);
  const [subject] = await t.db.insert(accounts).values({ kind: "email", email: "maria@example.test", locale: "ro" }).returning({ id: accounts.id });
  subjectId = subject!.id;
  const rows = await t.db
    .insert(occasions)
    .values([
      { ownerAccountId: subjectId, title: "Nuntă" },
      { ownerAccountId: subjectId, title: "Botez" },
    ] as never)
    .returning({ id: occasions.id });
  occasionIds = rows.map((r) => r.id).sort();
});
afterAll(async () => {
  await t.close();
});

const subject = () => ({ subjectType: "account" as const, subjectId });

describe("compliance access (three-person rule)", () => {
  it("only the privacy owner can ask, for an existing subject, with a real legal reason", async () => {
    expect(await code(requestComplianceAccess(admin.at(T0), { ...subject(), legalReason: "GDPR art. 15 request" }))).toBe("FORBIDDEN");
    expect(await code(requestComplianceAccess(privacy.at(T0), { ...subject(), legalReason: "because" }))).toBe("VALIDATION");
    expect(await code(requestComplianceAccess(privacy.at(T0), { subjectType: "account", subjectId: "nosuchaccount", legalReason: "GDPR art. 15 request" }))).toBe("NOT_FOUND");
    expect(await code(findComplianceSubject(admin.at(T0), { email: "maria@example.test" }))).toBe("FORBIDDEN");
    expect(await findComplianceSubject(privacy.at(T0), { email: " Maria@Example.test " })).toEqual(subject());
  });

  it("without a grant there is no access at all", async () => {
    expect(await code(assertComplianceAccess(privacy.at(T0), subject()))).toBe("FORBIDDEN");
    expect(await code(assertComplianceAccess(admin.at(T0), subject()))).toBe("FORBIDDEN");
  });

  it("requester + ONE approver is not enough; requester + TWO opens it, for 24 hours", async () => {
    const req = await requestComplianceAccess(privacy.at(T0), { ...subject(), legalReason: "GDPR art. 15 access request received 01.06.2026" });
    expect(await code(assertComplianceAccess(privacy.at(hours(0.1)), subject()))).toBe("FORBIDDEN");

    // the requester can never be one of the approvers; nor can a role outside the list
    expect(await code(approveRequest(privacy.at(hours(0.2)), req.approvalRequestId))).toBe("FORBIDDEN");
    expect(await code(approveRequest(moderator.at(hours(0.2)), req.approvalRequestId))).toBe("FORBIDDEN");

    const first = await approveRequest(admin.at(hours(1)), req.approvalRequestId);
    expect(first).toMatchObject({ executed: false, remaining: 1 });
    // two people so far: still nothing
    expect(await code(assertComplianceAccess(privacy.at(hours(1.1)), subject()))).toBe("FORBIDDEN");
    expect(await code(exportDataSubject(privacy.at(hours(1.1)), { grantId: req.grantId }))).toBe("FORBIDDEN");
    // the same approver twice does not count as two
    expect(await code(approveRequest(admin.at(hours(1.2)), req.approvalRequestId))).toBe("CONFLICT");
    expect((await listComplianceGrants(admin.at(hours(1.3))))[0]).toMatchObject({ id: req.grantId, status: "pending", approvals: 1, approvalsNeeded: 2 });

    const second = await approveRequest(security.at(hours(2)), req.approvalRequestId);
    expect(second).toMatchObject({ executed: true, remaining: 0 });

    const grant = await assertComplianceAccess(privacy.at(hours(3)), subject(), "profile");
    expect(grant.id).toBe(req.grantId);
    expect(grant.grantedAt).toEqual(hours(2));
    expect(grant.expiresAt).toEqual(hours(2 + COMPLIANCE_ACCESS_DEFAULT_HOURS));

    // the grant is personal: the approvers and another privacy owner get nothing from it
    expect(await code(assertComplianceAccess(privacy2.at(hours(3)), subject()))).toBe("FORBIDDEN");
    expect(await code(assertComplianceAccess(admin.at(hours(3)), subject()))).toBe("FORBIDDEN");
    expect(await code(exportDataSubject(privacy2.at(hours(3)), { grantId: req.grantId }))).toBe("FORBIDDEN");
    // and it is for this subject only
    expect(await code(assertComplianceAccess(privacy.at(hours(3)), { subjectType: "account", subjectId: "someoneelse" }))).toBe("FORBIDDEN");

    const out = await exportDataSubject(privacy.at(hours(4)), { grantId: req.grantId });
    expect(out.filename).toBe(`data-subject-${subjectId}-2026-06-01.json`);
    const body = JSON.parse(out.json) as { account: { email: string; locale: string }; ownedOccasionIds: string[]; grant: { legalReason: string } };
    expect(body.account).toMatchObject({ email: "maria@example.test", locale: "ro" });
    expect([...body.ownedOccasionIds].sort()).toEqual(occasionIds);
    expect(body.grant.legalReason).toContain("art. 15");
    expect(out.json).not.toContain("Nuntă");

    // every read under the grant is an audit row
    expect(await auditFor(subjectId)).toEqual(["compliance_access.read", "compliance_access.read", "compliance_access.exported"]);
    expect(await auditFor(req.grantId)).toEqual(["compliance_access.requested", "compliance_access.granted"]);
    const [granted] = await t.db.select().from(auditLog).where(eq(auditLog.action, "compliance_access.granted"));
    expect((granted!.meta as { approverStaffIds: string[] }).approverStaffIds.sort()).toEqual([admin.staffId, security.staffId].sort());

    // expiry: live one second before, gone at the limit
    const end = hours(2 + COMPLIANCE_ACCESS_DEFAULT_HOURS);
    expect(await code(assertComplianceAccess(privacy.at(new Date(end.getTime() - 1000)), subject()))).toBe("ok");
    expect(await code(assertComplianceAccess(privacy.at(end), subject()))).toBe("FORBIDDEN");
    expect(await code(exportDataSubject(privacy.at(end), { grantId: req.grantId }))).toBe("FORBIDDEN");
    expect((await listComplianceGrants(privacy.at(end)))[0]).toMatchObject({ id: req.grantId, status: "expired", mine: true });
  });

  it("a rejected request never grants; a live grant can be revoked early", async () => {
    const later = (n: number) => hours(100 + n);
    const rejected = await requestComplianceAccess(privacy.at(later(0)), { ...subject(), legalReason: "court order no. 12 of 2026", hours: 2 });
    await approveRequest(admin.at(later(1)), rejected.approvalRequestId);
    await rejectRequest(security.at(later(2)), rejected.approvalRequestId, { reason: "the order is not for us" });
    expect(await code(assertComplianceAccess(privacy.at(later(3)), subject()))).toBe("FORBIDDEN");
    expect((await listComplianceGrants(security.at(later(3)))).find((x) => x.id === rejected.grantId)?.status).toBe("rejected");

    const req = await requestComplianceAccess(privacy.at(later(4)), { ...subject(), legalReason: "GDPR art. 15 access request, second copy", hours: 2 });
    await approveRequest(privacy2.at(later(5)), req.approvalRequestId);
    await approveRequest(admin.at(later(5)), req.approvalRequestId);
    expect(await code(assertComplianceAccess(privacy.at(later(6)), subject()))).toBe("ok");
    expect(await code(revokeComplianceAccess(privacy2.at(later(6)), { id: req.grantId }))).toBe("FORBIDDEN");
    await revokeComplianceAccess(security.at(later(6)), { id: req.grantId });
    expect(await code(assertComplianceAccess(privacy.at(later(6.5)), subject()))).toBe("FORBIDDEN");
    const [row] = await t.db.select().from(complianceAccessGrants).where(eq(complianceAccessGrants.id, req.grantId));
    expect(row!.revokedAt).toEqual(later(6));
    expect(await code(listComplianceGrants(moderator.at(later(7))))).toBe("FORBIDDEN");
  });
});
