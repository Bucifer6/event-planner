import { and, eq, gt, isNotNull, lt, ne, occasionMembers, sql, tasks, whatifPreviews } from "@ed/db";
import { addDays } from "@ed/shared/time";
import { requireMember, type Member } from "./access";
import { accountLabel } from "./accounts";
import type { Ctx } from "./context";
import { listOpenOffersUnchecked } from "./delegations";
import { getOccasionView, type OccasionView } from "./occasions";
import { enrichTasksUnchecked, queryTasksUnchecked, type Task, type TaskItem } from "./tasks";
import { instantToDay } from "./templates";

// Overview (A10): days to go, next milestone, overdue work, unaccepted delegations, blockers.
// The same four sections feed the daily digest (see ./digest), through collectAttention.

export type BlockerReason = "waiting" | "blocked" | "outOfOrder";
export type Blocker = { task: TaskItem; reason: BlockerReason };
export type OfferLine = {
  id: string;
  taskId: string;
  taskTitle: string;
  fromMemberId: string;
  fromName: string | null;
  toMemberId: string;
  toName: string | null;
  createdAt: Date;
};

export type Attention = {
  nextMilestone: TaskItem | null;
  overdue: { items: TaskItem[]; total: number };
  offers: { items: OfferLine[]; total: number };
  blockers: { items: Blocker[]; total: number };
};

const SECTION_LIMIT = 5;
/** A task waiting on unfinished work counts as a blocker once it is due within this many days. */
export const BLOCKER_HORIZON_DAYS = 14;

/**
 * The four attention sections of an occasion. With `forMemberId` the lists are narrowed to
 * that member's own work (their tasks, offers to or from them) — used for non-managers in the
 * digest. NO access check: callers check membership first.
 */
export async function collectAttention(
  ctx: Ctx,
  occasionId: string,
  opts: { forMemberId?: string; timezone: string },
): Promise<Attention> {
  const today = instantToDay(ctx.now, opts.timezone);
  const own = opts.forMemberId ? eq(tasks.ownerMemberId, opts.forMemberId) : undefined;

  const [upcoming, overdue, offers, waiting, blockedRows, outOfOrderRows, names] = await Promise.all([
    queryTasksUnchecked(ctx, occasionId, { statuses: ["todo", "doing", "waiting"], dueFrom: today, limit: 1 }),
    queryTasksUnchecked(ctx, occasionId, {
      overdueBefore: today,
      ownerMemberId: opts.forMemberId,
      limit: SECTION_LIMIT,
    }),
    listOpenOffersUnchecked(ctx, occasionId),
    queryTasksUnchecked(ctx, occasionId, {
      statuses: ["waiting"],
      ownerMemberId: opts.forMemberId,
      limit: SECTION_LIMIT,
    }),
    // not done, due soon (or overdue), and still waiting for another unfinished task
    ctx.db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.occasionId, occasionId),
          ne(tasks.status, "done"),
          ne(tasks.status, "waiting"),
          isNotNull(tasks.dueAt),
          lt(tasks.dueAt, addDays(ctx.now, BLOCKER_HORIZON_DAYS)),
          own,
          sql`exists (select 1 from task_dependencies d join tasks dep on dep.id = d.depends_on_task_id
                      where d.task_id = ${tasks.id} and dep.status <> 'done')`,
        ),
      )
      .orderBy(sql`${tasks.dueAt} asc`)
      .limit(SECTION_LIMIT),
    // done out of order: before what it depends on, or with unfinished child tasks
    ctx.db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.occasionId, occasionId),
          eq(tasks.status, "done"),
          own,
          sql`(exists (select 1 from task_dependencies d join tasks dep on dep.id = d.depends_on_task_id
                       where d.task_id = ${tasks.id} and dep.status <> 'done')
               or exists (select 1 from tasks c where c.parent_id = ${tasks.id} and c.status <> 'done'))`,
        ),
      )
      .orderBy(sql`${tasks.completedAt} desc nulls last`)
      .limit(SECTION_LIMIT),
    memberNameMap(ctx, occasionId),
  ]);

  const [blocked, outOfOrder] = await Promise.all([
    enrichTasksUnchecked(ctx, occasionId, blockedRows as Task[]),
    enrichTasksUnchecked(ctx, occasionId, outOfOrderRows as Task[]),
  ]);
  const blockers: Blocker[] = [
    ...outOfOrder.map((task) => ({ task, reason: "outOfOrder" as const })),
    ...blocked.map((task) => ({ task, reason: "blocked" as const })),
    ...waiting.rows.map((task) => ({ task, reason: "waiting" as const })),
  ];
  const myOffers = opts.forMemberId
    ? offers.filter((o) => o.toMemberId === opts.forMemberId || o.fromMemberId === opts.forMemberId)
    : offers;

  return {
    nextMilestone: upcoming.rows[0] ?? null,
    overdue: { items: overdue.rows, total: overdue.total },
    offers: {
      items: myOffers.slice(0, SECTION_LIMIT).map((o) => ({
        ...o,
        fromName: names.get(o.fromMemberId) ?? null,
        toName: names.get(o.toMemberId) ?? null,
      })),
      total: myOffers.length,
    },
    blockers: {
      items: blockers.slice(0, SECTION_LIMIT),
      total: outOfOrder.length + blocked.length + waiting.total,
    },
  };
}

async function memberNameMap(ctx: Ctx, occasionId: string): Promise<Map<string, string>> {
  const rows = await ctx.db
    .select({
      id: occasionMembers.id,
      inviteEmail: occasionMembers.inviteEmail,
      email: sql<string | null>`(select a.email from accounts a where a.id = ${occasionMembers.accountId})`,
      username: sql<string | null>`(select a.username from accounts a where a.id = ${occasionMembers.accountId})`,
      displayName: sql<string | null>`(select a.display_name from accounts a where a.id = ${occasionMembers.accountId})`,
    })
    .from(occasionMembers)
    .where(eq(occasionMembers.occasionId, occasionId));
  return new Map(rows.map((r) => [r.id, accountLabel(r) || r.inviteEmail || ""]));
}

/* ── Extension point ────────────────────────────────────────────────────── */

export type OverviewText = string | { key: string; params?: Record<string, string | number> };
export type OverviewSectionResult = {
  /** i18n key of the section title. */
  titleKey: string;
  lines: OverviewText[];
  /** Where "see all" goes, relative to /occasions/<id>/ (e.g. "budget"). */
  slug?: string;
};
export type OverviewSection = {
  key: string;
  /**
   * Return null to show nothing to this member. Do your own grant check here (for example
   * `member.grants.finance`) — a section must never show data its viewer has no grant for (D2).
   */
  forMember: (ctx: Ctx, member: Member, occasionId: string) => Promise<OverviewSectionResult | null>;
};

const g = globalThis as unknown as { __edOverviewSections?: Map<string, OverviewSection> };
const sections: Map<string, OverviewSection> = (g.__edOverviewSections ??= new Map());

/** Later releases (budget, guests, suppliers) add their own block under the four core sections. */
export function registerOverviewSection(section: OverviewSection): void {
  sections.set(section.key, section);
}

export type Overview = OccasionView &
  Attention & {
    progress: { total: number; done: number };
    brief: { purpose: string | null; priorities: Array<{ text: string; index: number; openTasks: number }> };
    /** Pending What-if proposals waiting for a decision. */
    pendingProposals: number;
    extra: Array<OverviewSectionResult & { key: string }>;
  };

/** Everything the overview page shows. Members only. */
export async function getOverview(ctx: Ctx, occasionId: string): Promise<Overview> {
  const member = await requireMember(ctx, occasionId);
  const view = await getOccasionView(ctx, occasionId);
  const [attention, counts, byPriority, proposals] = await Promise.all([
    collectAttention(ctx, occasionId, { timezone: view.occasion.timezone }),
    ctx.db
      .select({ status: tasks.status, n: sql<number>`count(*)::int` })
      .from(tasks)
      .where(eq(tasks.occasionId, occasionId))
      .groupBy(tasks.status),
    ctx.db
      .select({ index: tasks.priorityIndex, n: sql<number>`count(*)::int` })
      .from(tasks)
      .where(and(eq(tasks.occasionId, occasionId), isNotNull(tasks.priorityIndex), ne(tasks.status, "done")))
      .groupBy(tasks.priorityIndex),
    ctx.db
      .select({ n: sql<number>`count(*)::int` })
      .from(whatifPreviews)
      .where(
        and(
          eq(whatifPreviews.occasionId, occasionId),
          eq(whatifPreviews.state, "pending"),
          gt(whatifPreviews.expiresAt, ctx.now),
        ),
      ),
  ]);
  const total = counts.reduce((sum, c) => sum + c.n, 0);
  const done = counts.find((c) => c.status === "done")?.n ?? 0;
  const open = new Map(byPriority.map((p) => [p.index, p.n]));

  const extra: Overview["extra"] = [];
  for (const section of sections.values()) {
    const result = await section.forMember(ctx, member, occasionId);
    if (result) extra.push({ key: section.key, ...result });
  }

  return {
    ...view,
    ...attention,
    progress: { total, done },
    brief: {
      purpose: view.occasion.purpose,
      priorities: view.occasion.priorities.map((text, index) => ({ text, index, openTasks: open.get(index) ?? 0 })),
    },
    pendingProposals: proposals[0]?.n ?? 0,
    extra,
  };
}
