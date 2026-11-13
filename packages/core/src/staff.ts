import {
  accounts,
  and,
  consoleSessions,
  count,
  desc,
  eq,
  incidents,
  isNotNull,
  isNull,
  jobRuns,
  occasions,
  platformSettings,
  sessions,
  staffMembers,
  staffRoleSchema,
  totpSecrets,
  approvalRequests,
  STAFF_ROLES,
  type StaffRole,
} from "@ed/db";
import { AppError } from "@ed/shared/errors";
import { z } from "zod";
import { sessionIdOf } from "./accounts";
import { audit } from "./audit";
import { requireSystem, type Ctx, type StaffActor } from "./context";
import { inTx } from "./tx";

// Platform staff and the console guard (S5, W1, W8, W9).
//
// Who may use the console is decided HERE, on every request:
//   1. the account has an ACTIVE staff_members row,
//   2. two-step sign-in (TOTP) is enabled on the account, and the web session in use was
//      opened after it was enabled — so this very session passed the second step,
//   3. a live console session: 12 hours from that sign-in, 30 minutes idle (S5). An ended
//      console session is never reopened; the person signs in again.
//
//   const access = await getConsoleAccess(ctx);          // web: page/layout decides what to show
//   const staffCtx = await resolveStaff(ctx);            // actions: throws FORBIDDEN unless ok
//   requireStaffRole(staffCtx, "security_administrator"); // inside every staff core function

export { STAFF_ROLES, type StaffRole } from "@ed/db";

export const CONSOLE_SESSION_MAX_MS = 12 * 60 * 60_000;
export const CONSOLE_SESSION_IDLE_MS = 30 * 60_000;
/** lastSeenAt of the console session moves at most this often. */
const CONSOLE_TOUCH_MS = 60_000;

export type StaffCtx = Ctx & { actor: StaffActor & { sessionId?: string } };

export type ConsoleDenied =
  /** Not on the staff (or deactivated). The console answers as if it did not exist. */
  | { state: "not_staff" }
  /** Staff, but two-step sign-in is not enabled on the account (S5). */
  | { state: "two_step_required" }
  /**
   * Staff with two-step, but this web session cannot carry a console session:
   * `second_step` = the session was opened before two-step was enabled (or has no session),
   * `absolute` = more than 12 h since sign-in, `idle` = 30 minutes without console activity.
   */
  | { state: "sign_in_again"; reason: "second_step" | "absolute" | "idle" };

export type ConsoleAccess =
  | {
      state: "ok";
      ctx: StaffCtx;
      staffId: string;
      roles: StaffRole[];
      /** When this console session ends at the latest (12 h rule). */
      expiresAt: Date;
    }
  | ConsoleDenied;

function cleanRoles(roles: readonly string[] | null | undefined): StaffRole[] {
  return (roles ?? []).filter((r): r is StaffRole => (STAFF_ROLES as readonly string[]).includes(r));
}

/**
 * The console guard. Never throws for "no access": it reports why, so the web layer can show
 * the page that explains what to set up. `touch` (default) records console activity.
 */
export async function getConsoleAccess(
  ctx: Ctx,
  opts: { touch?: boolean } = {},
): Promise<ConsoleAccess> {
  if (ctx.actor.kind !== "account" && ctx.actor.kind !== "staff") return { state: "not_staff" };
  const accountId = ctx.actor.accountId;

  const [staff] = await ctx.db
    .select()
    .from(staffMembers)
    .innerJoin(accounts, eq(accounts.id, staffMembers.accountId))
    .where(
      and(eq(staffMembers.accountId, accountId), eq(staffMembers.active, true), isNull(accounts.deletedAt)),
    );
  if (!staff) return { state: "not_staff" };
  const roles = cleanRoles(staff.staff_members.roles);
  if (roles.length === 0) return { state: "not_staff" };

  const [totp] = await ctx.db
    .select({ enabledAt: totpSecrets.enabledAt })
    .from(totpSecrets)
    .where(and(eq(totpSecrets.accountId, accountId), isNotNull(totpSecrets.enabledAt)));
  if (!totp?.enabledAt) return { state: "two_step_required" };

  const sessionId = sessionIdOf(ctx.actor);
  if (!sessionId) return { state: "sign_in_again", reason: "second_step" };
  const [session] = await ctx.db
    .select({ id: sessions.id, createdAt: sessions.createdAt })
    .from(sessions)
    .where(
      and(
        eq(sessions.id, sessionId),
        eq(sessions.accountId, accountId),
        isNull(sessions.revokedAt),
        eq(sessions.secondFactorPending, false),
      ),
    );
  if (!session) return { state: "sign_in_again", reason: "second_step" };
  // A session opened before two-step existed never proved the second step.
  if (session.createdAt.getTime() < totp.enabledAt.getTime()) {
    return { state: "sign_in_again", reason: "second_step" };
  }

  const now = ctx.now.getTime();
  const absoluteEnd = new Date(session.createdAt.getTime() + CONSOLE_SESSION_MAX_MS);
  const staffId = staff.staff_members.id;

  let [cs] = await ctx.db.select().from(consoleSessions).where(eq(consoleSessions.sessionId, sessionId));
  if (!cs) {
    if (now >= absoluteEnd.getTime()) return { state: "sign_in_again", reason: "absolute" };
    const inserted = await ctx.db
      .insert(consoleSessions)
      .values({ staffId, sessionId, startedAt: ctx.now, lastSeenAt: ctx.now, expiresAt: absoluteEnd })
      .onConflictDoNothing({ target: consoleSessions.sessionId })
      .returning();
    if (inserted[0]) {
      cs = inserted[0];
      await audit(staffCtxOf(ctx, accountId, staffId, roles, sessionId), {
        action: "console.session_started",
        objectType: "console_session",
        objectId: cs.id,
      });
    } else {
      [cs] = await ctx.db.select().from(consoleSessions).where(eq(consoleSessions.sessionId, sessionId));
    }
  }
  if (!cs) return { state: "sign_in_again", reason: "second_step" };
  if (cs.endedAt) {
    return { state: "sign_in_again", reason: cs.endedReason === "idle" ? "idle" : "absolute" };
  }
  const reason =
    now >= cs.expiresAt.getTime()
      ? ("absolute" as const)
      : now - cs.lastSeenAt.getTime() > CONSOLE_SESSION_IDLE_MS
        ? ("idle" as const)
        : null;
  if (reason) {
    const ended = await ctx.db
      .update(consoleSessions)
      .set({ endedAt: ctx.now, endedReason: reason })
      .where(and(eq(consoleSessions.id, cs.id), isNull(consoleSessions.endedAt)))
      .returning({ id: consoleSessions.id });
    if (ended[0]) {
      await audit(staffCtxOf(ctx, accountId, staffId, roles, sessionId), {
        action: "console.session_ended",
        objectType: "console_session",
        objectId: cs.id,
        meta: { reason },
      });
    }
    return { state: "sign_in_again", reason };
  }
  if (opts.touch !== false && now - cs.lastSeenAt.getTime() > CONSOLE_TOUCH_MS) {
    await ctx.db
      .update(consoleSessions)
      .set({ lastSeenAt: ctx.now })
      .where(and(eq(consoleSessions.id, cs.id), isNull(consoleSessions.endedAt)));
  }
  return {
    state: "ok",
    ctx: staffCtxOf(ctx, accountId, staffId, roles, sessionId),
    staffId,
    roles,
    expiresAt: cs.expiresAt,
  };
}

function staffCtxOf(
  ctx: Ctx,
  accountId: string,
  staffId: string,
  roles: StaffRole[],
  sessionId: string,
): StaffCtx {
  return { ...ctx, actor: { kind: "staff", accountId, staffId, roles, sessionId } };
}

/**
 * The staff Ctx for this request, or FORBIDDEN. Use at the top of every console action; the
 * returned ctx has actor.kind "staff" (accountId, staffId, roles).
 */
export async function resolveStaff(ctx: Ctx): Promise<StaffCtx> {
  const access = await getConsoleAccess(ctx);
  if (access.state !== "ok") {
    throw new AppError("FORBIDDEN", "console.errors.noAccess", { consoleState: access.state });
  }
  return access.ctx;
}

/** Leaving the console on purpose ends its session (the web session stays). */
export async function endConsoleSession(ctx: Ctx): Promise<void> {
  const sessionId = sessionIdOf(ctx.actor);
  if (!sessionId || ctx.actor.kind !== "staff") return;
  const ended = await ctx.db
    .update(consoleSessions)
    .set({ endedAt: ctx.now, endedReason: "left" })
    .where(and(eq(consoleSessions.sessionId, sessionId), isNull(consoleSessions.endedAt)))
    .returning({ id: consoleSessions.id });
  if (ended[0]) {
    await audit(ctx, {
      action: "console.session_ended",
      objectType: "console_session",
      objectId: ended[0].id,
      meta: { reason: "left" },
    });
  }
}

/** True when the actor is staff holding at least one of `roles` (any staff when none given). */
export function hasStaffRole(ctx: Ctx, ...roles: StaffRole[]): boolean {
  if (ctx.actor.kind !== "staff") return false;
  if (roles.length === 0) return true;
  return roles.some((r) => (ctx.actor as StaffActor).roles.includes(r));
}

/**
 * Throws FORBIDDEN unless the actor is a staff member holding one of `roles`. No role is
 * implied by another: platform_admin passes only where it is listed. Returns the staff id.
 */
export function requireStaffRole(ctx: Ctx, ...roles: StaffRole[]): string {
  if (!hasStaffRole(ctx, ...roles)) throw new AppError("FORBIDDEN", "console.errors.roleRequired");
  return (ctx.actor as StaffActor).staffId;
}

/* ── Staff directory (W8) ───────────────────────────────────────────────── */

export type StaffListItem = {
  id: string;
  accountId: string;
  /** Login email, or the generated username of an anonymous account. */
  label: string | null;
  roles: StaffRole[];
  active: boolean;
  twoStepEnabled: boolean;
  createdAt: Date;
};

export async function listStaff(ctx: Ctx): Promise<StaffListItem[]> {
  requireStaffRole(ctx, "platform_admin", "security_administrator");
  const rows = await ctx.db
    .select({
      id: staffMembers.id,
      accountId: staffMembers.accountId,
      email: accounts.email,
      username: accounts.username,
      roles: staffMembers.roles,
      active: staffMembers.active,
      createdAt: staffMembers.createdAt,
      totpEnabledAt: totpSecrets.enabledAt,
    })
    .from(staffMembers)
    .innerJoin(accounts, eq(accounts.id, staffMembers.accountId))
    .leftJoin(totpSecrets, eq(totpSecrets.accountId, staffMembers.accountId))
    .orderBy(desc(staffMembers.active), staffMembers.createdAt);
  return rows.map((r) => ({
    id: r.id,
    accountId: r.accountId,
    label: r.email ?? r.username,
    roles: cleanRoles(r.roles),
    active: r.active,
    twoStepEnabled: !!r.totpEnabledAt,
    createdAt: r.createdAt,
  }));
}

/** How many people currently hold a staff role. Fewer than two = single-operator mode (W9). */
export async function countActiveStaff(ctx: Pick<Ctx, "db">): Promise<number> {
  const [row] = await ctx.db
    .select({ n: count() })
    .from(staffMembers)
    .where(eq(staffMembers.active, true));
  return row?.n ?? 0;
}

/**
 * W9: with fewer than two people on the staff, second-person actions queue with no effect
 * and the platform may not take live payments (M4) — payment code must check this.
 */
export async function isSingleOperatorMode(ctx: Pick<Ctx, "db">): Promise<boolean> {
  return (await countActiveStaff(ctx)) < 2;
}

export const staffRolesInput = z.object({
  accountId: z.string().min(1).max(64),
  /** Shown in the approval queue; the account id is what counts. */
  label: z.string().max(320).nullish(),
  /** Empty = remove the person from the staff. */
  roles: z.array(staffRoleSchema).max(STAFF_ROLES.length),
});
export type StaffRolesInput = z.input<typeof staffRolesInput>;

/** Finds the account a role change is about. platform_admin only. */
export async function findAccountForStaff(
  ctx: Ctx,
  input: { email: string },
): Promise<{ accountId: string; label: string }> {
  requireStaffRole(ctx, "platform_admin");
  const email = z.string().trim().toLowerCase().min(3).max(320).parse(input.email);
  const [row] = await ctx.db
    .select({ id: accounts.id, email: accounts.email })
    .from(accounts)
    .where(and(eq(accounts.email, email), isNull(accounts.deletedAt)));
  if (!row) throw new AppError("NOT_FOUND", "console.errors.accountNotFound");
  return { accountId: row.id, label: row.email ?? email };
}

/**
 * Sets a person's staff roles. NOT a public entry point: it is the executor behind the
 * "staff.set_roles" approval action (see approvals.ts) and the bootstrap CLI. It refuses to
 * leave the platform without an active platform_admin.
 */
export async function applyStaffRoles(ctx: Ctx, input: StaffRolesInput): Promise<void> {
  if (ctx.actor.kind !== "system") requireStaffRole(ctx, "platform_admin");
  const data = staffRolesInput.parse(input);
  const roles = [...new Set(data.roles)];
  await inTx(ctx, async (tx) => {
    const [account] = await tx.db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.id, data.accountId), isNull(accounts.deletedAt)));
    if (!account) throw new AppError("NOT_FOUND", "console.errors.accountNotFound");
    const [before] = await tx.db
      .select()
      .from(staffMembers)
      .where(eq(staffMembers.accountId, data.accountId))
      .for("update");
    const active = roles.length > 0;
    let staffId: string;
    if (before) {
      staffId = before.id;
      await tx.db.update(staffMembers).set({ roles, active }).where(eq(staffMembers.id, before.id));
    } else {
      if (!active) return;
      const [row] = await tx.db
        .insert(staffMembers)
        .values({ accountId: data.accountId, roles, active: true, createdAt: tx.now })
        .returning({ id: staffMembers.id });
      staffId = row!.id;
    }
    const admins = await tx.db
      .select({ roles: staffMembers.roles })
      .from(staffMembers)
      .where(eq(staffMembers.active, true));
    if (!admins.some((a) => a.roles.includes("platform_admin"))) {
      throw new AppError("CONFLICT", "console.errors.lastAdmin");
    }
    if (!active) {
      // A person removed from the staff loses any open console session at once.
      await tx.db
        .update(consoleSessions)
        .set({ endedAt: tx.now, endedReason: "left" })
        .where(and(eq(consoleSessions.staffId, staffId), isNull(consoleSessions.endedAt)));
    }
    await audit(tx, {
      action: "staff.roles_set",
      objectType: "staff_member",
      objectId: staffId,
      before: before ? { roles: before.roles, active: before.active } : null,
      after: { roles, active },
      meta: { accountId: data.accountId },
    });
  });
}

/**
 * Bootstrap (scripts/make-staff.mjs): the operator, at the server, gives an account its
 * staff roles. System actor only. The account still cannot open the console until it has
 * two-step sign-in enabled.
 */
export async function grantStaffBootstrap(
  ctx: Ctx,
  input: { email: string; roles: StaffRole[] },
): Promise<{ accountId: string; staffCount: number }> {
  requireSystem(ctx);
  const email = z.string().trim().toLowerCase().min(3).max(320).parse(input.email);
  const roles = z.array(staffRoleSchema).min(1).parse(input.roles);
  const [account] = await ctx.db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.email, email), isNull(accounts.deletedAt)));
  if (!account) throw new AppError("NOT_FOUND", "console.errors.accountNotFound");
  await applyStaffRoles(ctx, { accountId: account.id, label: email, roles });
  return { accountId: account.id, staffCount: await countActiveStaff(ctx) };
}

/* ── Platform settings (operator-owned values edited from the console) ──── */

/** Reads one platform setting. Internal to core: callers do their own access check. */
export async function readSetting<T = unknown>(ctx: Pick<Ctx, "db">, key: string): Promise<T | null> {
  const [row] = await ctx.db
    .select({ value: platformSettings.value })
    .from(platformSettings)
    .where(eq(platformSettings.key, key));
  return (row?.value as T | undefined) ?? null;
}

/** Writes one platform setting and its audit row. Internal: callers check access first. */
export async function writeSetting(ctx: Ctx, key: string, value: unknown): Promise<void> {
  await inTx(ctx, async (tx) => {
    const before = await readSetting(tx, key);
    const json = JSON.parse(JSON.stringify(value)) as unknown;
    await tx.db
      .insert(platformSettings)
      .values({ key, value: json })
      .onConflictDoUpdate({ target: platformSettings.key, set: { value: json, updatedAt: tx.now } });
    await audit(tx, {
      action: "platform_setting.set",
      objectType: "platform_setting",
      objectId: key,
      before,
      after: json,
    });
  });
}

/* ── Dashboard (W1): counts and broad status only ───────────────────────── */

export type DashboardCounter = {
  /** Stable key, e.g. "businesses"; the console shows console.dashboard.counters.<key>. */
  key: string;
  /** Returns COUNTS ONLY: `{ total, byStatus? }`. Never names, titles or contact details. */
  count: (ctx: Ctx) => Promise<{ total: number; byStatus?: Record<string, number> }>;
};

const g = globalThis as unknown as { __edDashboardCounters?: Map<string, DashboardCounter> };
function counters(): Map<string, DashboardCounter> {
  return (g.__edDashboardCounters ??= new Map());
}

/** Later domains (businesses, listings, enquiries, revenue…) add their own count (W1). */
export function registerDashboardCounter(counter: DashboardCounter): void {
  if (!/^[a-z][a-zA-Z0-9]*$/.test(counter.key)) throw new Error(`Invalid counter key: ${counter.key}`);
  counters().set(counter.key, counter);
}

export type DashboardCount = { key: string; total: number; byStatus: Record<string, number> };

export type Dashboard = {
  accounts: { total: number; email: number; anonymous: number; pendingDeletion: number };
  occasions: { total: number; byStatus: Record<string, number> };
  staff: { active: number; singleOperatorMode: boolean };
  approvals: { pending: number };
  incident: { active: boolean; startedAt: string | null };
  recentJobRuns: Array<{ name: string; status: string; finishedAt: string }>;
  /** Counts added by other domains through registerDashboardCounter. */
  extra: DashboardCount[];
};

const STATUS_KEY = /^[a-z][a-z0-9_]{0,39}$/;

/** Keeps a registered counter honest: integers under short machine keys, nothing else. */
function sanitiseCount(key: string, raw: { total: number; byStatus?: Record<string, number> }): DashboardCount {
  const byStatus: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw.byStatus ?? {})) {
    if (STATUS_KEY.test(k) && Number.isFinite(Number(v))) byStatus[k] = Math.trunc(Number(v));
  }
  return { key, total: Math.trunc(Number(raw.total)) || 0, byStatus };
}

/**
 * W1: the platform at a glance. Every query here is an aggregate (count / group by status)
 * or operational metadata (job names, statuses, times) — never planner content: no occasion
 * titles, no guest or account names, no addresses.
 */
export async function getDashboard(ctx: Ctx): Promise<Dashboard> {
  requireStaffRole(ctx);
  const accountRows = await ctx.db
    .select({ kind: accounts.kind, n: count() })
    .from(accounts)
    .where(isNull(accounts.deletedAt))
    .groupBy(accounts.kind);
  const [pendingDeletion] = await ctx.db
    .select({ n: count() })
    .from(accounts)
    .where(and(isNull(accounts.deletedAt), isNotNull(accounts.deletionRequestedAt)));
  const occasionRows = await ctx.db
    .select({ status: occasions.status, n: count() })
    .from(occasions)
    .groupBy(occasions.status);
  const [pendingApprovals] = await ctx.db
    .select({ n: count() })
    .from(approvalRequests)
    .where(eq(approvalRequests.state, "pending"));
  const [incident] = await ctx.db
    .select({ startedAt: incidents.startedAt })
    .from(incidents)
    .where(isNull(incidents.resolvedAt))
    .orderBy(desc(incidents.startedAt))
    .limit(1);
  const runs = await ctx.db
    .select({ name: jobRuns.name, status: jobRuns.status, finishedAt: jobRuns.finishedAt })
    .from(jobRuns)
    .orderBy(desc(jobRuns.finishedAt))
    .limit(8);
  const activeStaff = await countActiveStaff(ctx);

  const extra: DashboardCount[] = [];
  for (const c of counters().values()) {
    try {
      extra.push(sanitiseCount(c.key, await c.count(ctx)));
    } catch {
      // one broken counter must not take the dashboard down
    }
  }

  const byKind = Object.fromEntries(accountRows.map((r) => [r.kind, r.n]));
  const byStatus: Record<string, number> = {};
  for (const r of occasionRows) if (STATUS_KEY.test(String(r.status))) byStatus[String(r.status)] = r.n;
  return {
    accounts: {
      total: accountRows.reduce((s, r) => s + r.n, 0),
      email: byKind.email ?? 0,
      anonymous: byKind.anonymous ?? 0,
      pendingDeletion: pendingDeletion?.n ?? 0,
    },
    occasions: { total: occasionRows.reduce((s, r) => s + r.n, 0), byStatus },
    staff: { active: activeStaff, singleOperatorMode: activeStaff < 2 },
    approvals: { pending: pendingApprovals?.n ?? 0 },
    incident: { active: !!incident, startedAt: incident?.startedAt.toISOString() ?? null },
    recentJobRuns: runs.map((r) => ({
      name: r.name,
      status: r.status,
      finishedAt: r.finishedAt.toISOString(),
    })),
    extra,
  };
}
