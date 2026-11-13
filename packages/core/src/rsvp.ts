import {
  and,
  asc,
  eq,
  households,
  inArray,
  isNull,
  notInArray,
  occasionGuestSettings,
  occasions,
  rsvpAnswers,
  rsvpQuestions,
  rsvpResponses,
  sql,
  type RsvpAttending,
  type RsvpQuestionKind,
  type RsvpQuestionOption,
} from "@ed/db";
import { AppError } from "@ed/shared/errors";
import { newId } from "@ed/shared/ids";
import { zEmail, zText } from "@ed/shared/zod";
import { z } from "zod";
import { requireMember } from "./access";
import { audit } from "./audit";
import { adjustPlaces, readCapacity, type CapacityState } from "./capacity";
import type { Ctx } from "./context";
import { assertNoChildDetails, HOUSEHOLD_RSVP_CLAIM } from "./guests";
import {
  bumpGuestRevision,
  requireGuest,
  syncDeadlineExpiry,
  toGuestQuestion,
  type GuestQuestion,
} from "./invitations";
import { inTx } from "./tx";

// RSVP (A6, A8, Q4, INF5, invariant 9).
//
// A household answers once and may change its answer until the deadline. The answer holds
// COUNTS only: adults and children are two integers — there is no row, name or age for any
// child, here or anywhere. A "yes" holds adults + children places in the shared capacity
// (@ed/core/capacity, claim key "rsvp:<householdId>"); "maybe" and "no" hold none.
//
// submitRsvp is idempotent by construction: one response row per household (unique), one
// capacity claim per household (locked while it changes). A double tap, a retry or two phones
// of the same household sending together end in exactly one answer and one claim.

const idSchema = z.string().min(1).max(64);
export const RSVP_MAX_PARTY = 30;

/* ── Settings and questions (planner) ────────────────────────────────────── */

export type RsvpSettings = { occasionId: string; rsvpDeadline: Date | null; questions: RsvpQuestionView[] };
export type RsvpQuestionView = GuestQuestion & { position: number; rawOptions: RsvpQuestionOption[] };

async function loadQuestions(ctx: Ctx, occasionId: string): Promise<Array<typeof rsvpQuestions.$inferSelect>> {
  return ctx.db
    .select()
    .from(rsvpQuestions)
    .where(and(eq(rsvpQuestions.occasionId, occasionId), isNull(rsvpQuestions.archivedAt)))
    .orderBy(asc(rsvpQuestions.position), asc(rsvpQuestions.createdAt));
}

export async function getRsvpSettings(ctx: Ctx, occasionId: string): Promise<RsvpSettings> {
  await requireMember(ctx, occasionId, { roles: ["owner", "pm", "workstream_lead", "contributor"] });
  const [settings] = await ctx.db
    .select()
    .from(occasionGuestSettings)
    .where(eq(occasionGuestSettings.occasionId, occasionId));
  const questions = await loadQuestions(ctx, occasionId);
  return {
    occasionId,
    rsvpDeadline: settings?.rsvpDeadline ?? null,
    questions: questions.map((q) => ({ ...toGuestQuestion(q), position: q.position, rawOptions: q.options })),
  };
}

const deadlineInput = z.object({
  occasionId: idSchema,
  /** null / "" = no deadline */
  rsvpDeadline: z.preprocess((v) => (v === "" || v === undefined ? null : v), z.coerce.date().nullable()),
});

export async function setRsvpDeadline(ctx: Ctx, input: z.input<typeof deadlineInput>): Promise<void> {
  const data = deadlineInput.parse(input);
  await requireMember(ctx, data.occasionId, { manage: true });
  await inTx(ctx, async (tx) => {
    const [before] = await tx.db
      .select()
      .from(occasionGuestSettings)
      .where(eq(occasionGuestSettings.occasionId, data.occasionId));
    await tx.db
      .insert(occasionGuestSettings)
      .values({ occasionId: data.occasionId, rsvpDeadline: data.rsvpDeadline })
      .onConflictDoUpdate({
        target: occasionGuestSettings.occasionId,
        set: { rsvpDeadline: data.rsvpDeadline },
      });
    await syncDeadlineExpiry(tx, data.occasionId, data.rsvpDeadline);
    await audit(tx, {
      action: "rsvp.deadline_set",
      objectType: "occasion",
      objectId: data.occasionId,
      before: { rsvpDeadline: before?.rsvpDeadline ?? null },
      after: { rsvpDeadline: data.rsvpDeadline },
    });
    if ((before?.rsvpDeadline?.getTime() ?? null) !== (data.rsvpDeadline?.getTime() ?? null)) {
      await bumpGuestRevision(tx, data.occasionId, "rsvp.changes.deadline");
    }
  });
}

const optionLines = z.preprocess(
  (v) =>
    typeof v === "string"
      ? v
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean)
      : (v ?? []),
  z.array(zText(120)).max(12),
);

const questionInput = z.object({
  occasionId: idSchema,
  questionId: z.preprocess((v) => (v === "" ? undefined : v), idSchema.optional()),
  kind: z.enum(["menu_choice", "allergies", "accommodation", "transport", "free_text", "single_choice"]),
  textRo: zText(200),
  /** Falls back to the Romanian text when left empty. */
  textEn: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), zText(200).optional()),
  /** One option per line; the English list pairs with the Romanian one by line. */
  optionsRo: optionLines.optional(),
  optionsEn: optionLines.optional(),
  required: z.preprocess((v) => v === true || v === "on" || v === "true" || v === "1", z.boolean()).optional(),
});
export type SaveQuestionInput = z.input<typeof questionInput>;

const CHOICE_KINDS: RsvpQuestionKind[] = ["menu_choice", "single_choice"];
const TEXT_KINDS: RsvpQuestionKind[] = ["allergies", "free_text"];

/** Adds or edits a custom RSVP question (owner / PM). */
export async function saveRsvpQuestion(ctx: Ctx, input: SaveQuestionInput): Promise<{ questionId: string }> {
  const data = questionInput.parse(input);
  await requireMember(ctx, data.occasionId, { manage: true });
  const ro = TEXT_KINDS.includes(data.kind) ? [] : (data.optionsRo ?? []);
  const en = data.optionsEn ?? [];
  if (CHOICE_KINDS.includes(data.kind) && ro.length < 2) {
    throw new AppError("VALIDATION", "rsvp.errors.needTwoOptions", {
      fieldErrors: { optionsRo: ["rsvp.errors.needTwoOptions"] },
    });
  }
  return inTx(ctx, async (tx) => {
    let existing: typeof rsvpQuestions.$inferSelect | undefined;
    if (data.questionId) {
      [existing] = await tx.db
        .select()
        .from(rsvpQuestions)
        .where(and(eq(rsvpQuestions.id, data.questionId), eq(rsvpQuestions.occasionId, data.occasionId)));
      if (!existing) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
    }
    // keep option ids stable when the wording at the same line is unchanged, so answers stay linked
    const options: RsvpQuestionOption[] = ro.map((text, i) => {
      const prev = existing?.options.find((o) => o.ro === text) ?? existing?.options[i];
      return { id: prev && prev.ro === text ? prev.id : newId(), ro: text, en: en[i] ?? text };
    });
    const values = {
      kind: data.kind,
      textRo: data.textRo,
      textEn: data.textEn ?? data.textRo,
      options,
      required: data.required ?? false,
    };
    let questionId: string;
    if (existing) {
      await tx.db.update(rsvpQuestions).set(values).where(eq(rsvpQuestions.id, existing.id));
      questionId = existing.id;
    } else {
      const [{ next } = { next: 0 }] = await tx.db
        .select({ next: sql<number>`COALESCE(MAX(${rsvpQuestions.position}), -1) + 1` })
        .from(rsvpQuestions)
        .where(eq(rsvpQuestions.occasionId, data.occasionId));
      const [row] = await tx.db
        .insert(rsvpQuestions)
        .values({ occasionId: data.occasionId, position: Number(next), ...values })
        .returning({ id: rsvpQuestions.id });
      questionId = row!.id;
    }
    await audit(tx, {
      action: existing ? "rsvp.question_updated" : "rsvp.question_added",
      objectType: "rsvp_question",
      objectId: questionId,
      after: { kind: data.kind, textRo: data.textRo },
    });
    await bumpGuestRevision(tx, data.occasionId, "rsvp.changes.questions");
    return { questionId };
  });
}

/** Archives a question: it leaves the guest link; answers already given stay readable. */
export async function removeRsvpQuestion(ctx: Ctx, input: { questionId: string }): Promise<void> {
  const id = idSchema.parse(input.questionId);
  const [q] = await ctx.db.select().from(rsvpQuestions).where(eq(rsvpQuestions.id, id));
  if (!q) return;
  await requireMember(ctx, q.occasionId, { manage: true });
  if (q.archivedAt) return;
  await inTx(ctx, async (tx) => {
    await tx.db.update(rsvpQuestions).set({ archivedAt: ctx.now }).where(eq(rsvpQuestions.id, id));
    await audit(tx, { action: "rsvp.question_removed", objectType: "rsvp_question", objectId: id });
  });
}

/** Moves a question one step up or down (the tap-equivalent of dragging). */
export async function moveRsvpQuestion(
  ctx: Ctx,
  input: { questionId: string; direction: "up" | "down" },
): Promise<void> {
  const data = z.object({ questionId: idSchema, direction: z.enum(["up", "down"]) }).parse(input);
  const [q] = await ctx.db.select().from(rsvpQuestions).where(eq(rsvpQuestions.id, data.questionId));
  if (!q) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  await requireMember(ctx, q.occasionId, { manage: true });
  await inTx(ctx, async (tx) => {
    const list = await loadQuestions(tx, q.occasionId);
    const i = list.findIndex((x) => x.id === q.id);
    const j = data.direction === "up" ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j]!, list[i]!];
    for (const [position, row] of list.entries()) {
      if (row.position !== position) {
        await tx.db.update(rsvpQuestions).set({ position }).where(eq(rsvpQuestions.id, row.id));
      }
    }
  });
}

/* ── Answering ───────────────────────────────────────────────────────────── */

const zCount = z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? 0 : typeof v === "string" ? Number(v) : v),
  z.number().int("common.validation.invalid").min(0, "common.validation.tooSmall").max(RSVP_MAX_PARTY, "common.validation.tooBig"),
);

const answerInput = z.object({
  attending: z.enum(["yes", "no", "maybe"], "rsvp.errors.chooseAttending"),
  adultsCount: zCount,
  /** Invariant 9: a number, nothing else. */
  childrenCount: zCount,
  /** questionId -> option id (choice questions) or typed text */
  answers: z.record(z.string().min(1).max(64), z.string().max(1000)).default({}),
  /** Optional address for change notices (INF5). Empty keeps what is on file. */
  email: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), zEmail.optional()),
  /** true once the guest has been shown the child-details warning */
  childDetailsAcknowledged: z.boolean().optional(),
});
export type RsvpAnswerInput = z.input<typeof answerInput>;

export type RsvpResult = {
  householdId: string;
  attending: RsvpAttending;
  adultsCount: number;
  childrenCount: number;
  /** false when this call changed nothing (a repeat of the same answer) */
  changed: boolean;
};

/** Field name the web form uses for a question's answer (also the fieldErrors key). */
export const questionField = (questionId: string): string => `q_${questionId}`;

async function applyRsvp(
  ctx: Ctx,
  target: { occasionId: string; householdId: string },
  data: z.output<typeof answerInput>,
  opts: { enforceRequired: boolean },
): Promise<RsvpResult> {
  const questions = (await loadQuestions(ctx, target.occasionId)).map(toGuestQuestion);
  const yes = data.attending === "yes";
  const no = data.attending === "no";
  const adults = no ? 0 : data.adultsCount;
  const children = no ? 0 : data.childrenCount;
  const fieldErrors: Record<string, string[]> = {};
  if (yes && adults < 1) fieldErrors.adultsCount = ["rsvp.errors.atLeastOneAdult"];

  // keep only answers to live questions, in the right shape
  const clean: Array<{ questionId: string; optionId: string | null; valueText: string | null }> = [];
  const texts: Record<string, string> = {};
  for (const q of questions) {
    const raw = (data.answers[q.id] ?? "").trim();
    if (!raw) {
      if (q.required && !no && opts.enforceRequired) fieldErrors[questionField(q.id)] = ["rsvp.errors.answerRequired"];
      continue;
    }
    if (q.answerType === "choice") {
      if (!q.options.some((o) => o.id === raw)) {
        fieldErrors[questionField(q.id)] = ["rsvp.errors.chooseOption"];
        continue;
      }
      clean.push({ questionId: q.id, optionId: raw, valueText: null });
    } else {
      clean.push({ questionId: q.id, optionId: null, valueText: raw });
      texts[questionField(q.id)] = raw;
    }
  }
  if (Object.keys(fieldErrors).length > 0) {
    throw new AppError("VALIDATION", "common.errors.VALIDATION", { fieldErrors });
  }
  // invariant 9: free text must not carry a child's details — warn before saving
  assertNoChildDetails(texts, data.childDetailsAcknowledged ?? false);

  return inTx(ctx, async (tx) => {
    // 1. places first: takes the household's claim lock, so same-household calls run in turn,
    //    and throws TAKEN (nothing saved) when the last place went to someone else.
    const claim = await adjustPlaces(tx, target.occasionId, {
      key: HOUSEHOLD_RSVP_CLAIM(target.householdId),
      places: yes ? adults + children : 0,
    });

    // 2. the one response row of the household
    const [before] = await tx.db
      .select()
      .from(rsvpResponses)
      .where(eq(rsvpResponses.householdId, target.householdId));
    const sameCounts =
      !!before &&
      before.attending === data.attending &&
      before.adultsCount === adults &&
      before.childrenCount === children;
    if (!sameCounts) {
      await tx.db
        .insert(rsvpResponses)
        .values({
          occasionId: target.occasionId,
          householdId: target.householdId,
          attending: data.attending,
          adultsCount: adults,
          childrenCount: children,
          answeredAt: ctx.now,
        })
        .onConflictDoUpdate({
          target: rsvpResponses.householdId,
          set: { attending: data.attending, adultsCount: adults, childrenCount: children, answeredAt: ctx.now },
        });
    }

    // 3. answers: upsert the given ones, drop the ones no longer given
    const previous = await tx.db.select().from(rsvpAnswers).where(eq(rsvpAnswers.householdId, target.householdId));
    let answersChanged = false;
    for (const a of clean) {
      const prev = previous.find((p) => p.questionId === a.questionId);
      if (prev && prev.optionId === a.optionId && prev.valueText === a.valueText) continue;
      answersChanged = true;
      await tx.db
        .insert(rsvpAnswers)
        .values({ occasionId: target.occasionId, householdId: target.householdId, ...a })
        .onConflictDoUpdate({
          target: [rsvpAnswers.householdId, rsvpAnswers.questionId],
          set: { optionId: a.optionId, valueText: a.valueText },
        });
    }
    const liveIds = questions.map((q) => q.id);
    const keptIds = clean.map((a) => a.questionId);
    const stale = previous.filter((p) => liveIds.includes(p.questionId) && !keptIds.includes(p.questionId));
    if (stale.length > 0) {
      answersChanged = true;
      await tx.db
        .delete(rsvpAnswers)
        .where(
          and(
            eq(rsvpAnswers.householdId, target.householdId),
            inArray(
              rsvpAnswers.questionId,
              stale.map((s) => s.questionId),
            ),
            keptIds.length ? notInArray(rsvpAnswers.questionId, keptIds) : sql`true`,
          ),
        );
    }

    // 4. the lead's address for change notices (INF5)
    let emailChanged = false;
    if (data.email) {
      const res = await tx.db
        .update(households)
        .set({ leadEmail: data.email })
        .where(and(eq(households.id, target.householdId), sql`${households.leadEmail} IS DISTINCT FROM ${data.email}`))
        .returning({ id: households.id });
      emailChanged = res.length > 0;
    }

    const changed = !sameCounts || answersChanged || emailChanged || claim.changed;
    if (changed) {
      await audit(tx, {
        action: before ? "rsvp.changed" : "rsvp.answered",
        objectType: "household",
        objectId: target.householdId,
        before: before
          ? { attending: before.attending, adults: before.adultsCount, children: before.childrenCount }
          : undefined,
        after: { attending: data.attending, adults, children },
      });
    }
    return {
      householdId: target.householdId,
      attending: data.attending,
      adultsCount: adults,
      childrenCount: children,
      changed,
    };
  });
}

/**
 * The household behind the guest link answers (or changes its answer, until the deadline).
 * Call checkPublicForm() with the request ctx BEFORE this (SEC11) — the web action does.
 * Errors: CONFLICT rsvp.errors.closed (deadline passed / occasion cancelled),
 * TAKEN rsvp.errors.lastPlaceTaken (details.params.left), VALIDATION with fieldErrors
 * (incl. the child-details warning, `details.childDetails = true`).
 */
export async function submitRsvp(ctx: Ctx, input: RsvpAnswerInput): Promise<RsvpResult> {
  const actor = requireGuest(ctx);
  const data = answerInput.parse(input);
  const [row] = await ctx.db
    .select({ status: occasions.status, deadline: occasionGuestSettings.rsvpDeadline })
    .from(occasions)
    .leftJoin(occasionGuestSettings, eq(occasionGuestSettings.occasionId, occasions.id))
    .where(eq(occasions.id, actor.occasionId));
  if (!row) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  if (
    row.status === "cancelled" ||
    row.status === "closed" ||
    (row.deadline && row.deadline.getTime() <= ctx.now.getTime())
  ) {
    throw new AppError("CONFLICT", "rsvp.errors.closed");
  }
  return applyRsvp(ctx, { occasionId: actor.occasionId, householdId: actor.householdId }, data, {
    enforceRequired: true,
  });
}

const recordInput = answerInput.extend({ householdId: idSchema });

/** A manager records an answer received by phone or in person. Same rules, no deadline. */
export async function recordRsvp(ctx: Ctx, input: z.input<typeof recordInput>): Promise<RsvpResult> {
  const data = recordInput.parse(input);
  const [h] = await ctx.db.select().from(households).where(eq(households.id, data.householdId));
  if (!h) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  await requireMember(ctx, h.occasionId, { manage: true });
  return applyRsvp(ctx, { occasionId: h.occasionId, householdId: h.id }, data, { enforceRequired: false });
}

/* ── Counts ──────────────────────────────────────────────────────────────── */

export type RsvpSummary = {
  occasionId: string;
  households: { total: number; yes: number; maybe: number; no: number; pending: number };
  /** People confirmed (answer "yes"). */
  attending: { adults: number; children: number; total: number };
  /** People of households that answered "maybe". */
  maybe: { adults: number; children: number; total: number };
  /** Sum of expected party sizes; households without one count their named adults. null = nothing known. */
  invited: number | null;
  capacity: CapacityState;
  rsvpDeadline: Date | null;
};

/**
 * RSVP counts for the planner page, exports and the MCP tool `get_rsvp_summary`.
 * Counts only — no names, no contacts — for any member who may read the guest list.
 */
export async function getRsvpSummary(ctx: Ctx, occasionId: string): Promise<RsvpSummary> {
  await requireMember(ctx, occasionId, { roles: ["owner", "pm", "workstream_lead", "contributor"] });
  const [[agg], [settings], capacity] = await Promise.all([
    ctx.db.execute<{
      total: string;
      yes: string;
      maybe: string;
      no: string;
      yes_adults: string;
      yes_children: string;
      maybe_adults: string;
      maybe_children: string;
      invited: string | null;
    }>(sql`
      SELECT
        COUNT(*)                                                         AS total,
        COUNT(*) FILTER (WHERE r.attending = 'yes')                      AS yes,
        COUNT(*) FILTER (WHERE r.attending = 'maybe')                    AS maybe,
        COUNT(*) FILTER (WHERE r.attending = 'no')                       AS no,
        COALESCE(SUM(r.adults_count)   FILTER (WHERE r.attending = 'yes'), 0)   AS yes_adults,
        COALESCE(SUM(r.children_count) FILTER (WHERE r.attending = 'yes'), 0)   AS yes_children,
        COALESCE(SUM(r.adults_count)   FILTER (WHERE r.attending = 'maybe'), 0) AS maybe_adults,
        COALESCE(SUM(r.children_count) FILTER (WHERE r.attending = 'maybe'), 0) AS maybe_children,
        SUM(COALESCE(h.expected_party_size, NULLIF((SELECT COUNT(*) FROM guests g WHERE g.household_id = h.id), 0))) AS invited
      FROM households h
      LEFT JOIN rsvp_responses r ON r.household_id = h.id
      WHERE h.occasion_id = ${occasionId}
    `).then((res) => res.rows),
    ctx.db.select().from(occasionGuestSettings).where(eq(occasionGuestSettings.occasionId, occasionId)),
    readCapacity(ctx, occasionId),
  ]);
  const n = (v: string | null | undefined) => Number(v ?? 0);
  const total = n(agg?.total);
  const yes = n(agg?.yes);
  const maybe = n(agg?.maybe);
  const no = n(agg?.no);
  return {
    occasionId,
    households: { total, yes, maybe, no, pending: total - yes - maybe - no },
    attending: {
      adults: n(agg?.yes_adults),
      children: n(agg?.yes_children),
      total: n(agg?.yes_adults) + n(agg?.yes_children),
    },
    maybe: {
      adults: n(agg?.maybe_adults),
      children: n(agg?.maybe_children),
      total: n(agg?.maybe_adults) + n(agg?.maybe_children),
    },
    invited: agg?.invited === null || agg?.invited === undefined ? null : Number(agg.invited),
    capacity,
    rsvpDeadline: settings?.rsvpDeadline ?? null,
  };
}
