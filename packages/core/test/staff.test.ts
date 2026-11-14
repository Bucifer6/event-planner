import {
  accounts,
  approvalRequests,
  auditLog,
  consoleSessions,
  contentReports,
  desc,
  eq,
  occasions,
  sessions,
  sql,
  staffMembers,
  totpSecrets,
  type StaffRole,
} from "@ed/db";
import { setupTestDb, type TestDb } from "@ed/db/testing";
import { isAppError } from "@ed/shared/errors";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  approveRequest,
  cancelRequest,
  listApprovals,
  registerApprovalAction,
  rejectRequest,
  requestApproval,
  SIGN_IN_LIMITS_ACTION,
  STAFF_SET_ROLES_ACTION,
} from "../src/approvals";
import * as auditview from "../src/auditview";
import {
  areLegalDocsPublished,
  getLaunchChecklist,
  setLaunchItem,
  setLegalPublished,
} from "../src/compliance";
import { accountCtx, anonymousCtx, makeCtx, systemCtx, type Ctx } from "../src/context";
import { createIncident } from "../src/incidents";
import { getSignInLimits, issueFormStamp } from "../src/ratelimit";
import {
  decideContentReport,
  listContentReports,
  onContentReportDecided,
  startContentReportReview,
  submitContentReport,
} from "../src/reports";
import {
  getConsoleAccess,
  getDashboard,
  grantStaffBootstrap,
  isSingleOperatorMode,
  listStaff,
  registerDashboardCounter,
  requireStaffRole,
  resolveStaff,
  type StaffCtx,
} from "../src/staff";

let t: TestDb;
beforeAll(async () => {
  t = await setupTestDb();
});
afterAll(async () => {
  await t.close();
});

const T0 = new Date("2026-03-02T08:00:00Z");
const min = (n: number) => new Date(T0.getTime() + n * 60_000);
let seq = 0;

async function mkAccount(email?: string): Promise<string> {
  const [row] = await t.db
    .insert(accounts)
    .values({ kind: "email", email: email ?? `person${++seq}@example.test` })
    .returning({ id: accounts.id });
  return row!.id;
}

async function mkSession(accountId: string, createdAt: Date): Promise<string> {
  const [row] = await t.db
    .insert(sessions)
    .values({
      accountId,
      tokenHash: `hash-${++seq}`,
      createdAt,
      lastSeenAt: createdAt,
      expiresAt: new Date(createdAt.getTime() + 30 * 24 * 3_600_000),
    })
    .returning({ id: sessions.id });
  return row!.id;
}

async function enableTotp(accountId: string, at: Date): Promise<void> {
  await t.db.insert(totpSecrets).values({ accountId, secretEnc: "x", enabledAt: at });
}

/** A request ctx as the web app builds it: an account actor carrying its session id. */
function webCtx(accountId: string, sessionId: string, now: Date): Ctx {
  return makeCtx(t.db, { kind: "account", accountId, sessionId } as never, { now });
}

type Person = { accountId: string; sessionId: string; staffId: string; at: (now: Date) => Promise<StaffCtx> };

/** A fully set-up staff member: roles, two-step on, signed in (with the second step) at T0. */
async function mkStaff(roles: StaffRole[], signedInAt: Date = T0): Promise<Person> {
  const accountId = await mkAccount();
  await enableTotp(accountId, new Date(signedInAt.getTime() - 3_600_000));
  const sessionId = await mkSession(accountId, signedInAt);
  const [row] = await t.db.insert(staffMembers).values({ accountId, roles }).returning({ id: staffMembers.id });
  return {
    accountId,
    sessionId,
    staffId: row!.id,
    at: (now) => resolveStaff(webCtx(accountId, sessionId, now)),
  };
}

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "ok";
  } catch (e) {
    return isAppError(e) ? e.code : `other:${String(e)}`;
  }
}

describe("console guard (S5)", () => {
  it("an account that is not on the staff gets nothing", async () => {
    const accountId = await mkAccount();
    const sessionId = await mkSession(accountId, T0);
    expect((await getConsoleAccess(webCtx(accountId, sessionId, min(1)))).state).toBe("not_staff");
    expect((await getConsoleAccess(anonymousCtx(t.db))).state).toBe("not_staff");
    expect(await code(resolveStaff(webCtx(accountId, sessionId, min(1))))).toBe("FORBIDDEN");
  });

  it("a staff account without two-step can never reach the console or any staff function", async () => {
    const accountId = await mkAccount();
    const sessionId = await mkSession(accountId, T0);
    await t.db.insert(staffMembers).values({ accountId, roles: ["platform_admin"] });
    const ctx = webCtx(accountId, sessionId, min(1));
    expect((await getConsoleAccess(ctx)).state).toBe("two_step_required");
    expect(await code(resolveStaff(ctx))).toBe("FORBIDDEN");
    // the plain account ctx is not a staff ctx: every staff core function refuses it
    expect(await code(getDashboard(ctx))).toBe("FORBIDDEN");
    expect(await code(listStaff(ctx))).toBe("FORBIDDEN");
    expect(await code(auditview.listAudit(ctx))).toBe("FORBIDDEN");
    expect(await code(requestApproval(ctx, { action: STAFF_SET_ROLES_ACTION, payload: {}, reason: "test" }))).toBe("FORBIDDEN");
    // enrolment started but never confirmed is still "no two-step"
    await t.db.insert(totpSecrets).values({ accountId, secretEnc: "x", enabledAt: null });
    expect((await getConsoleAccess(ctx)).state).toBe("two_step_required");
    expect(await t.db.select().from(consoleSessions).where(eq(consoleSessions.sessionId, sessionId))).toHaveLength(0);
  });

  it("a session opened before two-step was enabled must sign in again", async () => {
    const accountId = await mkAccount();
    const oldSession = await mkSession(accountId, T0);
    await enableTotp(accountId, min(10));
    await t.db.insert(staffMembers).values({ accountId, roles: ["content_editor"] });
    expect(await getConsoleAccess(webCtx(accountId, oldSession, min(20)))).toEqual({
      state: "sign_in_again",
      reason: "second_step",
    });
    // no session id at all (e.g. a bare accountCtx) is refused the same way
    expect((await getConsoleAccess(accountCtx(t.db, accountId, { now: min(20) }))).state).toBe("sign_in_again");
    const fresh = await mkSession(accountId, min(21));
    const access = await getConsoleAccess(webCtx(accountId, fresh, min(22)));
    expect(access.state).toBe("ok");
    if (access.state === "ok") {
      expect(access.ctx.actor).toMatchObject({ kind: "staff", accountId, roles: ["content_editor"] });
      expect(access.expiresAt.toISOString()).toBe(new Date(min(21).getTime() + 12 * 3_600_000).toISOString());
    }
  });

  it("the console session ends after 30 minutes idle and is never reopened", async () => {
    const p = await mkStaff(["platform_admin"]);
    const ctxAt = (m: number) => webCtx(p.accountId, p.sessionId, min(m));
    expect((await getConsoleAccess(ctxAt(1))).state).toBe("ok");
    expect((await getConsoleAccess(ctxAt(25))).state).toBe("ok"); // activity moves the idle clock
    expect((await getConsoleAccess(ctxAt(54))).state).toBe("ok"); // 29 min after the last activity
    expect(await getConsoleAccess(ctxAt(85))).toEqual({ state: "sign_in_again", reason: "idle" });
    expect(await getConsoleAccess(ctxAt(86))).toEqual({ state: "sign_in_again", reason: "idle" });
    expect(await code(p.at(min(86)))).toBe("FORBIDDEN");
    const ended = await t.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "console.session_ended"));
    expect(ended.some((r) => (r.meta as { reason?: string }).reason === "idle")).toBe(true);
    // signing in again (a new web session, second step included) opens a new console session
    const again = await mkSession(p.accountId, min(90));
    expect((await getConsoleAccess(webCtx(p.accountId, again, min(91)))).state).toBe("ok");
  });

  it("the console session ends 12 hours after sign-in however active it is", async () => {
    const p = await mkStaff(["platform_admin"]);
    for (let m = 1; m < 12 * 60; m += 25) {
      expect((await getConsoleAccess(webCtx(p.accountId, p.sessionId, min(m)))).state).toBe("ok");
    }
    expect(await getConsoleAccess(webCtx(p.accountId, p.sessionId, min(12 * 60 + 1)))).toEqual({
      state: "sign_in_again",
      reason: "absolute",
    });
    // a web session older than 12 h can not start a console session at all
    const q = await mkStaff(["platform_admin"]);
    expect(await getConsoleAccess(webCtx(q.accountId, q.sessionId, min(13 * 60)))).toEqual({
      state: "sign_in_again",
      reason: "absolute",
    });
  });

  it("a deactivated staff member is locked out; roles are not implied by each other", async () => {
    const p = await mkStaff(["content_editor"]);
    const ctx = await p.at(min(1));
    expect(() => requireStaffRole(ctx, "content_editor")).not.toThrow();
    expect(() => requireStaffRole(ctx, "platform_admin", "privacy_owner")).toThrow();
    await t.db.update(staffMembers).set({ active: false }).where(eq(staffMembers.id, p.staffId));
    expect((await getConsoleAccess(webCtx(p.accountId, p.sessionId, min(2)))).state).toBe("not_staff");
    await t.db.delete(staffMembers).where(eq(staffMembers.id, p.staffId));
  });
});

describe("second-person approvals (W9)", () => {
  let effect = 0;
  beforeAll(() => {
    registerApprovalAction("test.bump", {
      roles: ["commercial_manager"],
      input: z.object({ by: z.number().int() }),
      describe: (p) => ({ key: "console.approvals.actions.test", params: { by: p.by } }),
      execute: async (_ctx, p) => {
        effect += p.by;
      },
    });
    registerApprovalAction("test.compliance_access", {
      roles: ["privacy_owner"],
      approvalsNeeded: 2,
      describe: () => ({ key: "console.approvals.actions.test" }),
      execute: async () => {
        effect += 100;
      },
    });
  });

  it("single-operator mode: the request queues with no effect until a second person approves", async () => {
    await t.db.update(staffMembers).set({ active: false });
    const a = await mkStaff(["platform_admin", "commercial_manager"]);
    const actx = await a.at(min(1));
    expect(await isSingleOperatorMode(actx)).toBe(true);

    const req = await requestApproval(actx, { action: "test.bump", payload: { by: 5 }, reason: "price change" });
    expect(req.state).toBe("pending");
    expect(req.singleOperatorMode).toBe(true);
    expect(effect).toBe(0);
    const [requested] = await t.db
      .select()
      .from(auditLog)
      .where(sql`${auditLog.action} = 'approval.requested' and ${auditLog.objectId} = ${req.id}`);
    expect(requested!.meta).toMatchObject({ singleOperatorMode: true });
    expect(requested!.actorKind).toBe("staff");

    // the only operator cannot approve their own request — it stays queued, nothing happens
    expect(await code(approveRequest(actx, req.id))).toBe("FORBIDDEN");
    expect(await code(rejectRequest(actx, req.id, { reason: "changed my mind" }))).toBe("FORBIDDEN");
    expect(effect).toBe(0);
    const queue = await listApprovals(actx);
    expect(queue.find((q) => q.id === req.id)).toMatchObject({ mine: true, canDecide: false, singleOperatorMode: true });

    // a second person joins the staff (bootstrap CLI path) and approves
    const bAccount = await mkAccount("second@example.test");
    await enableTotp(bAccount, min(-60));
    await grantStaffBootstrap(systemCtx(t.db, { now: min(2) }), {
      email: "second@example.test",
      roles: ["commercial_manager"],
    });
    const bSession = await mkSession(bAccount, min(3));
    const bctx = await resolveStaff(webCtx(bAccount, bSession, min(4)));
    expect(await isSingleOperatorMode(bctx)).toBe(false);
    const res = await approveRequest(bctx, req.id);
    expect(res.executed).toBe(true);
    expect(effect).toBe(5);
    expect(res.request).toMatchObject({ state: "approved", approverStaffId: bctx.actor.staffId });
    expect(res.request.executedAt).not.toBeNull();
    const [approved] = await t.db
      .select()
      .from(auditLog)
      .where(sql`${auditLog.action} = 'approval.approved' and ${auditLog.objectId} = ${req.id}`);
    expect(approved!.meta).toMatchObject({ requestedInSingleOperatorMode: true });

    // approving twice applies once (Q4)
    expect(await code(approveRequest(bctx, req.id))).toBe("CONFLICT");
    expect(effect).toBe(5);
  });

  it("the approver needs the action's role; a rejection runs nothing; the requester may cancel", async () => {
    const a = await mkStaff(["commercial_manager"]);
    const outsider = await mkStaff(["content_editor"]);
    const b = await mkStaff(["commercial_manager"]);
    const before = effect;
    const req = await requestApproval(await a.at(min(1)), { action: "test.bump", payload: { by: 1 }, reason: "refund" });
    expect(await code(approveRequest(await outsider.at(min(2)), req.id))).toBe("FORBIDDEN");
    expect(await code(requestApproval(await outsider.at(min(2)), { action: "test.bump", payload: { by: 1 }, reason: "nope" }))).toBe("FORBIDDEN");
    const rejected = await rejectRequest(await b.at(min(3)), req.id, { reason: "not justified" });
    expect(rejected).toMatchObject({ state: "rejected", decisionReason: "not justified" });
    expect(await code(approveRequest(await b.at(min(4)), req.id))).toBe("CONFLICT");
    expect(effect).toBe(before);

    const req2 = await requestApproval(await a.at(min(5)), { action: "test.bump", payload: { by: 1 }, reason: "second try" });
    expect(await code(cancelRequest(await b.at(min(6)), req2.id))).toBe("FORBIDDEN");
    expect((await cancelRequest(await a.at(min(6)), req2.id)).state).toBe("cancelled");
    expect(effect).toBe(before);
    // an invalid payload is refused at request time
    expect(await code(requestApproval(await a.at(min(7)), { action: "test.bump", payload: { by: "x" }, reason: "bad" }))).toMatch(/other/);
  });

  it("three-person rule: two OTHER people must approve before anything happens", async () => {
    const a = await mkStaff(["privacy_owner"]);
    const b = await mkStaff(["privacy_owner"]);
    const c = await mkStaff(["privacy_owner"]);
    const before = effect;
    const req = await requestApproval(await a.at(min(1)), {
      action: "test.compliance_access",
      payload: {},
      reason: "authority request",
    });
    expect(req.approvalsNeeded).toBe(2);
    const first = await approveRequest(await b.at(min(2)), req.id);
    expect(first).toMatchObject({ executed: false, remaining: 1 });
    expect(effect).toBe(before);
    expect(await code(approveRequest(await b.at(min(3)), req.id))).toBe("CONFLICT"); // same person twice
    expect(await code(approveRequest(await a.at(min(3)), req.id))).toBe("FORBIDDEN"); // the requester
    expect(effect).toBe(before);
    const second = await approveRequest(await c.at(min(4)), req.id);
    expect(second.executed).toBe(true);
    expect(effect).toBe(before + 100);
  });

  it("staff roles and sign-in limits change only through an approval", async () => {
    const a = await mkStaff(["platform_admin", "security_administrator"]);
    const b = await mkStaff(["platform_admin", "security_administrator"]);
    const target = await mkAccount("newmod@example.test");
    const actx = await a.at(min(1));
    const req = await requestApproval(actx, {
      action: STAFF_SET_ROLES_ACTION,
      payload: { accountId: target, label: "newmod@example.test", roles: ["listing_moderator"] },
      reason: "new moderator",
    });
    expect(await t.db.select().from(staffMembers).where(eq(staffMembers.accountId, target))).toHaveLength(0);
    await approveRequest(await b.at(min(2)), req.id);
    const [row] = await t.db.select().from(staffMembers).where(eq(staffMembers.accountId, target));
    expect(row).toMatchObject({ roles: ["listing_moderator"], active: true });
    const staff = await listStaff(actx);
    expect(staff.find((s) => s.accountId === target)).toMatchObject({ label: "newmod@example.test", twoStepEnabled: false });

    const limits = await requestApproval(actx, {
      action: SIGN_IN_LIMITS_ACTION,
      payload: { codeRequestPerIpPerHour: 7 },
      reason: "abuse wave",
    });
    expect((await getSignInLimits(actx)).codeRequestPerIpPerHour).toBe(10);
    await approveRequest(await b.at(min(3)), limits.id);
    expect((await getSignInLimits(actx)).codeRequestPerIpPerHour).toBe(7);

    // the platform can never be left without an active platform_admin
    await t.db.update(staffMembers).set({ active: false }).where(sql`${staffMembers.id} not in (${a.staffId}, ${b.staffId})`);
    const dropB = await requestApproval(actx, {
      action: STAFF_SET_ROLES_ACTION,
      payload: { accountId: b.accountId, roles: ["security_administrator"] },
      reason: "narrow",
    });
    await approveRequest(await b.at(min(4)), dropB.id);
    const b2 = await b.at(min(5));
    const dropA = await requestApproval(await a.at(min(5)), {
      action: STAFF_SET_ROLES_ACTION,
      payload: { accountId: a.accountId, roles: [] },
      reason: "leave",
    });
    // b is no longer platform_admin: cannot approve; and nobody else can, so it stays queued
    expect(await code(approveRequest(b2, dropA.id))).toBe("FORBIDDEN");
    const [still] = await t.db.select().from(approvalRequests).where(eq(approvalRequests.id, dropA.id));
    expect(still!.state).toBe("pending");
  });
});

describe("audit log viewer and export (W8, SEC10)", () => {
  it("filters by actor, action, object and date, and pages", async () => {
    const p = await mkStaff(["security_administrator"]);
    const ctx = await p.at(min(1));
    await createIncident(ctx, { messageRo: "Ceva nu funcționează momentan." });
    const all = await auditview.listAudit(ctx, { limit: 5 });
    expect(all.entries).toHaveLength(5);
    expect(all.nextCursor).not.toBeNull();
    const next = await auditview.listAudit(ctx, { limit: 5, cursor: all.nextCursor! });
    expect(next.entries[0]!.id).not.toBe(all.entries[0]!.id);
    expect(new Set([...all.entries, ...next.entries].map((e) => e.id)).size).toBe(10);

    const byActor = await auditview.listAudit(ctx, { actorKind: "staff", actorId: p.staffId });
    expect(byActor.entries.length).toBeGreaterThan(0);
    expect(byActor.entries.every((e) => e.actorId === p.staffId)).toBe(true);
    const byAction = await auditview.listAudit(ctx, { action: "incident." });
    expect(byAction.entries.every((e) => e.action.startsWith("incident."))).toBe(true);
    const byObject = await auditview.listAudit(ctx, { objectType: "incident" });
    expect(byObject.entries.length).toBeGreaterThan(0);
    const future = await auditview.listAudit(ctx, { from: new Date("2030-01-01T00:00:00Z") });
    expect(future.entries).toHaveLength(0);
    const window = await auditview.listAudit(ctx, { from: min(0), to: min(2), objectType: "incident" });
    expect(window.entries).toHaveLength(1);
    // a staff member without an audit role sees nothing
    const editor = await mkStaff(["content_editor"]);
    expect(await code(auditview.listAudit(await editor.at(min(1))))).toBe("FORBIDDEN");
    expect(await code(auditview.exportAuditCsv(await editor.at(min(1))))).toBe("FORBIDDEN");
  });

  it("the export is a read-only copy and is itself audited", async () => {
    const p = await mkStaff(["platform_admin"]);
    const ctx = await p.at(min(1));
    const before = await t.db.select().from(auditLog).orderBy(desc(auditLog.at), desc(auditLog.id));
    const out = await auditview.exportAuditCsv(ctx, { actorKind: "staff" });
    const lines = out.csv.trimEnd().split("\r\n");
    expect(lines[0]).toBe("id,at,actor_kind,actor_id,action,object_type,object_id,before,after,meta");
    expect(out.rows).toBe(before.filter((r) => r.actorKind === "staff").length);
    expect(lines).toHaveLength(out.rows + 1);
    expect(out.filename).toMatch(/^eventdesk-audit-.*\.csv$/);

    const after = await t.db.select().from(auditLog).orderBy(desc(auditLog.at), desc(auditLog.id));
    // exactly one new row — the export itself — and every earlier row untouched
    expect(after).toHaveLength(before.length + 1);
    const added = after.filter((r) => !before.some((b) => b.id === r.id));
    expect(added[0]).toMatchObject({ action: "audit.exported", actorKind: "staff", actorId: p.staffId });
    expect(added[0]!.meta).toMatchObject({ rows: out.rows, filter: { actorKind: "staff" } });
    expect(after.filter((r) => r.id !== added[0]!.id)).toEqual(before);
  });

  it("no role can edit or delete audit entries: no code path and the database refuses", async () => {
    // the console's only audit module exposes reading and copying, nothing else
    expect(Object.keys(auditview).sort()).toEqual(
      ["AUDIT_EXPORT_MAX_ROWS", "AUDIT_PAGE_SIZE", "auditFilterSchema", "exportAuditCsv", "listAudit"].sort(),
    );
    const [row] = await t.db.select().from(auditLog).limit(1);
    await expect(t.db.update(auditLog).set({ action: "tampered" }).where(eq(auditLog.id, row!.id))).rejects.toThrow();
    await expect(t.db.delete(auditLog).where(eq(auditLog.id, row!.id))).rejects.toThrow();
    await expect(t.db.execute(sql`truncate audit_log`)).rejects.toThrow();
  });

  it("spreadsheet formulas in exported cells are neutralised", async () => {
    const p = await mkStaff(["platform_admin"]);
    const ctx = await p.at(min(1));
    await t.db.insert(auditLog).values({
      actorKind: "system",
      action: "test.csv",
      objectType: "=HYPERLINK(\"http://x\")",
      objectId: 'a "quoted", value',
    });
    const out = await auditview.exportAuditCsv(ctx, { action: "test.csv" });
    expect(out.csv).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(out.csv).toContain(`"a ""quoted"", value"`);
  });
});

describe("dashboard (W1)", () => {
  it("exposes aggregates only — never planner content", async () => {
    const owner = await mkAccount("secret-planner@example.test");
    await t.db.insert(occasions).values({ ownerAccountId: owner, title: "Nunta Secretă a Ioanei" });
    registerDashboardCounter({
      key: "testThings",
      count: async () => ({
        total: 3,
        byStatus: { live: 2, "Ioana Popescu": 1, draft: Number("7") },
      }),
    });
    const p = await mkStaff(["content_editor"]);
    const dash = await getDashboard(await p.at(min(1)));
    expect(dash.accounts.total).toBeGreaterThan(1);
    expect(dash.accounts.email).toBe(dash.accounts.total);
    expect(dash.occasions.total).toBe(1);
    expect(dash.occasions.byStatus).toEqual({ planning: 1 });
    expect(dash.approvals.pending).toBeGreaterThanOrEqual(1);
    expect(dash.staff.active).toBeGreaterThan(0);
    expect(dash.extra.find((e) => e.key === "testThings")).toEqual({
      key: "testThings",
      total: 3,
      byStatus: { live: 2, draft: 7 },
    });

    const text = JSON.stringify(dash);
    expect(text).not.toContain("Secret");
    expect(text).not.toContain("Ioana");
    expect(text).not.toContain("example.test");
    expect(text).not.toContain(owner);
    // every leaf is a number, a boolean, null, or one of the few operational strings
    const allowedString = /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z|[a-z][a-zA-Z0-9._-]*)$/;
    const walk = (v: unknown): void => {
      if (v === null || typeof v === "number" || typeof v === "boolean") return;
      if (typeof v === "string") return void expect(v).toMatch(allowedString);
      if (Array.isArray(v)) return v.forEach(walk);
      Object.values(v as object).forEach(walk);
    };
    walk(dash);
  });
});

describe("legal gate and launch checklist (LAU1, LAU2, LAU9)", () => {
  it("sign-up stays closed until terms, privacy and cookie notice are recorded as published", async () => {
    const sys = systemCtx(t.db, { now: min(0) });
    expect(await areLegalDocsPublished(sys)).toBe(false);
    const privacy = await mkStaff(["privacy_owner"]);
    const editor = await mkStaff(["content_editor"]);
    expect(await code(setLegalPublished(await editor.at(min(1)), {}))).toBe("FORBIDDEN");
    const ctx = await privacy.at(min(1));
    await setLegalPublished(ctx, { termsVersion: "1.0", termsPublishedOn: "2026-03-01", privacyVersion: "1.0", privacyPublishedOn: "2026-03-01" });
    expect(await areLegalDocsPublished(sys)).toBe(false); // cookie notice missing
    await setLegalPublished(ctx, {
      termsVersion: "1.0",
      termsPublishedOn: "2026-03-01",
      privacyVersion: "1.0",
      privacyPublishedOn: "2026-03-01",
      cookiesVersion: "1.0",
      cookiesPublishedOn: "2026-04-01",
    });
    expect(await areLegalDocsPublished(sys)).toBe(false); // cookie notice dated in the future
    expect(await areLegalDocsPublished(anonymousCtx(t.db, { now: new Date("2026-04-02T10:00:00Z") }))).toBe(true);
  });

  it("checklist items start empty and record who and when; only the owning role may write", async () => {
    const privacy = await mkStaff(["privacy_owner"]);
    const ctx = await privacy.at(min(1));
    const list = await getLaunchChecklist(ctx);
    expect(Object.keys(list)).toHaveLength(9);
    expect(list.LAU9).toEqual({ status: "open", evidenceRef: null, note: null, updatedByStaffId: null, updatedAt: null });
    expect(await code(setLaunchItem(ctx, { item: "LAU4", status: "done" }))).toBe("FORBIDDEN"); // security's item
    await setLaunchItem(ctx, { item: "LAU9", status: "done", evidenceRef: "Drive/declaratie-accesibilitate.pdf", note: "" });
    const after = await getLaunchChecklist(ctx);
    expect(after.LAU9).toMatchObject({ status: "done", evidenceRef: "Drive/declaratie-accesibilitate.pdf", note: null, updatedByStaffId: privacy.staffId });
    expect(after.LAU1.status).toBe("open");
  });
});

describe("notice-and-action reports (LAU8)", () => {
  const publicCtx = (ip: string, now: Date) => makeCtx(t.db, { kind: "anonymous" }, { now, ip });
  const stamp = (now: Date) => issueFormStamp(new Date(now.getTime() - 20_000));

  it("intake creates an auditable case; the decision stores the reason given to the affected party", async () => {
    const now = min(10);
    const { id, reference } = await submitContentReport(publicCtx("203.0.113.9", now), {
      targetRef: "https://eventdesk.ro/ro/firme/exemplu",
      targetType: "listing",
      targetId: "lst12345678",
      reasonCategory: "fraud",
      description: "Firma cere avans și nu mai răspunde.",
      reporterContact: "Reporter@Example.test",
      honeypot: "",
      renderedAt: stamp(now),
    });
    expect(reference).toMatch(/^R-[A-Z0-9]{8}$/);
    const [row] = await t.db.select().from(contentReports).where(eq(contentReports.id, id));
    expect(row).toMatchObject({ state: "received", reasonCategory: "fraud", reporterContact: "reporter@example.test" });
    expect(row!.reporterContactHash).toMatch(/^[a-f0-9]{64}$/);
    const [received] = await t.db
      .select()
      .from(auditLog)
      .where(sql`${auditLog.action} = 'content_report.received' and ${auditLog.objectId} = ${id}`);
    expect(received!.actorKind).toBe("anonymous");
    expect(JSON.stringify(received)).not.toContain("reporter@example.test"); // contact never in the audit log

    const moderator = await mkStaff(["listing_moderator"]);
    const editor = await mkStaff(["content_editor"]);
    const mctx = await moderator.at(min(20));
    expect(await code(listContentReports(await editor.at(min(20))))).toBe("FORBIDDEN");
    expect((await listContentReports(mctx)).map((r) => r.id)).toContain(id);
    await startContentReportReview(mctx, id);
    // a decision without a reason for the affected party is refused
    await expect(decideContentReport(mctx, { id, decision: "actioned", reasonGivenToAffected: " " })).rejects.toThrow();
    const seen: string[] = [];
    onContentReportDecided(async (_ctx, d) => {
      seen.push(`${d.decision}:${d.report.targetType}:${d.reasonGivenToAffected}`);
    });
    const reason = "Listarea a fost restricționată: plângeri repetate privind avansuri nereturnate.";
    const decided = await decideContentReport(mctx, { id, decision: "actioned", reasonGivenToAffected: reason });
    expect(decided).toMatchObject({ state: "actioned", reasonGivenToAffected: reason, decidedByStaffId: moderator.staffId });
    expect(seen).toEqual([`actioned:listing:${reason}`]);
    const [decidedAudit] = await t.db
      .select()
      .from(auditLog)
      .where(sql`${auditLog.action} = 'content_report.decided' and ${auditLog.objectId} = ${id}`);
    expect(decidedAudit!.after).toMatchObject({ state: "actioned", reasonGivenToAffected: reason });
    expect(await code(decideContentReport(mctx, { id, decision: "dismissed", reasonGivenToAffected: reason }))).toBe("CONFLICT");
  });

  it("bots and floods are turned away (SEC11)", async () => {
    const now = min(30);
    const base = {
      targetRef: "listing ABC",
      reasonCategory: "other" as const,
      description: "O descriere suficient de lungă.",
    };
    expect(await code(submitContentReport(publicCtx("203.0.113.50", now), { ...base, honeypot: "http://spam", renderedAt: stamp(now) }))).toBe("RATE_LIMITED");
    expect(await code(submitContentReport(publicCtx("203.0.113.50", now), { ...base, honeypot: "", renderedAt: issueFormStamp(now) }))).toBe("RATE_LIMITED"); // too fast
    expect(await code(submitContentReport(publicCtx("203.0.113.50", now), { ...base, honeypot: "", renderedAt: "forged" }))).toBe("RATE_LIMITED");
    for (let i = 0; i < 5; i++) {
      expect(await code(submitContentReport(publicCtx("203.0.113.51", now), { ...base, honeypot: "", renderedAt: stamp(now) }))).toBe("ok");
    }
    expect(await code(submitContentReport(publicCtx("203.0.113.51", now), { ...base, honeypot: "", renderedAt: stamp(now) }))).toBe("RATE_LIMITED");
  });
});
