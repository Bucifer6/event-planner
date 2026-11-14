import { generateKeyPairSync } from "node:crypto";
import { accounts, auditLog, deploys, desc, eq, staffMembers, type StaffRole } from "@ed/db";
import { setupTestDb, type TestDb } from "@ed/db/testing";
import { isAppError } from "@ed/shared/errors";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { approveRequest, rejectRequest } from "../src/approvals";
import { makeCtx, systemCtx, type Ctx } from "../src/context";
import {
  abandonDeploy,
  compareTags,
  configureDeploys,
  DEPLOY_STALE_MS,
  getDeployConfig,
  getDeployOverview,
  recordDeployStage,
  requestDeploy,
  requestEmergencyDeploy,
  requestRollback,
  verifyDeployRecordToken,
} from "../src/deploys";

// R0-14 (DEP1–DEP7). GitHub is a fake fetcher: no network.

let t: TestDb;
const T0 = new Date("2026-05-04T09:00:00Z");
const min = (n: number) => new Date(T0.getTime() + n * 60_000);
const sha = (c: string) => c.repeat(40);

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PEM = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
const RECORD_TOKEN = "record-token-0123456789abcdef0123456789abcdef";

type Fake = {
  tags: Record<string, string>;
  /** sha -> state of the "release-ci" status; absent = CI never reported */
  ci: Record<string, "success" | "failure" | "pending">;
  dispatches: Array<{ ref: string; inputs: Record<string, string> }>;
  failDispatch: boolean;
  calls: string[];
  authHeaders: string[];
};
let gh: Fake;

function fetcher(url: string, init?: RequestInit): Promise<Response> {
  const u = new URL(url);
  const path = u.pathname;
  gh.calls.push(`${init?.method ?? "GET"} ${path}`);
  gh.authHeaders.push(String((init?.headers as Record<string, string> | undefined)?.Authorization ?? ""));
  const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));
  if (path === "/app/installations/77/access_tokens") {
    return json({ token: "ghs_installation_token", expires_at: new Date(Date.now() + 3_600_000).toISOString() }, 201);
  }
  const repo = "/repos/acme/eventdesk";
  if (!path.startsWith(repo)) return json({}, 404);
  const rest = path.slice(repo.length);
  const ref = rest.match(/^\/git\/ref\/tags\/(.+)$/);
  if (ref) {
    const tag = decodeURIComponent(ref[1]!);
    const commit = gh.tags[tag];
    // annotated tag: the ref points at a tag object first
    return commit ? json({ ref: `refs/tags/${tag}`, object: { type: "tag", sha: `tagobj-${tag}` } }) : json({}, 404);
  }
  const tagObject = rest.match(/^\/git\/tags\/tagobj-(.+)$/);
  if (tagObject) return json({ object: { type: "commit", sha: gh.tags[tagObject[1]!] } });
  if (rest === "/tags") {
    return json(Object.entries(gh.tags).map(([name, commit]) => ({ name, commit: { sha: commit } })).concat([{ name: "not-a-release", commit: { sha: sha("f") } }]));
  }
  const status = rest.match(/^\/commits\/([0-9a-f]{40})\/status$/);
  if (status) {
    const s = gh.ci[status[1]!];
    return json(s ? { state: s, statuses: [{ context: "release-ci", state: s }] } : { state: "pending", statuses: [] });
  }
  if (/^\/compare\/.+$/.test(rest)) {
    return json({ total_commits: 2, commits: [{ sha: sha("1"), commit: { message: "first\n\nbody", committer: { date: "2026-05-01T10:00:00Z" } } }, { sha: sha("2"), commit: { message: "second" } }] });
  }
  if (rest === "/actions/workflows/deploy.yml/dispatches" && init?.method === "POST") {
    if (gh.failDispatch) return json({ message: "nope" }, 422);
    gh.dispatches.push(JSON.parse(String(init.body)) as Fake["dispatches"][number]);
    return Promise.resolve(new Response(null, { status: 204 }));
  }
  return json({}, 404);
}

const ENV = {
  GITHUB_APP_ID: "12345",
  GITHUB_APP_PRIVATE_KEY: PEM.replace(/\n/g, "\\n"),
  GITHUB_APP_INSTALLATION_ID: "77",
  GITHUB_REPO: "acme/eventdesk",
  DEPLOY_RECORD_TOKEN: RECORD_TOKEN,
  APP_VERSION: "v1.0.0",
};

let seq = 0;
async function mkStaff(roles: StaffRole[]): Promise<{ staffId: string; at: (now: Date) => Ctx }> {
  const [account] = await t.db.insert(accounts).values({ kind: "email", email: `deployer${++seq}@example.test` }).returning({ id: accounts.id });
  const [staff] = await t.db.insert(staffMembers).values({ accountId: account!.id, roles }).returning({ id: staffMembers.id });
  return {
    staffId: staff!.id,
    at: (now) => makeCtx(t.db, { kind: "staff", accountId: account!.id, staffId: staff!.id, roles }, { now }),
  };
}

async function fail(p: Promise<unknown>): Promise<{ code: string; key: string }> {
  try {
    await p;
  } catch (e) {
    if (isAppError(e)) return { code: e.code, key: e.messageKey };
    // zod input errors are turned into VALIDATION by the action wrapper
    if (e instanceof Error && e.name === "ZodError") return { code: "VALIDATION", key: JSON.parse(e.message)[0].message as string };
    throw e;
  }
  throw new Error("expected the call to be refused");
}

async function auditActions(objectId: string): Promise<Array<{ action: string; meta: Record<string, unknown> }>> {
  const rows = await t.db.select().from(auditLog).where(eq(auditLog.objectId, objectId)).orderBy(auditLog.at);
  return rows.map((r) => ({ action: r.action, meta: (r.meta ?? {}) as Record<string, unknown> }));
}

/** Each test starts with an empty deploy history (audit rows stay: they are append-only). */
async function clearActive(): Promise<void> {
  await t.db.delete(deploys);
}

let admin: Awaited<ReturnType<typeof mkStaff>>;
let admin2: Awaited<ReturnType<typeof mkStaff>>;
let security: Awaited<ReturnType<typeof mkStaff>>;
let moderator: Awaited<ReturnType<typeof mkStaff>>;

beforeAll(async () => {
  t = await setupTestDb();
  admin = await mkStaff(["platform_admin"]);
  admin2 = await mkStaff(["platform_admin"]);
  security = await mkStaff(["security_administrator"]);
  moderator = await mkStaff(["listing_moderator"]);
});
afterAll(async () => {
  configureDeploys({ fetcher: undefined, env: undefined });
  await t.close();
});
beforeEach(async () => {
  gh = {
    tags: { "v1.0.0": sha("a"), "v1.1.0": sha("b"), "v1.2.0": sha("c"), "v1.10.0": sha("d") },
    ci: { [sha("a")]: "success", [sha("b")]: "success", [sha("c")]: "failure" },
    dispatches: [],
    failDispatch: false,
    calls: [],
    authHeaders: [],
  };
  configureDeploys({ fetcher, env: ENV });
  await clearActive();
});

/** Runs a deploy all the way to "succeeded" so there is a live release. */
async function deployOk(tag: string, at: number): Promise<string> {
  const req = await requestDeploy(admin.at(min(at)), { tag, reason: "regular release" });
  await approveRequest(admin2.at(min(at + 1)), req.approvalRequestId);
  const sys = (n: number) => systemCtx(t.db, { now: min(n) });
  await recordDeployStage(sys(at + 2), { deployId: req.deployId, event: "start", tag, commitHash: gh.tags[tag] });
  await recordDeployStage(sys(at + 3), { deployId: req.deployId, event: "succeeded" });
  return req.deployId;
}

describe("configuration (DEP1)", () => {
  it("reports the NAMES of what is missing and never needs the network for that", () => {
    configureDeploys({ env: { GITHUB_REPO: "acme/eventdesk" } });
    const config = getDeployConfig();
    expect(config.configured).toBe(false);
    expect(config.missing).toEqual(["GITHUB_APP_ID", "GITHUB_APP_PRIVATE_KEY", "GITHUB_APP_INSTALLATION_ID"]);
    expect(config.recordTokenSet).toBe(false);
  });

  it("an unconfigured console explains itself instead of failing, and refuses requests", async () => {
    configureDeploys({ env: {} });
    const overview = await getDeployOverview(admin.at(min(0)));
    expect(overview.config.configured).toBe(false);
    expect(overview.tags).toEqual([]);
    expect(gh.calls).toEqual([]);
    expect(await fail(requestDeploy(admin.at(min(0)), { tag: "v1.1.0", reason: "release" }))).toEqual({ code: "CONFLICT", key: "deploys.errors.notConfigured" });
  });

  it("the overview carries no credential: no key, no token, only the repo name", async () => {
    const overview = await getDeployOverview(admin.at(min(0)), { candidate: "v1.1.0" });
    const text = JSON.stringify(overview);
    expect(text).not.toContain("PRIVATE KEY");
    expect(text).not.toContain("ghs_installation_token");
    expect(overview.config.repo).toBe("acme/eventdesk");
    // GitHub was called with the installation token, obtained with an app JWT
    expect(gh.authHeaders[0]).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
    expect(gh.authHeaders.slice(1).every((h) => h === "Bearer ghs_installation_token")).toBe(true);
  });

  it("only platform_admin and security_administrator see or request deploys", async () => {
    expect((await fail(getDeployOverview(moderator.at(min(0))))).code).toBe("FORBIDDEN");
    expect((await fail(requestDeploy(moderator.at(min(0)), { tag: "v1.1.0", reason: "release" }))).code).toBe("FORBIDDEN");
  });

  it("the machine token is compared as a hash and must be long", () => {
    expect(verifyDeployRecordToken(RECORD_TOKEN)).toBe(true);
    expect(verifyDeployRecordToken(`${RECORD_TOKEN}x`)).toBe(false);
    expect(verifyDeployRecordToken("")).toBe(false);
    expect(verifyDeployRecordToken(null)).toBe(false);
    configureDeploys({ env: { ...ENV, DEPLOY_RECORD_TOKEN: "short" } });
    expect(verifyDeployRecordToken("short")).toBe(false);
  });
});

describe("overview (DEP2)", () => {
  it("lists release tags newest first with CI status, and the commits up to a candidate", async () => {
    await deployOk("v1.0.0", 0);
    const overview = await getDeployOverview(admin.at(min(10)), { candidate: "v1.1.0" });
    expect(overview.tags.map((x) => x.tag)).toEqual(["v1.10.0", "v1.2.0", "v1.1.0", "v1.0.0"]);
    expect(overview.tags.map((x) => x.ciStatus)).toEqual(["unknown", "failure", "success", "success"]);
    expect(overview.live).toMatchObject({ tag: "v1.0.0", commitHash: sha("a") });
    expect(overview.tags.find((x) => x.live)?.tag).toBe("v1.0.0");
    expect(overview.candidate).toMatchObject({ tag: "v1.1.0", ciStatus: "success", total: 2 });
    expect(overview.candidate?.commits?.map((c) => c.title)).toEqual(["second", "first"]);
    expect(overview.runningVersion).toBe("v1.0.0");
  });

  it("tags sort by version, not by text", () => {
    expect(["v1.2.0", "v1.10.0", "v1.9.3", "v2.0.0-rc.1", "v2.0.0"].sort(compareTags)).toEqual(["v1.2.0", "v1.9.3", "v1.10.0", "v2.0.0-rc.1", "v2.0.0"]);
  });
});

describe("requesting a deploy (DEP3, DEP7)", () => {
  it("refuses anything that is not a release tag", async () => {
    for (const ref of ["main", "refs/heads/main", sha("b"), "v1.1", "release-1"]) {
      expect((await fail(requestDeploy(admin.at(min(0)), { tag: ref, reason: "release" }))).code).toBe("VALIDATION");
    }
    // well-formed, but no such tag in the repository
    expect(await fail(requestDeploy(admin.at(min(0)), { tag: "v9.9.9", reason: "release" }))).toEqual({ code: "VALIDATION", key: "deploys.errors.notATag" });
    expect(gh.dispatches).toEqual([]);
  });

  it("refuses a tag whose CI is not green on that commit — failed, running or never reported", async () => {
    expect(await fail(requestDeploy(admin.at(min(0)), { tag: "v1.2.0", reason: "release" }))).toEqual({ code: "CONFLICT", key: "deploys.errors.ciNotGreen" });
    expect(await fail(requestDeploy(admin.at(min(0)), { tag: "v1.10.0", reason: "release" }))).toEqual({ code: "CONFLICT", key: "deploys.errors.ciNotGreen" });
    gh.ci[sha("d")] = "pending";
    expect((await fail(requestDeploy(admin.at(min(0)), { tag: "v1.10.0", reason: "release" }))).key).toBe("deploys.errors.ciNotGreen");
    expect(await t.db.select().from(deploys).where(eq(deploys.tag, "v1.2.0"))).toEqual([]);
    const refused = await t.db.select().from(auditLog).where(eq(auditLog.action, "deploy.refused"));
    expect(refused.length).toBeGreaterThanOrEqual(3);
    expect(gh.dispatches).toEqual([]);
  });

  it("needs a second person: the request alone deploys nothing, and the requester cannot approve it", async () => {
    const req = await requestDeploy(admin.at(min(0)), { tag: "v1.1.0", reason: "regular release" });
    expect(req.singleOperatorMode).toBe(false);
    const [row] = await t.db.select().from(deploys).where(eq(deploys.id, req.deployId));
    expect(row).toMatchObject({ state: "requested", approvedByStaffId: null, activeLock: null, emergency: false, ciStatus: "success", commitHash: sha("b") });
    expect(gh.dispatches).toEqual([]);

    expect((await fail(approveRequest(admin.at(min(1)), req.approvalRequestId))).code).toBe("FORBIDDEN");
    expect((await fail(approveRequest(moderator.at(min(1)), req.approvalRequestId))).code).toBe("FORBIDDEN");
    expect(gh.dispatches).toEqual([]);

    const res = await approveRequest(admin2.at(min(2)), req.approvalRequestId);
    expect(res.executed).toBe(true);
    const [approved] = await t.db.select().from(deploys).where(eq(deploys.id, req.deployId));
    expect(approved).toMatchObject({ state: "approved", approvedByStaffId: admin2.staffId, activeLock: "production" });
    expect(gh.dispatches).toEqual([
      {
        ref: "main",
        inputs: { tag: "v1.1.0", deployId: req.deployId, mode: "deploy", emergency: "false", requestedBy: admin.staffId, approvedBy: admin2.staffId, previousTag: "" },
      },
    ]);
    const actions = (await auditActions(req.deployId)).map((a) => a.action);
    expect(actions).toEqual(["deploy.requested", "deploy.approved"]);
  });

  it("a rejected request is closed and never dispatches", async () => {
    const req = await requestDeploy(admin.at(min(0)), { tag: "v1.1.0", reason: "regular release" });
    await rejectRequest(security.at(min(1)), req.approvalRequestId, { reason: "not today" });
    const overview = await getDeployOverview(admin.at(min(2)));
    expect(overview.pending).toEqual([]);
    expect(overview.history.find((h) => h.id === req.deployId)?.state).toBe("cancelled");
    expect(gh.dispatches).toEqual([]);
  });

  it("approval re-checks CI and the tag: red CI or a moved tag leaves the request pending", async () => {
    const req = await requestDeploy(admin.at(min(0)), { tag: "v1.1.0", reason: "regular release" });
    gh.ci[sha("b")] = "failure";
    expect((await fail(approveRequest(admin2.at(min(1)), req.approvalRequestId))).key).toBe("deploys.errors.ciNotGreen");
    gh.ci[sha("b")] = "success";
    gh.tags["v1.1.0"] = sha("e");
    expect((await fail(approveRequest(admin2.at(min(2)), req.approvalRequestId))).key).toBe("deploys.errors.tagMoved");
    gh.tags["v1.1.0"] = sha("b");
    gh.failDispatch = true;
    expect((await fail(approveRequest(admin2.at(min(3)), req.approvalRequestId))).key).toBe("deploys.errors.github");
    const [row] = await t.db.select().from(deploys).where(eq(deploys.id, req.deployId));
    expect(row).toMatchObject({ state: "requested", activeLock: null });
    gh.failDispatch = false;
    expect((await approveRequest(admin2.at(min(4)), req.approvalRequestId)).executed).toBe(true);
  });

  it("no new request, approval, emergency or rollback while a deploy is running (DEP6)", async () => {
    await deployOk("v1.0.0", 0);
    const waiting = await requestDeploy(admin.at(min(5)), { tag: "v1.1.0", reason: "queued before" });
    gh.ci[sha("d")] = "success";
    const req = await requestDeploy(admin2.at(min(6)), { tag: "v1.10.0", reason: "regular release" });
    await approveRequest(admin.at(min(7)), req.approvalRequestId);

    expect(await fail(requestDeploy(admin.at(min(8)), { tag: "v1.0.0", reason: "another" }))).toEqual({ code: "CONFLICT", key: "deploys.errors.running" });
    expect((await fail(requestEmergencyDeploy(security.at(min(8)), { tag: "v1.1.0", reason: "urgent security fix" }))).key).toBe("deploys.errors.running");
    expect((await fail(requestRollback(admin.at(min(8)), { reason: "it is bad" }))).key).toBe("deploys.errors.running");
    expect((await fail(approveRequest(admin2.at(min(8)), waiting.approvalRequestId))).key).toBe("deploys.errors.running");
    expect(gh.dispatches).toHaveLength(2);

    await recordDeployStage(systemCtx(t.db, { now: min(9) }), { deployId: req.deployId, event: "start", tag: "v1.10.0" });
    expect((await fail(requestDeploy(admin.at(min(10)), { tag: "v1.0.0", reason: "another" }))).key).toBe("deploys.errors.running");
    const overview = await getDeployOverview(admin.at(min(10)));
    expect(overview.active?.id).toBe(req.deployId);

    await recordDeployStage(systemCtx(t.db, { now: min(11) }), { deployId: req.deployId, event: "succeeded" });
    // the slot is free again
    expect((await approveRequest(admin2.at(min(12)), waiting.approvalRequestId)).executed).toBe(true);
  });
});

describe("emergency deploy (DEP3)", () => {
  it("only a security administrator, with a real reason", async () => {
    expect((await fail(requestEmergencyDeploy(admin.at(min(0)), { tag: "v1.2.0", reason: "urgent security fix" }))).code).toBe("FORBIDDEN");
    expect((await fail(requestEmergencyDeploy(security.at(min(0)), { tag: "v1.2.0", reason: "now" }))).code).toBe("VALIDATION");
    expect((await fail(requestEmergencyDeploy(security.at(min(0)), { tag: "main", reason: "urgent security fix" }))).code).toBe("VALIDATION");
    expect(gh.dispatches).toEqual([]);
  });

  it("one person, CI bypass allowed — and both facts are audit-marked with the reason", async () => {
    const res = await requestEmergencyDeploy(security.at(min(0)), { tag: "v1.2.0", reason: "patch for the session fixation bug" });
    expect(res.ciStatus).toBe("failure");
    const [row] = await t.db.select().from(deploys).where(eq(deploys.id, res.deployId));
    expect(row).toMatchObject({ state: "approved", emergency: true, approvedByStaffId: null, approvalRequestId: null, ciStatus: "failure", activeLock: "production" });
    expect(gh.dispatches).toHaveLength(1);
    expect(gh.dispatches[0]!.inputs).toMatchObject({ tag: "v1.2.0", emergency: "true", requestedBy: security.staffId, approvedBy: "" });

    const [entry] = await auditActions(res.deployId);
    expect(entry!.action).toBe("deploy.emergency_requested");
    expect(entry!.meta).toMatchObject({ emergency: true, ciBypassed: true, secondPersonBypassed: true, reason: "patch for the session fixation bug" });

    await recordDeployStage(systemCtx(t.db, { now: min(1) }), { deployId: res.deployId, event: "start", tag: "v1.2.0" });
    await recordDeployStage(systemCtx(t.db, { now: min(2) }), { deployId: res.deployId, event: "succeeded" });
    const done = (await auditActions(res.deployId)).at(-1)!;
    expect(done.meta).toMatchObject({ emergency: true, ciStatus: "failure", result: "succeeded" });
  });
});

describe("pipeline reports (DEP4, DEP6)", () => {
  it("only the system actor records; the start gate refuses a deploy the console did not approve", async () => {
    const req = await requestDeploy(admin.at(min(0)), { tag: "v1.1.0", reason: "regular release" });
    expect((await fail(recordDeployStage(admin.at(min(1)), { deployId: req.deployId, event: "start", tag: "v1.1.0" }))).code).toBe("FORBIDDEN");
    const sys = (n: number) => systemCtx(t.db, { now: min(n) });
    // still waiting for the second person
    expect(await fail(recordDeployStage(sys(1), { deployId: req.deployId, event: "start", tag: "v1.1.0" }))).toEqual({ code: "CONFLICT", key: "deploys.errors.notApproved" });
    expect((await fail(recordDeployStage(sys(1), { deployId: "nosuchdeploy", event: "start", tag: "v1.1.0" }))).code).toBe("NOT_FOUND");
    await approveRequest(admin2.at(min(2)), req.approvalRequestId);
    // a different tag or commit than the approved one
    expect((await fail(recordDeployStage(sys(3), { deployId: req.deployId, event: "start", tag: "v1.2.0" }))).key).toBe("deploys.errors.notApproved");
    expect((await fail(recordDeployStage(sys(3), { deployId: req.deployId, event: "start", tag: "v1.1.0", commitHash: sha("c") }))).key).toBe("deploys.errors.notApproved");
    expect((await auditActions(req.deployId)).filter((a) => a.action === "deploy.start_refused")).toHaveLength(2);
    const [row] = await t.db.select().from(deploys).where(eq(deploys.id, req.deployId));
    expect(row!.state).toBe("approved");
  });

  it("stages become the progress log and the history row: actors, hash, tag, result, duration", async () => {
    const req = await requestDeploy(admin.at(min(0)), { tag: "v1.1.0", reason: "regular release" });
    await approveRequest(admin2.at(min(1)), req.approvalRequestId);
    const sys = (n: number) => systemCtx(t.db, { now: min(n) });
    await recordDeployStage(sys(2), { deployId: req.deployId, event: "start", tag: "v1.1.0", commitHash: sha("b") });
    for (const [i, stage] of (["build", "backup", "migrate", "roll", "health"] as const).entries()) {
      await recordDeployStage(sys(3 + i), { deployId: req.deployId, event: "stage", stage, note: stage === "backup" ? "backup stored" : undefined });
    }
    const running = await getDeployOverview(admin.at(min(8)));
    expect(running.active).toMatchObject({ state: "running", stage: "health" });
    await recordDeployStage(sys(12), { deployId: req.deployId, event: "succeeded" });
    // a retried final report is harmless
    await recordDeployStage(sys(13), { deployId: req.deployId, event: "succeeded" });
    expect((await fail(recordDeployStage(sys(14), { deployId: req.deployId, event: "stage", stage: "roll" }))).key).toBe("deploys.errors.finished");

    const overview = await getDeployOverview(security.at(min(15)));
    expect(overview.active).toBeNull();
    const row = overview.history.find((h) => h.id === req.deployId)!;
    expect(row).toMatchObject({
      state: "succeeded",
      stage: "done",
      tag: "v1.1.0",
      commitHash: sha("b"),
      requestedByStaffId: admin.staffId,
      approvedByStaffId: admin2.staffId,
      durationMs: 10 * 60_000,
      activeLock: null,
    });
    expect(row.requesterLabel).toMatch(/^deployer\d+@example\.test$/);
    expect(row.approverLabel).toMatch(/^deployer\d+@example\.test$/);
    expect(row.log.map((l) => l.event)).toEqual(["requested", "approved", "start", "stage", "stage", "stage", "stage", "stage", "succeeded"]);
    expect(row.log.find((l) => l.stage === "backup")?.note).toBe("backup stored");
    expect(overview.live).toMatchObject({ tag: "v1.1.0", commitHash: sha("b") });

    const last = (await auditActions(req.deployId)).at(-1)!;
    expect(last.action).toBe("deploy.succeeded");
    expect(last.meta).toMatchObject({ tag: "v1.1.0", commitHash: sha("b"), requesterStaffId: admin.staffId, approverStaffId: admin2.staffId, result: "succeeded", durationMs: 10 * 60_000 });
  });

  it("a failed health check is recorded as rolled back, with the reason, and the old release stays live", async () => {
    await deployOk("v1.0.0", 0);
    const req = await requestDeploy(admin.at(min(10)), { tag: "v1.1.0", reason: "regular release" });
    await approveRequest(admin2.at(min(11)), req.approvalRequestId);
    const sys = (n: number) => systemCtx(t.db, { now: min(n) });
    await recordDeployStage(sys(12), { deployId: req.deployId, event: "start", tag: "v1.1.0" });
    await recordDeployStage(sys(13), { deployId: req.deployId, event: "stage", stage: "health" });
    await recordDeployStage(sys(18), { deployId: req.deployId, event: "rolled_back", note: "health check failed 30 times; rolled back to v1.0.0" });

    const overview = await getDeployOverview(admin.at(min(20)));
    const row = overview.history.find((h) => h.id === req.deployId)!;
    expect(row).toMatchObject({ state: "rolled_back", previousTag: "v1.0.0", rollbackReason: "health check failed 30 times; rolled back to v1.0.0", durationMs: 6 * 60_000, activeLock: null });
    expect(overview.live?.tag).toBe("v1.0.0");
    const last = (await auditActions(req.deployId)).at(-1)!;
    expect(last.action).toBe("deploy.rolled_back");
    expect(last.meta).toMatchObject({ result: "rolled_back", rolledBackTo: "v1.0.0", reason: "health check failed 30 times; rolled back to v1.0.0" });
    // deploys work again afterwards
    expect((await requestDeploy(admin.at(min(21)), { tag: "v1.1.0", reason: "second try" })).deployId).toBeTruthy();
  });
});

describe("manual rollback (DEP5)", () => {
  it("one staff member rolls back to the previous release; a blocked rollback says why", async () => {
    await deployOk("v1.0.0", 0);
    await deployOk("v1.1.0", 10);
    expect((await getDeployOverview(admin.at(min(20)))).rollbackTarget).toBe("v1.0.0");

    const rb = await requestRollback(security.at(min(21)), { reason: "checkout page is broken" });
    expect(rb.tag).toBe("v1.0.0");
    expect(gh.dispatches.at(-1)!.inputs).toMatchObject({ tag: "v1.0.0", mode: "rollback", previousTag: "v1.1.0", requestedBy: security.staffId, approvedBy: "" });
    const sys = (n: number) => systemCtx(t.db, { now: min(n) });
    await recordDeployStage(sys(22), { deployId: rb.deployId, event: "start", tag: "v1.0.0" });
    await recordDeployStage(sys(23), { deployId: rb.deployId, event: "rollback_blocked", note: "migration 0007_drop_legacy cannot be reversed; nothing was changed" });

    const [row] = await t.db.select().from(deploys).where(eq(deploys.id, rb.deployId));
    expect(row).toMatchObject({ kind: "rollback", state: "failed", rollbackReason: "migration 0007_drop_legacy cannot be reversed; nothing was changed", activeLock: null });
    expect((await getDeployOverview(admin.at(min(24)))).live?.tag).toBe("v1.1.0");
    expect((await auditActions(rb.deployId)).map((a) => a.action)).toEqual(["deploy.rollback_requested", "deploy.started", "deploy.rollback_blocked"]);

    // second attempt goes through
    const rb2 = await requestRollback(admin.at(min(25)), { reason: "checkout page is broken" });
    await recordDeployStage(sys(26), { deployId: rb2.deployId, event: "start", tag: "v1.0.0" });
    await recordDeployStage(sys(27), { deployId: rb2.deployId, event: "succeeded" });
    const after = await getDeployOverview(admin.at(min(28)));
    expect(after.live?.tag).toBe("v1.0.0");
    // nothing older to go back to from a rollback: deploy a tag instead
    expect(after.rollbackTarget).toBeNull();
    expect((await fail(requestRollback(admin.at(min(29)), { reason: "again" }))).key).toBe("deploys.errors.noPrevious");
  });
});

describe("a pipeline that never reports", () => {
  it("keeps the slot until staff close it, and only once it is stale", async () => {
    const req = await requestDeploy(admin.at(min(0)), { tag: "v1.1.0", reason: "regular release" });
    await approveRequest(admin2.at(min(1)), req.approvalRequestId);
    expect((await fail(abandonDeploy(admin.at(min(30)), { id: req.deployId, reason: "runner died" }))).key).toBe("deploys.errors.notStale");
    const later = new Date(min(1).getTime() + DEPLOY_STALE_MS + 1000);
    const row = await abandonDeploy(admin.at(later), { id: req.deployId, reason: "runner died" });
    expect(row).toMatchObject({ state: "failed", activeLock: null });
    const [last] = await t.db.select().from(auditLog).where(eq(auditLog.objectId, req.deployId)).orderBy(desc(auditLog.at)).limit(1);
    expect(last!.action).toBe("deploy.abandoned");
  });
});
