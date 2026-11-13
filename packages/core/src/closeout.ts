import {
  and,
  desc,
  eq,
  households,
  isNotNull,
  lessons,
  lt,
  ne,
  occasions,
  rsvpResponses,
  sql,
  tasks,
  type OccasionKind,
  type OccasionStatus,
} from "@ed/db";
import { registerTemplate, sendEmail } from "@ed/email";
import { defineJob } from "@ed/jobs";
import { AppError, isAppError } from "@ed/shared/errors";
import { addDays } from "@ed/shared/time";
import { z } from "zod";
import { requireMember } from "./access";
import { requireFreshAuth } from "./accounts";
import { audit } from "./audit";
import "./budget";
import { requireAccount, requireSystem, requireWriteCapable, type Ctx } from "./context";
import "./expenses";
import { withIdempotency } from "./idempotency";
import { bumpGuestRevision } from "./invitations";
import "./ledger";
import {
  closeoutSectionProviders,
  lifecycleImpactProviders,
  registerLifecycleImpact,
  type CloseoutItem,
  type DeltaRow,
  type LifecycleChange,
} from "./lifecycle";
import { applyMoveDate, computeMoveDateDelta, type Occasion } from "./occasions";
import { registerOverviewSection } from "./overview";
import { daysBetween, formatDay, instantToDay, shiftDay, zDay } from "./templates";
import { createPreview, registerWhatIf, type WhatIfPreview } from "./whatif";

// Occasion lifecycle (B9 cancel / postpone, B10 closeout).
//
// Cancel, postpone and close are What-if kinds: the preview lists EVERYTHING affected by
// asking every registered lifecycle impact provider (@ed/core/lifecycle); nothing happens
// until an owner or project manager, freshly confirmed (S4), applies it. Applying is atomic
// and happens once (the What-if engine's conditional claim); discarding changes nothing.
//
//   occasion.cancel    planning | postponed → cancelled
//   occasion.postpone  planning | postponed → postponed, on a new date (tasks shift exactly as
//                      in "occasion.moveDate")
//   occasion.close     any state → closed; closed_at starts the retention clock (INF6) and the
//                      occasion becomes read-only (assertOccasionWritable)
//
// Cancel and postpone bump the guest revision (households see the change on their invitation
// page) and email each household lead who gave an address — once, through a job.

export const CANCEL_KIND = "occasion.cancel";
export const POSTPONE_KIND = "occasion.postpone";
export const CLOSE_KIND = "occasion.close";
export const NOTIFY_GUESTS_JOB = "lifecycle.notify-guests";
/** Private requests are removed this many days after closeout (INF6, D5). */
export const PRIVATE_REQUESTS_DAYS_AFTER_CLOSEOUT = 30;

const idSchema = z.string().min(1).max(64);

async function loadOccasion(ctx: Ctx, occasionId: string): Promise<Occasion> {
  const [row] = await ctx.db.select().from(occasions).where(eq(occasions.id, occasionId));
  if (!row) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  return row;
}

/** Managers only, freshly confirmed, for anything but reading the preview. */
async function authorize(ctx: Ctx, occasionId: string | null, action: string): Promise<void> {
  if (action === "read") {
    await requireMember(ctx, occasionId ?? "");
    return;
  }
  await requireMember(ctx, occasionId ?? "", { manage: true });
  if (action === "create" || action === "confirm") await requireFreshAuth(ctx);
}

/** Rows from every registered provider. A provider the viewer has no access to is skipped. */
async function collectImpacts(ctx: Ctx, occasionId: string, change: LifecycleChange): Promise<DeltaRow[]> {
  const rows: DeltaRow[] = [];
  for (const provider of lifecycleImpactProviders()) {
    try {
      for (const row of await provider.collect(ctx, occasionId, change)) {
        rows.push({ ...row, key: `${provider.key}:${row.key}`.slice(0, 200) });
      }
    } catch (e) {
      if (!isAppError(e)) throw e;
    }
  }
  return rows.slice(0, 400);
}

async function applyImpacts(tx: Ctx, occasionId: string, change: LifecycleChange): Promise<void> {
  for (const provider of lifecycleImpactProviders()) {
    if (provider.apply) await provider.apply(tx, occasionId, change);
  }
}

async function emailableHouseholds(ctx: Ctx, occasionId: string): Promise<number> {
  const [row] = await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(households)
    .where(and(eq(households.occasionId, occasionId), isNotNull(households.leadEmail)));
  return row?.n ?? 0;
}

const statusText = (status: OccasionStatus) => ({ key: `lifecycle.status.${status}` });

function notifyRow(count: number): DeltaRow {
  return count > 0
    ? { key: "_notify", what: { key: "lifecycle.whatif.notifyRow", params: { count } }, kindLabelKey: "lifecycle.whatif.notifyLabel", noteKey: "lifecycle.whatif.notifyNote" }
    : { key: "_notify", what: { key: "lifecycle.whatif.notifyNobody" }, kindLabelKey: "lifecycle.whatif.notifyLabel", noteKey: "lifecycle.whatif.notifyPageNote" };
}

/* ── Cancel ─────────────────────────────────────────────────────────────── */

const cancelInput = z.object({ expectedStatus: z.enum(["planning", "postponed"]) });

registerWhatIf<z.infer<typeof cancelInput>>(CANCEL_KIND, {
  input: cancelInput,
  authorize: (ctx, subject, action) => authorize(ctx, subject.occasionId, action),
  compute: async (ctx, _input, subject) => {
    const occasion = await loadOccasion(ctx, subject.occasionId ?? "");
    const delta: DeltaRow[] = [
      {
        key: "_status",
        what: { key: "lifecycle.whatif.statusRow" },
        kindLabelKey: "whatif.kinds.changed",
        before: statusText(occasion.status),
        after: statusText("cancelled"),
      },
      ...(await collectImpacts(ctx, occasion.id, { kind: "cancel" })),
      notifyRow(await emailableHouseholds(ctx, occasion.id)),
    ];
    return { title: { key: "lifecycle.whatif.cancelTitle", params: { title: occasion.title } }, delta };
  },
  apply: async (tx, preview) => {
    const occasionId = preview.occasionId ?? "";
    const claimed = await tx.db
      .update(occasions)
      .set({ status: "cancelled" })
      .where(and(eq(occasions.id, occasionId), eq(occasions.status, preview.input.expectedStatus)))
      .returning({ id: occasions.id });
    if (claimed.length === 0) throw new AppError("CONFLICT", "whatif.errors.stale");
    await applyImpacts(tx, occasionId, { kind: "cancel" });
    await bumpGuestRevision(tx, occasionId, "lifecycle.guest.cancelled");
    await notifyJob().enqueue(tx, { occasionId, change: "cancelled", previewId: preview.id }, { uniqueKey: `lifecycle:${preview.id}` });
    await audit(tx, {
      action: "occasion.cancelled",
      objectType: "occasion",
      objectId: occasionId,
      before: { status: preview.input.expectedStatus },
      after: { status: "cancelled" },
    });
  },
});

/** Preview of cancelling the occasion. Owner or project manager, freshly confirmed. */
export async function proposeCancel(ctx: Ctx, input: { occasionId: string }): Promise<WhatIfPreview> {
  requireWriteCapable(ctx);
  const occasionId = idSchema.parse(input.occasionId);
  await authorize(ctx, occasionId, "create");
  const occasion = await loadOccasion(ctx, occasionId);
  if (occasion.status !== "planning" && occasion.status !== "postponed") {
    throw new AppError("CONFLICT", `lifecycle.errors.already.${occasion.status}`);
  }
  return createPreview(ctx, {
    kind: CANCEL_KIND,
    occasionId,
    subjectType: "occasion",
    subjectId: occasionId,
    input: { expectedStatus: occasion.status },
  });
}

/* ── Postpone ───────────────────────────────────────────────────────────── */

const postponeInput = z.object({
  startsOn: zDay,
  expectedStatus: z.enum(["planning", "postponed"]),
  /** The occasion day the preview was computed against ("" = none): stale if it changed. */
  expectedStartsOn: z.string().max(10),
});
type PostponeInput = z.infer<typeof postponeInput>;

/** Same mode as today (a multi-day occasion keeps its length); "by poll" becomes a fixed day. */
function movedDates(occasion: Occasion, startsOn: string): { dateMode: "date" | "range"; startsOn: string; endsOn?: string } {
  const tz = occasion.timezone;
  if (occasion.dateMode === "range" && occasion.startsAt && occasion.endsAt) {
    const length = daysBetween(instantToDay(occasion.startsAt, tz), instantToDay(occasion.endsAt, tz));
    return { dateMode: "range", startsOn, endsOn: shiftDay(startsOn, { days: length }) };
  }
  return { dateMode: "date", startsOn };
}

registerWhatIf<PostponeInput>(POSTPONE_KIND, {
  input: postponeInput,
  authorize: (ctx, subject, action) => authorize(ctx, subject.occasionId, action),
  compute: async (ctx, input, subject) => {
    const occasion = await loadOccasion(ctx, subject.occasionId ?? "");
    const change: LifecycleChange = { kind: "postpone", startsOn: input.startsOn };
    const delta: DeltaRow[] = [
      {
        key: "_status",
        what: { key: "lifecycle.whatif.statusRow" },
        kindLabelKey: "whatif.kinds.changed",
        before: statusText(occasion.status),
        after: statusText("postponed"),
      },
      // the date itself and every task that shifts — the same rows as "occasion.moveDate"
      ...(await computeMoveDateDelta(ctx, occasion, movedDates(occasion, input.startsOn))),
      ...(await collectImpacts(ctx, occasion.id, change)),
      notifyRow(await emailableHouseholds(ctx, occasion.id)),
    ];
    return {
      title: {
        key: "lifecycle.whatif.postponeTitle",
        params: { title: occasion.title, date: formatDay(dayInstant(input.startsOn), "UTC") },
      },
      delta,
    };
  },
  apply: async (tx, preview) => {
    const occasion = await loadOccasion(tx, preview.occasionId ?? "");
    const input = preview.input;
    const current = occasion.startsAt ? instantToDay(occasion.startsAt, occasion.timezone) : "";
    if (occasion.status !== input.expectedStatus || current !== input.expectedStartsOn) {
      throw new AppError("CONFLICT", "whatif.errors.stale");
    }
    await applyMoveDate(tx, occasion, movedDates(occasion, input.startsOn));
    await tx.db.update(occasions).set({ status: "postponed" }).where(eq(occasions.id, occasion.id));
    await applyImpacts(tx, occasion.id, { kind: "postpone", startsOn: input.startsOn });
    await bumpGuestRevision(tx, occasion.id, "lifecycle.guest.postponed");
    await notifyJob().enqueue(
      tx,
      { occasionId: occasion.id, change: "postponed", previewId: preview.id },
      { uniqueKey: `lifecycle:${preview.id}` },
    );
    await audit(tx, {
      action: "occasion.postponed",
      objectType: "occasion",
      objectId: occasion.id,
      before: { status: occasion.status, startsOn: current },
      after: { status: "postponed", startsOn: input.startsOn },
    });
  },
});

/** A yyyy-mm-dd day as a UTC-noon instant, for formatDay(…, "UTC"). */
function dayInstant(day: string): Date {
  return new Date(`${day}T12:00:00.000Z`);
}

/** Preview of postponing to a new day. Owner or project manager, freshly confirmed. */
export async function proposePostpone(ctx: Ctx, input: { occasionId: string; startsOn: string }): Promise<WhatIfPreview> {
  requireWriteCapable(ctx);
  const occasionId = idSchema.parse(input.occasionId);
  await authorize(ctx, occasionId, "create");
  const occasion = await loadOccasion(ctx, occasionId);
  if (occasion.status !== "planning" && occasion.status !== "postponed") {
    throw new AppError("CONFLICT", `lifecycle.errors.already.${occasion.status}`);
  }
  // (zDay's calendar check assumes the shape, so test the shape first)
  const day = /^\d{4}-\d{2}-\d{2}$/.test(input.startsOn ?? "") ? zDay.safeParse(input.startsOn) : { success: false as const, data: undefined };
  const fieldError = (key: string): never => {
    throw new AppError("VALIDATION", key, { fieldErrors: { startsOn: [key] } });
  };
  if (!day.success) fieldError("lifecycle.errors.dateRequired");
  const startsOn = day.data!;
  const current = occasion.startsAt ? instantToDay(occasion.startsAt, occasion.timezone) : "";
  if (startsOn === current) fieldError("lifecycle.errors.sameDate");
  if (startsOn <= instantToDay(ctx.now, occasion.timezone)) fieldError("lifecycle.errors.dateInPast");
  if (current && startsOn < current) fieldError("lifecycle.errors.dateEarlier");
  return createPreview(ctx, {
    kind: POSTPONE_KIND,
    occasionId,
    subjectType: "occasion",
    subjectId: occasionId,
    input: { startsOn, expectedStatus: occasion.status, expectedStartsOn: current },
  });
}

/* ── Close ──────────────────────────────────────────────────────────────── */

const closeInput = z.object({ expectedStatus: z.enum(["planning", "postponed", "cancelled"]) });

registerWhatIf<z.infer<typeof closeInput>>(CLOSE_KIND, {
  input: closeInput,
  authorize: (ctx, subject, action) => authorize(ctx, subject.occasionId, action),
  compute: async (ctx, _input, subject) => {
    const occasion = await loadOccasion(ctx, subject.occasionId ?? "");
    const closeout = await collectCloseout(ctx, occasion.id);
    const open = closeout.reduce((n, s) => n + s.items.length, 0);
    const delta: DeltaRow[] = [
      {
        key: "_status",
        what: { key: "lifecycle.whatif.statusRow" },
        kindLabelKey: "whatif.kinds.changed",
        before: statusText(occasion.status),
        after: statusText("closed"),
      },
      { key: "_readonly", what: { key: "lifecycle.whatif.readOnlyRow" }, kindLabelKey: "whatif.kinds.affected" },
      {
        key: "_retention",
        what: { key: "lifecycle.whatif.retentionRow", params: { days: PRIVATE_REQUESTS_DAYS_AFTER_CLOSEOUT } },
        kindLabelKey: "whatif.kinds.affected",
        noteKey: "lifecycle.whatif.retentionNote",
      },
      ...(open > 0
        ? [{ key: "_open", what: { key: "lifecycle.whatif.openItemsRow", params: { count: open } }, kindLabelKey: "whatif.kinds.affected", noteKey: "lifecycle.whatif.openItemsNote" } satisfies DeltaRow]
        : []),
      ...(await collectImpacts(ctx, occasion.id, { kind: "close" })),
    ];
    return { title: { key: "lifecycle.whatif.closeTitle", params: { title: occasion.title } }, delta };
  },
  apply: async (tx, preview) => {
    const occasionId = preview.occasionId ?? "";
    const claimed = await tx.db
      .update(occasions)
      .set({ status: "closed", closedAt: tx.now })
      .where(and(eq(occasions.id, occasionId), eq(occasions.status, preview.input.expectedStatus)))
      .returning({ id: occasions.id });
    if (claimed.length === 0) throw new AppError("CONFLICT", "whatif.errors.stale");
    await applyImpacts(tx, occasionId, { kind: "close" });
    await audit(tx, {
      action: "occasion.closed",
      objectType: "occasion",
      objectId: occasionId,
      before: { status: preview.input.expectedStatus },
      after: { status: "closed", closedAt: tx.now },
    });
  },
});

/** Preview of closing the occasion ("Închide ocazia"). Owner or project manager, freshly confirmed. */
export async function proposeClose(ctx: Ctx, input: { occasionId: string }): Promise<WhatIfPreview> {
  requireWriteCapable(ctx);
  const occasionId = idSchema.parse(input.occasionId);
  await authorize(ctx, occasionId, "create");
  const occasion = await loadOccasion(ctx, occasionId);
  if (occasion.status === "closed") throw new AppError("CONFLICT", "lifecycle.errors.already.closed");
  return createPreview(ctx, {
    kind: CLOSE_KIND,
    occasionId,
    subjectType: "occasion",
    subjectId: occasionId,
    input: { expectedStatus: occasion.status },
  });
}

/* ── Closeout list ──────────────────────────────────────────────────────── */

export type CloseoutSection = { key: string; titleKey: string; items: CloseoutItem[] };
export type Closeout = {
  occasionId: string;
  status: OccasionStatus;
  closedAt: Date | null;
  /** Sections with nothing open are included with items: [] so the page can say "nothing left". */
  sections: CloseoutSection[];
  openItems: number;
};

async function collectCloseout(ctx: Ctx, occasionId: string): Promise<CloseoutSection[]> {
  const out: CloseoutSection[] = [];
  for (const provider of closeoutSectionProviders()) {
    try {
      out.push({ key: provider.key, titleKey: provider.titleKey, items: await provider.collect(ctx, occasionId) });
    } catch (e) {
      // a section the viewer has no grant for is simply not listed
      if (!isAppError(e)) throw e;
    }
  }
  return out;
}

/**
 * What is still open at the end of the occasion, from every registered closeout section
 * (unpaid expenses, unsettled shared costs; suppliers add returns, deposits and balances).
 * Members only; each section gates its own money (a member without the finance grant gets
 * those sections empty).
 */
export async function getCloseout(ctx: Ctx, occasionId: string): Promise<Closeout> {
  const id = idSchema.parse(occasionId);
  await requireMember(ctx, id);
  const occasion = await loadOccasion(ctx, id);
  const sections = await collectCloseout(ctx, id);
  return {
    occasionId: id,
    status: occasion.status,
    closedAt: occasion.closedAt,
    sections,
    openItems: sections.reduce((n, s) => n + s.items.length, 0),
  };
}

/**
 * Closed occasions whose closeout is at least `days` old — the start of the INF6 retention
 * clock. System only. For the private-requests rule (30 days) of the agent that owns that
 * table:  for (const id of await getClosedOccasionsOlderThan(ctx, 30)) …delete its requests…
 */
export async function getClosedOccasionsOlderThan(ctx: Ctx, days: number): Promise<string[]> {
  requireSystem(ctx);
  const rows = await ctx.db
    .select({ id: occasions.id })
    .from(occasions)
    .where(and(eq(occasions.status, "closed"), isNotNull(occasions.closedAt), lt(occasions.closedAt, addDays(ctx.now, -days))))
    .limit(5000);
  return rows.map((r) => r.id);
}

/* ── Lessons learned (kept on the ACCOUNT) ──────────────────────────────── */

export type Lesson = typeof lessons.$inferSelect;

const lessonInput = z.object({
  occasionId: idSchema,
  body: z.string().trim().max(4000, "common.validation.tooLong"),
});

/**
 * Saves the actor's own lessons from this occasion (one note per person per occasion; saving
 * again replaces it, an empty note removes it). Any member; allowed after the occasion is
 * closed, because the note belongs to the account, not to the occasion.
 */
export async function saveLesson(ctx: Ctx, input: z.input<typeof lessonInput>): Promise<Lesson | null> {
  requireWriteCapable(ctx);
  const data = lessonInput.parse(input);
  const accountId = requireAccount(ctx);
  await requireMember(ctx, data.occasionId);
  const occasion = await loadOccasion(ctx, data.occasionId);
  if (data.body === "") {
    await ctx.db.delete(lessons).where(and(eq(lessons.accountId, accountId), eq(lessons.occasionId, occasion.id)));
    return null;
  }
  const [row] = await ctx.db
    .insert(lessons)
    .values({
      accountId,
      occasionId: occasion.id,
      occasionKind: occasion.kind,
      occasionTitle: occasion.title,
      body: data.body,
      createdAt: ctx.now,
    })
    .onConflictDoUpdate({
      target: [lessons.accountId, lessons.occasionId],
      set: { body: data.body, occasionKind: occasion.kind, occasionTitle: occasion.title, updatedAt: ctx.now },
    })
    .returning();
  return row!;
}

/** The actor's own note for one occasion, or null. */
export async function getLesson(ctx: Ctx, occasionId: string): Promise<Lesson | null> {
  const accountId = requireAccount(ctx);
  const [row] = await ctx.db
    .select()
    .from(lessons)
    .where(and(eq(lessons.accountId, accountId), eq(lessons.occasionId, idSchema.parse(occasionId))));
  return row ?? null;
}

/**
 * The actor's own lessons from past occasions, newest first — to offer when they plan the
 * next one. With `kind`, lessons from the same kind of occasion come first.
 */
export async function listLessons(ctx: Ctx, kind?: OccasionKind, opts: { exceptOccasionId?: string } = {}): Promise<Lesson[]> {
  const accountId = requireAccount(ctx);
  const rows = await ctx.db
    .select()
    .from(lessons)
    .where(and(eq(lessons.accountId, accountId), opts.exceptOccasionId ? ne(lessons.occasionId, opts.exceptOccasionId) : undefined))
    .orderBy(desc(lessons.updatedAt))
    .limit(50);
  if (!kind) return rows;
  return [...rows.filter((r) => r.occasionKind === kind), ...rows.filter((r) => r.occasionKind !== kind)];
}

/* ── Telling the guests (job, once per household) ───────────────────────── */

const notifyPayload = z.object({
  occasionId: idSchema,
  change: z.enum(["cancelled", "postponed"]),
  previewId: idSchema,
});

type LifecycleEmailParams = { occasionTitle: string; change: "cancelled" | "postponed"; date: string | null; householdName: string };

registerTemplate<LifecycleEmailParams>("lifecycle.changed", (p, { t }) => ({
  subject: t(`lifecycle.email.${p.change}.subject`, { occasion: p.occasionTitle }),
  blocks: [
    { kind: "text", text: t("lifecycle.email.greeting", { household: p.householdName }) },
    {
      kind: "text",
      text:
        p.change === "postponed" && p.date
          ? t("lifecycle.email.postponed.body", { occasion: p.occasionTitle, date: p.date })
          : t(`lifecycle.email.${p.change}.bodyNoDate`, { occasion: p.occasionTitle }),
    },
    { kind: "note", text: t("lifecycle.email.where") },
    { kind: "note", text: t("lifecycle.email.why") },
  ],
}));

/**
 * Emails every household lead who gave an address — each at most once per applied change
 * (an idempotency key per household survives job retries). Stops quietly at the occasion's
 * daily email cap (Q6); households without an email see the change on their invitation page.
 */
export async function notifyGuestsOfChange(ctx: Ctx, input: z.input<typeof notifyPayload>): Promise<{ sent: number; skipped: number }> {
  requireSystem(ctx);
  const data = notifyPayload.parse(input);
  const [occasion] = await ctx.db.select().from(occasions).where(eq(occasions.id, data.occasionId));
  if (!occasion) return { sent: 0, skipped: 0 };
  const rows = await ctx.db
    .select({ id: households.id, name: households.name, email: households.leadEmail, language: households.language })
    .from(households)
    .where(and(eq(households.occasionId, occasion.id), isNotNull(households.leadEmail)))
    .limit(5000);
  let sent = 0;
  let skipped = 0;
  for (const h of rows) {
    try {
      const outcome = await withIdempotency(ctx, "lifecycle.notify", `${data.previewId}:${h.id}`, async (tx) => {
        const res = await sendEmail(tx, {
          to: h.email!,
          template: "lifecycle.changed",
          params: {
            occasionTitle: occasion.title,
            change: data.change,
            date: occasion.startsAt ? formatDay(occasion.startsAt, occasion.timezone) : null,
            householdName: h.name,
          } satisfies LifecycleEmailParams,
          locale: h.language,
          occasionId: occasion.id,
        });
        return res.status;
      });
      if (outcome === "sent") sent++;
      else skipped++;
    } catch (e) {
      if (isAppError(e) && e.code === "LIMIT") {
        skipped += 1;
        break; // daily cap reached: the invitation page still shows the change
      }
      throw e;
    }
  }
  return { sent, skipped };
}

function notifyJob() {
  return defineJob(NOTIFY_GUESTS_JOB, notifyPayload, async (ctx, payload) => {
    await notifyGuestsOfChange(ctx, payload);
  });
}

/* ── Built-in impact providers: tasks and guests (money ones live with their domain) ── */

function register(): void {
  notifyJob();

  registerLifecycleImpact({
    key: "tasks",
    collect: async (ctx, occasionId, change) => {
      // postponing already lists every task that shifts (the moveDate rows)
      if (change.kind === "postpone") return [];
      const [row] = await ctx.db
        .select({ n: sql<number>`count(*)::int` })
        .from(tasks)
        .where(and(eq(tasks.occasionId, occasionId), ne(tasks.status, "done")));
      const open = row?.n ?? 0;
      if (open === 0) return [];
      return [
        {
          key: "open",
          what: { key: "lifecycle.impact.tasksOpen", params: { count: open } },
          kindLabelKey: "lifecycle.impact.tasksLabel",
          noteKey: change.kind === "cancel" ? "lifecycle.impact.tasksCancelNote" : "lifecycle.impact.tasksCloseNote",
        },
      ];
    },
  });

  registerLifecycleImpact({
    key: "guests",
    collect: async (ctx, occasionId, change) => {
      if (change.kind === "close") return [];
      // counts only — never names (D2)
      const [row] = await ctx.db
        .select({
          households: sql<number>`count(*)::int`,
          people: sql<number>`coalesce(sum(${rsvpResponses.adultsCount} + ${rsvpResponses.childrenCount}), 0)::int`,
        })
        .from(rsvpResponses)
        .where(and(eq(rsvpResponses.occasionId, occasionId), eq(rsvpResponses.attending, "yes")));
      if (!row || row.households === 0) return [];
      return [
        {
          key: "yes",
          what: { key: "lifecycle.impact.guestsYes", params: { people: row.people, households: row.households } },
          kindLabelKey: "lifecycle.impact.guestsLabel",
          noteKey: change.kind === "cancel" ? "lifecycle.impact.guestsCancelNote" : "lifecycle.impact.guestsPostponeNote",
        },
      ];
    },
  });

  // "Lecții de la ocaziile trecute": the member's own notes from earlier occasions, shown on
  // the overview while this one is still being planned. Their own data only.
  registerOverviewSection({
    key: "lessons",
    forMember: async (ctx, _member, occasionId) => {
      const [occasion] = await ctx.db.select({ kind: occasions.kind, status: occasions.status }).from(occasions).where(eq(occasions.id, occasionId));
      if (!occasion || occasion.status !== "planning") return null;
      const past = (await listLessons(ctx, occasion.kind, { exceptOccasionId: occasionId })).slice(0, 3);
      if (past.length === 0) return null;
      return {
        titleKey: "lifecycle.lessons.overviewTitle",
        lines: past.map((l) => `${l.occasionTitle}: ${l.body.length > 240 ? `${l.body.slice(0, 237)}…` : l.body}`),
      };
    },
  });
}
register();


export function registerJobs(): void {
  register();
}
