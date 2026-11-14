import { createSign } from "node:crypto";
import {
  accounts,
  and,
  approvalRequests,
  deploys,
  desc,
  eq,
  inArray,
  staffMembers,
  DEPLOY_STAGES,
  type DeployCiStatus,
  type DeployLogEntry,
  type DeployStage,
  type DeployState,
  type StaffRole,
} from "@ed/db";
import { AppError } from "@ed/shared/errors";
import { hashEquals, hashToken, newId } from "@ed/shared/ids";
import { z } from "zod";
import { registerApprovalAction, requestApproval } from "./approvals";
import { audit } from "./audit";
import { requireSystem, type Ctx } from "./context";
import { isSingleOperatorMode, requireStaffRole } from "./staff";
import { inTx } from "./tx";

// Production deployments from the console (R0-14, W10, DEP1–DEP7).
//
//   console ──requestDeploy──▶ approval "deploy.production" ──second person approves──▶
//   GitHub App dispatches .github/workflows/deploy.yml (workflow_dispatch, tag only) ──▶
//   the workflow reports every stage back through POST /api/deploys/record
//   (scripts/record-deploy.mjs → recordDeployStage) ──▶ the console shows progress + history.
//
// - DEP1: the GitHub App credentials are read from the environment HERE, on the server. No
//   function in this file returns them, and nothing derived from them (JWT, installation
//   token) leaves this module.
// - DEP3: a deploy is a release TAG (vX.Y.Z), never a branch or a bare commit. It needs a
//   second person; in single-operator mode the request queues with no effect (W9). One
//   security administrator alone may run an EMERGENCY deploy — audit-marked, reason required.
// - DEP5: one staff member may roll back to the previous release. The pipeline never deletes
//   data and stops when a migration cannot be reversed; that message lands in rollbackReason.
// - DEP6: every step is an audit row; one deploy at a time (deploys.active_lock unique index).
// - DEP7: a tag whose CI did not pass on that exact commit is refused, except the emergency
//   path, which records the bypass.
//
// All GitHub traffic goes through an injectable fetcher (configureDeploys) so tests need no
// network.

export const DEPLOY_ACTION = "deploy.production";
export const DEPLOY_ROLES: StaffRole[] = ["platform_admin", "security_administrator"];
/** A deploy that has not reported for this long may be marked failed by staff. */
export const DEPLOY_STALE_MS = 90 * 60_000;

const TAG_RE = /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z][0-9A-Za-z.]{0,30})?$/;
const SHA_RE = /^[0-9a-f]{40}$/;
const zTag = z.string().trim().regex(TAG_RE, "deploys.errors.notATag");
const zReason = z.string().trim().min(3, "common.validation.required").max(1000, "common.validation.tooLong");

export type Deploy = typeof deploys.$inferSelect;

/* ── Configuration (server-side only, DEP1) ─────────────────────────────── */

export type DeployFetcher = (url: string, init?: RequestInit) => Promise<Response>;

type State = {
  fetcher?: DeployFetcher;
  env?: Record<string, string | undefined>;
  token?: { key: string; value: string; expiresAt: number };
};
const g = globalThis as unknown as { __edDeploys?: State };
function state(): State {
  return (g.__edDeploys ??= {});
}

/** Tests (and anything that needs a proxy) inject the fetcher and/or the environment. */
export function configureDeploys(opts: { fetcher?: DeployFetcher; env?: Record<string, string | undefined> }): void {
  const s = state();
  if ("fetcher" in opts) s.fetcher = opts.fetcher;
  if ("env" in opts) s.env = opts.env;
  s.token = undefined;
}

function env(): Record<string, string | undefined> {
  return state().env ?? process.env;
}

const REQUIRED_ENV = ["GITHUB_APP_ID", "GITHUB_APP_PRIVATE_KEY", "GITHUB_APP_INSTALLATION_ID", "GITHUB_REPO"] as const;

export type DeployConfig = {
  /** True when the four GitHub App variables are present. */
  configured: boolean;
  /** NAMES of the missing variables — never a value. */
  missing: string[];
  /** "owner/name" of the one connected repository; shown in the console. */
  repo: string | null;
  /** True when the pipeline can report back (DEPLOY_RECORD_TOKEN is set). */
  recordTokenSet: boolean;
};

export function getDeployConfig(): DeployConfig {
  const e = env();
  const missing = REQUIRED_ENV.filter((name) => !e[name]?.trim());
  const repo = e.GITHUB_REPO?.trim() ?? "";
  if (repo && !/^[\w.-]+\/[\w.-]+$/.test(repo) && !missing.includes("GITHUB_REPO")) missing.push("GITHUB_REPO");
  return {
    configured: missing.length === 0,
    missing: [...missing],
    repo: missing.includes("GITHUB_REPO") ? null : repo,
    recordTokenSet: (e.DEPLOY_RECORD_TOKEN?.trim().length ?? 0) >= 32,
  };
}

/** The machine token the pipeline presents (DEPLOY_RECORD_TOKEN). Compared as hashes. */
export function verifyDeployRecordToken(presented: string | null | undefined): boolean {
  const expected = env().DEPLOY_RECORD_TOKEN?.trim() ?? "";
  if (expected.length < 32 || !presented) return false;
  return hashEquals(hashToken(presented.trim()), hashToken(expected));
}

/* ── GitHub client (installation token of the GitHub App) ───────────────── */

function b64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

function githubError(status: number): AppError {
  return new AppError("CONFLICT", "deploys.errors.github", { params: { status } });
}

type Github = {
  /** The commit a release tag points at, or null when the name is not a tag. */
  resolveTag: (tag: string) => Promise<string | null>;
  listTags: () => Promise<Array<{ tag: string; commitHash: string }>>;
  ciStatus: (commitHash: string) => Promise<DeployCiStatus>;
  compare: (base: string, head: string) => Promise<{ total: number; commits: DeployCommit[] }>;
  dispatch: (inputs: Record<string, string>) => Promise<void>;
};

export type DeployCommit = { hash: string; title: string; at: string | null };

function github(): Github {
  const config = getDeployConfig();
  if (!config.configured || !config.repo) throw new AppError("CONFLICT", "deploys.errors.notConfigured");
  const e = env();
  const s = state();
  const doFetch: DeployFetcher = s.fetcher ?? ((url, init) => fetch(url, init));
  const api = (e.GITHUB_API_URL?.trim() || "https://api.github.com").replace(/\/+$/, "");
  const repo = config.repo;
  const appId = e.GITHUB_APP_ID!.trim();
  const installationId = e.GITHUB_APP_INSTALLATION_ID!.trim();
  const baseHeaders = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "eventdesk-console",
  };

  async function installationToken(): Promise<string> {
    const key = `${api}|${appId}|${installationId}`;
    if (s.token && s.token.key === key && s.token.expiresAt - 60_000 > Date.now()) return s.token.value;
    const nowSec = Math.floor(Date.now() / 1000);
    const unsigned = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(
      JSON.stringify({ iat: nowSec - 60, exp: nowSec + 540, iss: appId }),
    )}`;
    let signature: string;
    try {
      const pem = e.GITHUB_APP_PRIVATE_KEY!.replace(/\\n/g, "\n").trim();
      signature = createSign("RSA-SHA256").update(unsigned).sign(pem).toString("base64url");
    } catch {
      // the key itself is never logged or echoed
      throw new AppError("CONFLICT", "deploys.errors.badKey");
    }
    const res = await doFetch(`${api}/app/installations/${encodeURIComponent(installationId)}/access_tokens`, {
      method: "POST",
      headers: { ...baseHeaders, Authorization: `Bearer ${unsigned}.${signature}` },
    });
    if (!res.ok) throw githubError(res.status);
    const body = (await res.json()) as { token?: string; expires_at?: string };
    if (!body.token) throw githubError(res.status);
    s.token = {
      key,
      value: body.token,
      expiresAt: body.expires_at ? Date.parse(body.expires_at) : Date.now() + 30 * 60_000,
    };
    return body.token;
  }

  async function call(path: string, init: RequestInit = {}): Promise<Response> {
    const token = await installationToken();
    return doFetch(`${api}/repos/${repo}${path}`, {
      ...init,
      headers: { ...baseHeaders, Authorization: `Bearer ${token}`, ...(init.headers as Record<string, string> | undefined) },
    });
  }

  async function json<T>(path: string): Promise<T> {
    const res = await call(path);
    if (!res.ok) throw githubError(res.status);
    return (await res.json()) as T;
  }

  const ciContext = e.DEPLOY_CI_CONTEXT?.trim() || "release-ci";

  return {
    async resolveTag(tag) {
      if (!TAG_RE.test(tag)) return null;
      const res = await call(`/git/ref/tags/${encodeURIComponent(tag)}`);
      if (res.status === 404) return null;
      if (!res.ok) throw githubError(res.status);
      const ref = (await res.json()) as { ref?: string; object?: { type?: string; sha?: string } };
      // the API answers prefix matches too: only the exact tag counts
      if (ref.ref !== `refs/tags/${tag}` || !ref.object?.sha) return null;
      let { sha, type } = ref.object;
      // annotated tags point at a tag object; follow it to the commit
      for (let i = 0; i < 3 && type === "tag"; i++) {
        const obj = await json<{ object?: { type?: string; sha?: string } }>(`/git/tags/${sha}`);
        if (!obj.object?.sha) return null;
        sha = obj.object.sha;
        type = obj.object.type;
      }
      return type === "commit" && SHA_RE.test(sha) ? sha : null;
    },
    async listTags() {
      const rows = await json<Array<{ name?: string; commit?: { sha?: string } }>>(`/tags?per_page=50`);
      return rows
        .filter((r) => typeof r.name === "string" && TAG_RE.test(r.name) && SHA_RE.test(r.commit?.sha ?? ""))
        .map((r) => ({ tag: r.name!, commitHash: r.commit!.sha! }))
        .sort((a, b) => compareTags(b.tag, a.tag));
    },
    async ciStatus(commitHash) {
      const body = await json<{ state?: string; statuses?: Array<{ context?: string; state?: string }> }>(
        `/commits/${commitHash}/status`,
      );
      // DEP7: the release workflow must have reported on this exact commit, and nothing
      // else on it may be failing or still running.
      const own = (body.statuses ?? []).find((x) => x.context === ciContext);
      if (!own) return "unknown";
      if (own.state === "success" && body.state === "success") return "success";
      if (own.state === "pending" || (own.state === "success" && body.state === "pending")) return "pending";
      return "failure";
    },
    async compare(base, head) {
      const body = await json<{
        total_commits?: number;
        commits?: Array<{ sha?: string; commit?: { message?: string; committer?: { date?: string } } }>;
      }>(`/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}?per_page=100`);
      const commits = (body.commits ?? [])
        .filter((c) => typeof c.sha === "string")
        .map((c) => ({
          hash: c.sha!,
          title: (c.commit?.message ?? "").split("\n")[0]!.slice(0, 200),
          at: c.commit?.committer?.date ?? null,
        }))
        .reverse();
      return { total: body.total_commits ?? commits.length, commits };
    },
    async dispatch(inputs) {
      const workflow = e.GITHUB_DEPLOY_WORKFLOW?.trim() || "deploy.yml";
      const ref = e.GITHUB_DEFAULT_BRANCH?.trim() || "main";
      const res = await call(`/actions/workflows/${encodeURIComponent(workflow)}/dispatches`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ref, inputs }),
      });
      if (!res.ok) throw githubError(res.status);
    },
  };
}

/** Semver-ish ordering of vX.Y.Z tags (a pre-release sorts before its release). */
export function compareTags(a: string, b: string): number {
  const parse = (t: string) => {
    const [core, pre] = t.slice(1).split("-", 2) as [string, string | undefined];
    return { n: core.split(".").map(Number), pre };
  };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i++) {
    const d = (x.n[i] ?? 0) - (y.n[i] ?? 0);
    if (d !== 0) return d;
  }
  if (x.pre === y.pre) return 0;
  if (x.pre === undefined) return 1;
  if (y.pre === undefined) return -1;
  return x.pre < y.pre ? -1 : 1;
}

/* ── Reading ────────────────────────────────────────────────────────────── */

export type DeployView = Deploy & { requesterLabel: string | null; approverLabel: string | null };

async function withLabels(ctx: Ctx, rows: Deploy[]): Promise<DeployView[]> {
  const ids = [...new Set(rows.flatMap((r) => [r.requestedByStaffId, r.approvedByStaffId]).filter((x): x is string => !!x))];
  const people = ids.length
    ? await ctx.db
        .select({ id: staffMembers.id, email: accounts.email, username: accounts.username })
        .from(staffMembers)
        .innerJoin(accounts, eq(accounts.id, staffMembers.accountId))
        .where(inArray(staffMembers.id, ids))
    : [];
  const label = new Map(people.map((p) => [p.id, p.email ?? p.username]));
  return rows.map((r) => ({
    ...r,
    requesterLabel: label.get(r.requestedByStaffId) ?? null,
    approverLabel: r.approvedByStaffId ? (label.get(r.approvedByStaffId) ?? null) : null,
  }));
}

/** A request whose approval was rejected or withdrawn is closed here (approvals has no hook). */
async function syncRequested(ctx: Ctx): Promise<void> {
  const stale = await ctx.db
    .select({ id: deploys.id, tag: deploys.tag, approvalState: approvalRequests.state })
    .from(deploys)
    .innerJoin(approvalRequests, eq(approvalRequests.id, deploys.approvalRequestId))
    .where(and(eq(deploys.state, "requested"), inArray(approvalRequests.state, ["rejected", "cancelled"])));
  for (const row of stale) {
    const closed = await ctx.db
      .update(deploys)
      .set({ state: "cancelled", finishedAt: ctx.now })
      .where(and(eq(deploys.id, row.id), eq(deploys.state, "requested")))
      .returning({ id: deploys.id });
    if (closed[0]) {
      await audit(
        { ...ctx, actor: { kind: "system" } },
        { action: "deploy.cancelled", objectType: "deploy", objectId: row.id, meta: { tag: row.tag, approval: row.approvalState } },
      );
    }
  }
}

async function activeDeploy(ctx: Ctx): Promise<Deploy | null> {
  const [row] = await ctx.db.select().from(deploys).where(eq(deploys.activeLock, "production"));
  return row ?? null;
}

/** The release that is live: the last deploy or rollback that finished well. */
async function liveDeploy(ctx: Ctx): Promise<Deploy | null> {
  const [row] = await ctx.db
    .select()
    .from(deploys)
    .where(eq(deploys.state, "succeeded"))
    .orderBy(desc(deploys.finishedAt))
    .limit(1);
  return row ?? null;
}

export type DeployOverview = {
  config: DeployConfig;
  /** True when GitHub could not be reached or refused; history is still shown. */
  githubUnavailable: boolean;
  singleOperatorMode: boolean;
  /** The live release, from the deploy history. NULL = nothing deployed through the console yet. */
  live: { tag: string; commitHash: string; at: Date | null } | null;
  /** What the running web process says it is (APP_VERSION), for a cross-check. */
  runningVersion: string | null;
  /** The deploy that is approved or running, if any — while it exists, nothing else starts. */
  active: DeployView | null;
  /** Requests waiting for a second person. */
  pending: DeployView[];
  /** Release tags, newest first, each with the CI result on its exact commit (DEP7). */
  tags: Array<{ tag: string; commitHash: string; ciStatus: DeployCiStatus; live: boolean }>;
  /** Commits between the live release and the chosen candidate, newest first (DEP2). */
  candidate: {
    tag: string;
    commitHash: string;
    ciStatus: DeployCiStatus;
    /** NULL when there is no live release to compare with. */
    commits: DeployCommit[] | null;
    total: number;
  } | null;
  /** Where a one-person rollback would go (DEP5), or null when there is nowhere to go. */
  rollbackTarget: string | null;
  history: DeployView[];
};

const TAGS_SHOWN = 10;

/** Everything the /console/deploys screen shows (W10, DEP2). */
export async function getDeployOverview(ctx: Ctx, input: { candidate?: string | null } = {}): Promise<DeployOverview> {
  requireStaffRole(ctx, ...DEPLOY_ROLES);
  await syncRequested(ctx);
  const config = getDeployConfig();
  const [rows, live, single] = await Promise.all([
    ctx.db.select().from(deploys).orderBy(desc(deploys.createdAt)).limit(50),
    liveDeploy(ctx),
    isSingleOperatorMode(ctx),
  ]);
  const views = await withLabels(ctx, rows);

  let githubUnavailable = false;
  let tags: DeployOverview["tags"] = [];
  let candidate: DeployOverview["candidate"] = null;
  if (config.configured) {
    try {
      const gh = github();
      const all = (await gh.listTags()).slice(0, TAGS_SHOWN);
      tags = await Promise.all(
        all.map(async (t) => ({ ...t, ciStatus: await gh.ciStatus(t.commitHash), live: live?.tag === t.tag })),
      );
      const wanted = zTag.safeParse(input.candidate ?? "");
      const chosen = wanted.success ? tags.find((t) => t.tag === wanted.data) : undefined;
      if (chosen) {
        const diff = live && live.commitHash !== chosen.commitHash ? await gh.compare(live.commitHash, chosen.commitHash) : null;
        candidate = {
          tag: chosen.tag,
          commitHash: chosen.commitHash,
          ciStatus: chosen.ciStatus,
          commits: live ? (diff?.commits ?? []) : null,
          total: diff?.total ?? 0,
        };
      }
    } catch (e) {
      if (!(e instanceof AppError)) console.error("[deploys] GitHub request failed:", (e as Error).name);
      githubUnavailable = true;
    }
  }

  return {
    config,
    githubUnavailable,
    singleOperatorMode: single,
    live: live ? { tag: live.tag, commitHash: live.commitHash, at: live.finishedAt } : null,
    runningVersion: env().APP_VERSION?.trim() || null,
    active: views.find((v) => v.activeLock === "production") ?? null,
    pending: views.filter((v) => v.state === "requested"),
    tags,
    candidate,
    rollbackTarget: live && live.kind === "deploy" && live.previousTag && live.previousTag !== live.tag ? live.previousTag : null,
    history: views.filter((v) => v.state !== "requested"),
  };
}

/** One deploy with its progress log, for the live progress view (DEP4). */
export async function getDeploy(ctx: Ctx, id: string): Promise<DeployView> {
  requireStaffRole(ctx, ...DEPLOY_ROLES);
  const [row] = await ctx.db.select().from(deploys).where(eq(deploys.id, z.string().min(1).max(64).parse(id)));
  if (!row) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  return (await withLabels(ctx, [row]))[0]!;
}

/* ── Requesting ─────────────────────────────────────────────────────────── */

function logEntry(ctx: Ctx, event: string, extra: Partial<DeployLogEntry> = {}): DeployLogEntry {
  return { at: ctx.now.toISOString(), event, ...extra };
}

function isUniqueViolation(e: unknown): boolean {
  for (let x: unknown = e, i = 0; x && i < 4; x = (x as { cause?: unknown }).cause, i++) {
    if ((x as { code?: unknown }).code === "23505") return true;
  }
  return false;
}

async function refuseWhileActive(ctx: Ctx): Promise<void> {
  const active = await activeDeploy(ctx);
  if (active) throw new AppError("CONFLICT", "deploys.errors.running", { params: { tag: active.tag } });
}

/** Takes the single production slot for `id` or throws CONFLICT (two requests racing). */
async function takeSlot(ctx: Ctx, id: string, set: Partial<typeof deploys.$inferInsert>): Promise<Deploy> {
  try {
    // a nested transaction = savepoint, so a lost race does not poison the outer one
    return await inTx(ctx, async (tx) => {
      const [row] = await tx.db
        .update(deploys)
        .set({ ...set, activeLock: "production" })
        .where(eq(deploys.id, id))
        .returning();
      return row!;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new AppError("CONFLICT", "deploys.errors.running", { params: { tag: "" } });
    throw e;
  }
}

function dispatchInputs(row: Deploy): Record<string, string> {
  return {
    tag: row.tag,
    deployId: row.id,
    mode: row.kind,
    emergency: row.emergency ? "true" : "false",
    // staff ids, not emails: workflow inputs are visible in the run log
    requestedBy: row.requestedByStaffId,
    approvedBy: row.approvedByStaffId ?? "",
    previousTag: row.previousTag ?? "",
  };
}

const requestInput = z.object({ tag: zTag, reason: zReason });

/**
 * Asks for a production deploy of a release tag (DEP3). Nothing is deployed here: the request
 * goes to the approval queue and a second person must approve it. A tag whose CI has not
 * passed on that exact commit is refused (DEP7).
 */
export async function requestDeploy(
  ctx: Ctx,
  input: { tag: string; reason: string },
): Promise<{ deployId: string; approvalRequestId: string; singleOperatorMode: boolean }> {
  const staffId = requireStaffRole(ctx, ...DEPLOY_ROLES);
  const data = requestInput.parse(input);
  const gh = github();
  await syncRequested(ctx);
  await refuseWhileActive(ctx);
  const commitHash = await gh.resolveTag(data.tag);
  if (!commitHash) throw new AppError("VALIDATION", "deploys.errors.notATag", { fieldErrors: { tag: ["deploys.errors.notATag"] } });
  const ciStatus = await gh.ciStatus(commitHash);
  if (ciStatus !== "success") {
    await audit(ctx, {
      action: "deploy.refused",
      objectType: "deploy",
      meta: { tag: data.tag, commitHash, ciStatus, why: "ci_not_green" },
    });
    throw new AppError("CONFLICT", "deploys.errors.ciNotGreen", { params: { tag: data.tag } });
  }
  const [open] = await ctx.db
    .select({ id: deploys.id })
    .from(deploys)
    .where(and(eq(deploys.state, "requested"), eq(deploys.tag, data.tag)));
  if (open) throw new AppError("CONFLICT", "deploys.errors.alreadyRequested", { params: { tag: data.tag } });

  return inTx(ctx, async (tx) => {
    const deployId = newId();
    const approval = await requestApproval(tx, {
      action: DEPLOY_ACTION,
      payload: { deployId, tag: data.tag, commitHash },
      reason: data.reason,
    });
    await tx.db.insert(deploys).values({
      id: deployId,
      kind: "deploy",
      tag: data.tag,
      commitHash,
      requestedByStaffId: staffId,
      approvalRequestId: approval.id,
      reason: data.reason,
      ciStatus,
      state: "requested",
      log: [logEntry(tx, "requested")],
      createdAt: tx.now,
    });
    await audit(tx, {
      action: "deploy.requested",
      objectType: "deploy",
      objectId: deployId,
      after: { tag: data.tag, commitHash, ciStatus },
      meta: { approvalRequestId: approval.id, singleOperatorMode: approval.singleOperatorMode },
    });
    return { deployId, approvalRequestId: approval.id, singleOperatorMode: approval.singleOperatorMode };
  });
}

const deployPayload = z.object({ deployId: z.string().min(1).max(64), tag: zTag, commitHash: z.string().regex(SHA_RE) });

// DEP3: the second person's approval is what starts the pipeline. Runs inside the approving
// transaction: if GitHub refuses the dispatch, nothing is recorded and the request stays open.
registerApprovalAction(DEPLOY_ACTION, {
  roles: DEPLOY_ROLES,
  approverRoles: DEPLOY_ROLES,
  approvalsNeeded: 1,
  input: deployPayload,
  describe: (p) => ({ key: "deploys.approvals.deploy", params: { tag: p.tag, hash: p.commitHash.slice(0, 7) } }),
  execute: async (ctx, p) => {
    const approverStaffId = requireStaffRole(ctx, ...DEPLOY_ROLES);
    const [row] = await ctx.db.select().from(deploys).where(eq(deploys.id, p.deployId)).for("update");
    if (!row || row.state !== "requested") throw new AppError("CONFLICT", "deploys.errors.notRequested");
    await refuseWhileActive(ctx);
    const gh = github();
    // The tag must still point at the commit that was requested, and CI must still be green.
    if ((await gh.resolveTag(row.tag)) !== row.commitHash) throw new AppError("CONFLICT", "deploys.errors.tagMoved", { params: { tag: row.tag } });
    const ciStatus = await gh.ciStatus(row.commitHash);
    if (ciStatus !== "success") throw new AppError("CONFLICT", "deploys.errors.ciNotGreen", { params: { tag: row.tag } });
    const live = await liveDeploy(ctx);
    const approved = await takeSlot(ctx, row.id, {
      state: "approved",
      approvedByStaffId: approverStaffId,
      ciStatus,
      previousTag: live?.tag ?? null,
      log: [...row.log, logEntry(ctx, "approved")],
    });
    await audit(ctx, {
      action: "deploy.approved",
      objectType: "deploy",
      objectId: row.id,
      meta: { tag: row.tag, commitHash: row.commitHash, requesterStaffId: row.requestedByStaffId, approverStaffId, ciStatus },
    });
    await gh.dispatch(dispatchInputs(approved));
  },
});

const emergencyInput = z.object({
  tag: zTag,
  reason: z.string().trim().min(10, "deploys.errors.emergencyReason").max(1000, "common.validation.tooLong"),
});

/**
 * DEP3: an emergency security fix, deployed by ONE security administrator. No second person
 * and no green-CI requirement — both facts are written to the audit log with the reason.
 */
export async function requestEmergencyDeploy(ctx: Ctx, input: { tag: string; reason: string }): Promise<{ deployId: string; ciStatus: DeployCiStatus }> {
  const staffId = requireStaffRole(ctx, "security_administrator");
  const data = emergencyInput.parse(input);
  const gh = github();
  await syncRequested(ctx);
  await refuseWhileActive(ctx);
  const commitHash = await gh.resolveTag(data.tag);
  if (!commitHash) throw new AppError("VALIDATION", "deploys.errors.notATag", { fieldErrors: { tag: ["deploys.errors.notATag"] } });
  const ciStatus = await gh.ciStatus(commitHash);
  const live = await liveDeploy(ctx);
  return inTx(ctx, async (tx) => {
    const deployId = newId();
    await tx.db.insert(deploys).values({
      id: deployId,
      kind: "deploy",
      tag: data.tag,
      commitHash,
      previousTag: live?.tag ?? null,
      requestedByStaffId: staffId,
      emergency: true,
      reason: data.reason,
      ciStatus,
      state: "requested",
      log: [logEntry(tx, "emergency_requested")],
      createdAt: tx.now,
    });
    const row = await takeSlot(tx, deployId, { state: "approved" });
    await audit(tx, {
      action: "deploy.emergency_requested",
      objectType: "deploy",
      objectId: deployId,
      after: { tag: data.tag, commitHash, ciStatus },
      meta: { emergency: true, reason: data.reason, ciBypassed: ciStatus !== "success", secondPersonBypassed: true },
    });
    await gh.dispatch(dispatchInputs(row));
    return { deployId, ciStatus };
  });
}

/**
 * DEP5: one staff member sends production back to the previous release. The pipeline swaps
 * the release only — it never touches data — and stops with a message when a migration that
 * shipped after that release cannot be reversed.
 */
export async function requestRollback(ctx: Ctx, input: { reason: string }): Promise<{ deployId: string; tag: string }> {
  const staffId = requireStaffRole(ctx, ...DEPLOY_ROLES);
  const reason = zReason.parse(input.reason);
  const gh = github();
  await refuseWhileActive(ctx);
  const live = await liveDeploy(ctx);
  const target = live && live.kind === "deploy" ? live.previousTag : null;
  if (!live || !target || target === live.tag) throw new AppError("CONFLICT", "deploys.errors.noPrevious");
  const commitHash = await gh.resolveTag(target);
  if (!commitHash) throw new AppError("CONFLICT", "deploys.errors.noPrevious");
  const ciStatus = await gh.ciStatus(commitHash);
  return inTx(ctx, async (tx) => {
    const deployId = newId();
    await tx.db.insert(deploys).values({
      id: deployId,
      kind: "rollback",
      tag: target,
      commitHash,
      // for a rollback this is the release being LEFT
      previousTag: live.tag,
      requestedByStaffId: staffId,
      reason,
      ciStatus,
      state: "requested",
      log: [logEntry(tx, "rollback_requested")],
      createdAt: tx.now,
    });
    const row = await takeSlot(tx, deployId, { state: "approved" });
    await audit(tx, {
      action: "deploy.rollback_requested",
      objectType: "deploy",
      objectId: deployId,
      after: { tag: target, commitHash, from: live.tag },
      meta: { reason },
    });
    await gh.dispatch(dispatchInputs(row));
    return { deployId, tag: target };
  });
}

/**
 * A deploy whose pipeline died without reporting keeps the slot. After DEPLOY_STALE_MS a
 * staff member may close it as failed so deploys work again. It changes the record only.
 */
export async function abandonDeploy(ctx: Ctx, input: { id: string; reason: string }): Promise<Deploy> {
  requireStaffRole(ctx, ...DEPLOY_ROLES);
  const reason = zReason.parse(input.reason);
  return inTx(ctx, async (tx) => {
    const [row] = await tx.db.select().from(deploys).where(eq(deploys.id, input.id)).for("update");
    if (!row) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
    if (row.activeLock !== "production") throw new AppError("CONFLICT", "deploys.errors.notActive");
    // "last heard of" = the newest progress entry (ctx clock), not updated_at (wall clock)
    const lastAt = Date.parse(row.log.at(-1)?.at ?? "") || row.createdAt.getTime();
    if (tx.now.getTime() - lastAt < DEPLOY_STALE_MS) throw new AppError("CONFLICT", "deploys.errors.notStale");
    const [done] = await tx.db
      .update(deploys)
      .set({
        state: "failed",
        activeLock: null,
        finishedAt: tx.now,
        durationMs: row.startedAt ? tx.now.getTime() - row.startedAt.getTime() : null,
        log: [...row.log, logEntry(tx, "abandoned", { note: reason.slice(0, 300) })],
      })
      .where(eq(deploys.id, row.id))
      .returning();
    await audit(tx, {
      action: "deploy.abandoned",
      objectType: "deploy",
      objectId: row.id,
      meta: { tag: row.tag, commitHash: row.commitHash, reason, stage: row.stage },
    });
    return done!;
  });
}

/* ── Pipeline reports (scripts/record-deploy.mjs → /api/deploys/record) ─── */

export const DEPLOY_EVENTS = ["start", "stage", "succeeded", "failed", "rolled_back", "rollback_blocked"] as const;
export type DeployEvent = (typeof DEPLOY_EVENTS)[number];

// Plain one-line notes only: the pipeline sends fixed phrases, never command output.
const zNote = z
  .string()
  .trim()
  .max(500)
  .transform((s) => s.replace(/\p{Cc}+/gu, " "))
  .optional();

export const recordDeployInput = z.object({
  deployId: z.string().min(1).max(64),
  event: z.enum(DEPLOY_EVENTS),
  stage: z.enum(DEPLOY_STAGES).optional(),
  /** Sent with "start": must match the deploy, or the pipeline is refused. */
  tag: z.string().max(64).optional(),
  commitHash: z.string().regex(SHA_RE).optional(),
  note: zNote,
});
export type RecordDeployInput = z.input<typeof recordDeployInput>;

const TERMINAL: DeployState[] = ["succeeded", "failed", "rolled_back", "cancelled"];
const LOG_MAX = 200;

/**
 * Writes one pipeline report (DEP4, DEP6). System actor only — the route handler checks the
 * machine token first. "start" is the gate: the pipeline may only run a deploy the console
 * approved, for the tag and commit that were approved; anything else is CONFLICT and the
 * workflow stops before touching production.
 */
export async function recordDeployStage(ctx: Ctx, input: RecordDeployInput): Promise<Deploy> {
  requireSystem(ctx);
  const data = recordDeployInput.parse(input);
  return inTx(ctx, async (tx) => {
    const [row] = await tx.db.select().from(deploys).where(eq(deploys.id, data.deployId)).for("update");
    if (!row) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
    const meta = {
      kind: row.kind,
      tag: row.tag,
      commitHash: row.commitHash,
      requesterStaffId: row.requestedByStaffId,
      approverStaffId: row.approvedByStaffId,
      emergency: row.emergency,
      ciStatus: row.ciStatus,
    };
    const push = (event: string, extra: Partial<DeployLogEntry> = {}) => [...row.log, logEntry(tx, event, extra)].slice(-LOG_MAX);
    const save = async (set: Partial<typeof deploys.$inferInsert>): Promise<Deploy> => {
      const [done] = await tx.db.update(deploys).set(set).where(eq(deploys.id, row.id)).returning();
      return done!;
    };
    const finish = (finalState: DeployState) => ({
      state: finalState,
      activeLock: null,
      finishedAt: tx.now,
      durationMs: row.startedAt ? Math.max(0, tx.now.getTime() - row.startedAt.getTime()) : 0,
    });
    const durationMs = row.startedAt ? Math.max(0, tx.now.getTime() - row.startedAt.getTime()) : 0;

    if (TERMINAL.includes(row.state)) {
      // a repeated final report (the script retries) is fine; anything else is not
      const same =
        (data.event === "succeeded" && row.state === "succeeded") ||
        (data.event === "rolled_back" && row.state === "rolled_back") ||
        ((data.event === "failed" || data.event === "rollback_blocked") && row.state === "failed");
      if (same) return row;
      throw new AppError("CONFLICT", "deploys.errors.finished");
    }

    switch (data.event) {
      case "start": {
        if (row.state === "running") return row;
        if (row.state !== "approved") throw new AppError("CONFLICT", "deploys.errors.notApproved");
        if (data.tag !== row.tag || (data.commitHash && data.commitHash !== row.commitHash)) {
          await audit(tx, { action: "deploy.start_refused", objectType: "deploy", objectId: row.id, meta: { ...meta, presentedTag: data.tag ?? null, presentedCommit: data.commitHash ?? null } });
          // commit the audit row, refuse the pipeline: return a marker the caller turns into CONFLICT
          return { ...row, state: "cancelled" as const, id: "" };
        }
        const done = await save({ state: "running", stage: "verify", startedAt: tx.now, log: push("start", { stage: "verify" }) });
        await audit(tx, { action: "deploy.started", objectType: "deploy", objectId: row.id, meta });
        return done;
      }
      case "stage": {
        if (row.state !== "running" || !data.stage) throw new AppError("CONFLICT", "deploys.errors.notRunning");
        return save({ stage: data.stage, log: push("stage", { stage: data.stage, note: data.note || undefined }) });
      }
      case "succeeded": {
        if (row.state !== "running") throw new AppError("CONFLICT", "deploys.errors.notRunning");
        const done = await save({ ...finish("succeeded"), stage: "done", log: push("succeeded", { stage: "done" }) });
        await audit(tx, { action: row.kind === "rollback" ? "deploy.rollback_succeeded" : "deploy.succeeded", objectType: "deploy", objectId: row.id, meta: { ...meta, result: "succeeded", durationMs } });
        return done;
      }
      case "failed": {
        const done = await save({ ...finish("failed"), log: push("failed", { stage: data.stage ?? row.stage ?? undefined, note: data.note || undefined }) });
        await audit(tx, { action: "deploy.failed", objectType: "deploy", objectId: row.id, meta: { ...meta, result: "failed", stage: data.stage ?? row.stage, note: data.note ?? null, durationMs } });
        return done;
      }
      case "rolled_back": {
        const reason = data.note || "health checks failed";
        const done = await save({ ...finish("rolled_back"), stage: "rollback", rollbackReason: reason, log: push("rolled_back", { stage: "rollback", note: reason }) });
        await audit(tx, { action: "deploy.rolled_back", objectType: "deploy", objectId: row.id, meta: { ...meta, result: "rolled_back", rolledBackTo: row.previousTag, reason, durationMs } });
        return done;
      }
      case "rollback_blocked": {
        // DEP5: the rollback stopped instead of guessing; a person must decide what happens next.
        const reason = data.note || "a migration cannot be reversed";
        const done = await save({ ...finish("failed"), stage: "rollback", rollbackReason: reason, log: push("rollback_blocked", { stage: "rollback", note: reason }) });
        await audit(tx, { action: "deploy.rollback_blocked", objectType: "deploy", objectId: row.id, meta: { ...meta, result: "rollback_blocked", reason, durationMs } });
        return done;
      }
    }
  }).then((row) => {
    if (row.id === "") throw new AppError("CONFLICT", "deploys.errors.notApproved");
    return row;
  });
}

export type { DeployCiStatus, DeployLogEntry, DeployStage, DeployState };
