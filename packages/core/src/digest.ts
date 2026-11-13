import {
  accounts,
  and,
  deletionRequests,
  eq,
  gte,
  isNotNull,
  isNull,
  occasionMembers,
  occasions,
  or,
  reminderDigests,
  type OccasionRole,
} from "@ed/db";
import { registerTemplate, sendEmail } from "@ed/email";
import { defineJob, defineSchedule } from "@ed/jobs";
import { isAppError } from "@ed/shared/errors";
import { addDays, bucharestDateKey } from "@ed/shared/time";
import { z } from "zod";
import { isManager, type Member } from "./access";
import { accountCtx, requireSystem, type Ctx } from "./context";
import { collectAttention, type OverviewText } from "./overview";
import { daysBetween, formatDay, instantToDay } from "./templates";

// Daily reminder digest (A10, L5): one email per member per Bucharest day with the four
// overview sections — next milestone, overdue work, unaccepted delegations, blockers.
// Owners and project managers get the whole occasion; everyone else their own work.
// Members with nothing to report get no email. Suppression and the Q6 cap are sendEmail's.

export type DigestLine = OverviewText;
export type DigestSection = {
  key: string;
  /** i18n key of the section heading. */
  titleKey: string;
  /**
   * Lines for this member, or [] for nothing. `ctx` acts as the member's own account, so
   * requireMember(ctx, occasionId, { grant: "finance" }) works as the gate: only return lines
   * to people who hold the grant your data needs (D2).
   */
  forMember: (ctx: Ctx, member: Member, occasionId: string) => Promise<DigestLine[]>;
};

const g = globalThis as unknown as { __edDigestSections?: Map<string, DigestSection> };
const extraSections: Map<string, DigestSection> = (g.__edDigestSections ??= new Map());

/** Adds a section after the four core ones (e.g. finance: payments due, for grant holders). */
export function registerDigestSection(section: DigestSection): void {
  extraSections.set(section.key, section);
}

export const DIGEST_CORE_SECTIONS = ["milestone", "overdue", "delegations", "blockers"] as const;
export type DigestContent = {
  occasionId: string;
  occasionTitle: string;
  /** Days to the occasion; null = no date yet. */
  daysLeft: number | null;
  sections: Array<{ key: string; titleKey: string; lines: DigestLine[] }>;
  /** False when every section is empty and the next milestone is more than a week away. */
  worthSending: boolean;
};

/** How close the next milestone must be for a digest that has nothing else to say. */
export const MILESTONE_SOON_DAYS = 7;

type MemberRow = typeof occasionMembers.$inferSelect;

function toMember(row: MemberRow): Member {
  const owner = row.role === "owner";
  return {
    id: row.id,
    occasionId: row.occasionId,
    accountId: row.accountId!,
    role: row.role as OccasionRole,
    grants: { finance: owner || row.grantFinance, privateRequests: owner || row.grantPrivateRequests },
  };
}

/** Builds one member's digest. System only (the job); the content is scoped to the member. */
export async function buildDigest(ctx: Ctx, input: { occasionId: string; memberId: string }): Promise<DigestContent | null> {
  requireSystem(ctx);
  const [row] = await ctx.db
    .select({ m: occasionMembers, o: occasions })
    .from(occasionMembers)
    .innerJoin(occasions, eq(occasions.id, occasionMembers.occasionId))
    .where(
      and(
        eq(occasionMembers.id, input.memberId),
        eq(occasionMembers.occasionId, input.occasionId),
        isNull(occasionMembers.removedAt),
        isNotNull(occasionMembers.accountId),
      ),
    );
  if (!row) return null;
  const member = toMember(row.m);
  const tz = row.o.timezone;
  const attention = await collectAttention(ctx, row.o.id, {
    timezone: tz,
    forMemberId: isManager(member) ? undefined : member.id,
  });
  const today = instantToDay(ctx.now, tz);
  const due = (d: Date | null) => (d ? formatDay(d, tz) : "");
  const more = (shown: number, total: number): DigestLine[] =>
    total > shown ? [{ key: "digest.more", params: { count: total - shown } }] : [];

  const milestone = attention.nextMilestone;
  const sections: DigestContent["sections"] = [
    {
      key: "milestone",
      titleKey: "digest.sections.milestone",
      lines: milestone
        ? [{ key: "digest.lines.task", params: { title: milestone.title, date: due(milestone.dueAt) } }]
        : [],
    },
    {
      key: "overdue",
      titleKey: "digest.sections.overdue",
      lines: [
        ...attention.overdue.items.map((t) => ({
          key: "digest.lines.task",
          params: { title: t.title, date: due(t.dueAt) },
        })),
        ...more(attention.overdue.items.length, attention.overdue.total),
      ],
    },
    {
      key: "delegations",
      titleKey: "digest.sections.delegations",
      lines: [
        ...attention.offers.items.map((o) =>
          o.toMemberId === member.id
            ? { key: "digest.lines.offerToYou", params: { title: o.taskTitle, from: o.fromName ?? "" } }
            : { key: "digest.lines.offerWaiting", params: { title: o.taskTitle, to: o.toName ?? "" } },
        ),
        ...more(attention.offers.items.length, attention.offers.total),
      ],
    },
    {
      key: "blockers",
      titleKey: "digest.sections.blockers",
      lines: [
        ...attention.blockers.items.map((b) => ({
          key: `digest.lines.blocker.${b.reason}`,
          params: { title: b.task.title },
        })),
        ...more(attention.blockers.items.length, attention.blockers.total),
      ],
    },
  ];

  const memberCtx = accountCtx(ctx.db, member.accountId, { now: ctx.now, locale: ctx.locale });
  let extraLines = 0;
  for (const section of extraSections.values()) {
    let lines: DigestLine[] = [];
    try {
      lines = await section.forMember(memberCtx, member, row.o.id);
    } catch (e) {
      // a section the member has no grant for (FORBIDDEN) simply does not appear
      if (!isAppError(e)) throw e;
    }
    if (lines.length > 0) {
      sections.push({ key: section.key, titleKey: section.titleKey, lines });
      extraLines += lines.length;
    }
  }

  const milestoneSoon =
    milestone?.dueDay != null && daysBetween(today, milestone.dueDay) <= MILESTONE_SOON_DAYS;
  const worthSending =
    milestoneSoon ||
    attention.overdue.total > 0 ||
    attention.offers.total > 0 ||
    attention.blockers.total > 0 ||
    extraLines > 0;

  return {
    occasionId: row.o.id,
    occasionTitle: row.o.title,
    daysLeft: row.o.startsAt ? daysBetween(today, instantToDay(row.o.startsAt, tz)) : null,
    sections,
    worthSending,
  };
}

export type DigestEmailParams = DigestContent & { url: string };

registerTemplate<DigestEmailParams>("digest.daily", (p, { t }) => {
  const line = (l: DigestLine) => (typeof l === "string" ? l : t(l.key, l.params));
  const countdown =
    p.daysLeft === null
      ? t("digest.countdown.noDate")
      : p.daysLeft === 0
        ? t("digest.countdown.today")
        : p.daysLeft > 0
          ? t("digest.countdown.days", { count: p.daysLeft })
          : t("digest.countdown.past");
  return {
    subject: t("digest.subject", { occasion: p.occasionTitle }),
    blocks: [
      { kind: "text", text: t("digest.intro", { occasion: p.occasionTitle, countdown }) },
      ...p.sections.flatMap((s) => [
        { kind: "text" as const, text: t(s.titleKey) },
        ...(s.lines.length > 0
          ? s.lines.map((l) => ({ kind: "note" as const, text: `— ${line(l)}` }))
          : [{ kind: "note" as const, text: `— ${t(`digest.empty.${emptyKey(s.key)}`)}` }]),
      ]),
      { kind: "button", label: t("digest.button"), url: p.url },
      { kind: "note", text: t("digest.why") },
    ],
  };
});

function emptyKey(key: string): string {
  return (DIGEST_CORE_SECTIONS as readonly string[]).includes(key) ? key : "other";
}

function appUrl(): string {
  return (process.env.APP_URL || "http://localhost:3000").replace(/\/+$/, "");
}

export type DigestOutcome = "sent" | "suppressed" | "empty" | "no_email" | "capped" | "already" | "gone";

/**
 * Sends one member's digest for the Bucharest day of ctx.now — at most once: the unique
 * (member, day) row in reminder_digests is claimed first, so a retried or duplicated job
 * cannot send a second email.
 */
export async function sendDigest(ctx: Ctx, input: { occasionId: string; memberId: string }): Promise<DigestOutcome> {
  requireSystem(ctx);
  const dateKey = bucharestDateKey(ctx.now);
  const content = await buildDigest(ctx, input);
  if (!content) return "gone";
  const [member] = await ctx.db
    .select({ email: accounts.email, locale: accounts.locale })
    .from(occasionMembers)
    .innerJoin(accounts, eq(accounts.id, occasionMembers.accountId))
    .where(eq(occasionMembers.id, input.memberId));
  const outcome: DigestOutcome = !content.worthSending ? "empty" : !member?.email ? "no_email" : "sent";

  const claimed = await ctx.db
    .insert(reminderDigests)
    .values({ occasionId: input.occasionId, memberId: input.memberId, dateKey, outcome, createdAt: ctx.now })
    .onConflictDoNothing()
    .returning({ id: reminderDigests.id });
  if (claimed.length === 0) return "already";
  if (outcome !== "sent") return outcome;

  const mark = (value: DigestOutcome) =>
    ctx.db.update(reminderDigests).set({ outcome: value }).where(eq(reminderDigests.id, claimed[0]!.id));
  try {
    const res = await sendEmail(ctx, {
      to: member!.email!,
      template: "digest.daily",
      params: { ...content, url: `${appUrl()}/occasions/${content.occasionId}` } satisfies DigestEmailParams,
      locale: member!.locale,
      occasionId: content.occasionId,
    });
    if (res.status === "suppressed") {
      await mark("suppressed");
      return "suppressed";
    }
    return "sent";
  } catch (e) {
    if (isAppError(e) && e.code === "LIMIT") {
      await mark("capped"); // Q6: the occasion reached its daily email limit — not retried today
      return "capped";
    }
    // provider failure: release the claim so the job's retry can send it
    await ctx.db.delete(reminderDigests).where(eq(reminderDigests.id, claimed[0]!.id));
    throw e;
  }
}

export const DIGEST_PLAN_JOB = "digest.plan";
export const DIGEST_SEND_JOB = "digest.send";
const sendPayload = z.object({ occasionId: z.string().min(1).max(64), memberId: z.string().min(1).max(64) });

/**
 * Enqueues one digest.send per joined member of every occasion still being planned (not
 * pending deletion, not long past). Returns how many jobs were added.
 */
export async function planDigests(ctx: Ctx): Promise<number> {
  requireSystem(ctx);
  const dateKey = bucharestDateKey(ctx.now);
  const rows = await ctx.db
    .select({ memberId: occasionMembers.id, occasionId: occasions.id })
    .from(occasionMembers)
    .innerJoin(occasions, eq(occasions.id, occasionMembers.occasionId))
    .leftJoin(
      deletionRequests,
      and(
        eq(deletionRequests.targetType, "occasion"),
        eq(deletionRequests.targetId, occasions.id),
        isNull(deletionRequests.undoneAt),
        isNull(deletionRequests.completedAt),
      ),
    )
    .where(
      and(
        isNull(occasionMembers.removedAt),
        isNotNull(occasionMembers.accountId),
        eq(occasions.status, "planning"),
        isNull(deletionRequests.id),
        or(isNull(occasions.startsAt), gte(occasions.startsAt, addDays(ctx.now, -14))),
      ),
    );
  let added = 0;
  for (const r of rows) {
    const res = await digestSendJob().enqueue(ctx, r, { uniqueKey: `digest:${r.memberId}:${dateKey}` });
    if (!res.deduped) added += 1;
  }
  return added;
}

function digestSendJob() {
  return defineJob(DIGEST_SEND_JOB, sendPayload, async (ctx, payload) => {
    await sendDigest(ctx, payload);
  });
}

export function registerJobs(): void {
  digestSendJob();
  defineJob(DIGEST_PLAN_JOB, z.object({}).passthrough(), async (ctx) => {
    await planDigests(ctx);
  });
  defineSchedule({ name: "digest.daily", job: DIGEST_PLAN_JOB, every: { kind: "daily", at: "07:30" } });
}
