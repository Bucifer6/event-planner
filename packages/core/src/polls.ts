import {
  and,
  asc,
  datePollOptions,
  datePolls,
  datePollVotes,
  eq,
  inArray,
  occasions,
  type PollStatus,
  type PollVote,
} from "@ed/db";
import { AppError } from "@ed/shared/errors";
import { zonedDateKey, zonedToUtc } from "@ed/shared/time";
import { z } from "zod";
import { requireMember } from "./access";
import { audit } from "./audit";
import type { Ctx } from "./context";
import { bumpGuestRevision, registerGuestSection, requireGuest } from "./invitations";
import { proposeMoveDate } from "./occasions";
import { inTx } from "./tx";
import type { WhatIfPreview } from "./whatif";

// Date polls (A7): the planner proposes candidate days, each household votes Da / Poate / Nu
// per day on its guest link, the host confirms one.
//
// Votes NEVER reserve places: nothing in this file touches @ed/core/capacity.
// Confirming a day does not change the occasion silently either — it opens the planning
// core's "occasion.moveDate" What-if preview (which lists every task that would shift); the
// date is set when the host applies that preview.

const idSchema = z.string().min(1).max(64);
const zDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "common.validation.invalid");
export const POLL_MAX_OPTIONS = 12;

export type PollOptionTally = {
  id: string;
  /** "2026-06-14" in the occasion's time zone */
  day: string;
  startsAt: Date;
  yes: number;
  maybe: number;
  no: number;
};

export type PollView = {
  id: string;
  occasionId: string;
  status: PollStatus;
  /** the day the host picked (its move-date preview may still be waiting) */
  chosenOptionId: string | null;
  options: PollOptionTally[];
  /** households that voted on at least one day */
  householdsVoted: number;
  /** most "yes", ties broken by fewer "no", then the earlier day; null without votes */
  leaderOptionId: string | null;
};

function dayToInstant(day: string, tz: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  const probe = new Date(Date.UTC(y!, m! - 1, d!));
  if (probe.getUTCMonth() !== m! - 1 || probe.getUTCDate() !== d!) {
    throw new AppError("VALIDATION", "common.validation.invalid", {
      fieldErrors: { dates: ["common.validation.invalid"] },
    });
  }
  return zonedToUtc({ year: y!, month: m!, day: d! }, tz);
}

async function occasionOf(ctx: Ctx, occasionId: string) {
  const [o] = await ctx.db.select().from(occasions).where(eq(occasions.id, occasionId));
  if (!o) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  return o;
}

async function buildView(
  ctx: Ctx,
  poll: typeof datePolls.$inferSelect,
  occasion: { startsAt: Date | null; timezone: string; dateMode: string },
): Promise<PollView> {
  const [options, votes] = await Promise.all([
    ctx.db
      .select()
      .from(datePollOptions)
      .where(eq(datePollOptions.pollId, poll.id))
      .orderBy(asc(datePollOptions.startsAt)),
    ctx.db.select().from(datePollVotes).where(eq(datePollVotes.pollId, poll.id)),
  ]);
  const tally = options.map((o) => {
    const mine = votes.filter((v) => v.optionId === o.id);
    return {
      id: o.id,
      day: zonedDateKey(o.startsAt, occasion.timezone),
      startsAt: o.startsAt,
      yes: mine.filter((v) => v.vote === "yes").length,
      maybe: mine.filter((v) => v.vote === "maybe").length,
      no: mine.filter((v) => v.vote === "no").length,
    };
  });
  const leader =
    votes.length === 0
      ? null
      : ([...tally].sort(
          (a, b) => b.yes - a.yes || a.no - b.no || b.maybe - a.maybe || a.startsAt.getTime() - b.startsAt.getTime(),
        )[0]?.id ?? null);
  // "confirmed" = the occasion now really is on the chosen day (the What-if was applied)
  const chosen = tally.find((o) => o.id === poll.confirmedOptionId);
  const applied =
    !!chosen &&
    occasion.dateMode !== "poll" &&
    !!occasion.startsAt &&
    zonedDateKey(occasion.startsAt, occasion.timezone) === chosen.day;
  return {
    id: poll.id,
    occasionId: poll.occasionId,
    status: poll.status === "closed" ? "closed" : applied ? "confirmed" : "open",
    chosenOptionId: poll.confirmedOptionId,
    options: tally,
    householdsVoted: new Set(votes.map((v) => v.householdId)).size,
    leaderOptionId: leader,
  };
}

async function currentPoll(ctx: Ctx, occasionId: string) {
  const rows = await ctx.db
    .select()
    .from(datePolls)
    .where(eq(datePolls.occasionId, occasionId))
    .orderBy(asc(datePolls.createdAt));
  return rows.findLast((p) => p.status !== "closed") ?? rows.at(-1) ?? null;
}

/** The occasion's poll with its tally (members who may read the guest list). */
export async function getPoll(ctx: Ctx, occasionId: string): Promise<PollView | null> {
  await requireMember(ctx, occasionId, { roles: ["owner", "pm", "workstream_lead", "contributor"] });
  const occasion = await occasionOf(ctx, occasionId);
  const poll = await currentPoll(ctx, occasionId);
  if (!poll) return null;
  const view = await buildView(ctx, poll, occasion);
  if (view.status === "confirmed" && poll.status !== "confirmed") {
    // first read after the host applied the date: remember it and tell the guests (INF5)
    await inTx(ctx, async (tx) => {
      const done = await tx.db
        .update(datePolls)
        .set({ status: "confirmed" })
        .where(and(eq(datePolls.id, poll.id), eq(datePolls.status, "open")))
        .returning({ id: datePolls.id });
      if (done.length > 0) await bumpGuestRevision(tx, occasionId, "rsvp.changes.date");
    });
  }
  return view;
}

const datesInput = z.object({
  occasionId: idSchema,
  /** "YYYY-MM-DD" days: an array, or one per line / comma separated */
  dates: z.preprocess(
    (v) =>
      typeof v === "string"
        ? v
            .split(/[\s,;]+/)
            .map((s) => s.trim())
            .filter(Boolean)
        : v,
    z.array(zDay).min(1, "polls.errors.needDate").max(POLL_MAX_OPTIONS, "polls.errors.tooManyDates"),
  ),
});

/** Adds candidate days (creating the poll when there is none). Owner / PM. Idempotent per day. */
export async function addPollDates(ctx: Ctx, input: z.input<typeof datesInput>): Promise<{ pollId: string }> {
  const data = datesInput.parse(input);
  await requireMember(ctx, data.occasionId, { manage: true });
  const occasion = await occasionOf(ctx, data.occasionId);
  const instants = [...new Set(data.dates)].map((d) => dayToInstant(d, occasion.timezone));
  return inTx(ctx, async (tx) => {
    let poll = await currentPoll(tx, data.occasionId);
    if (!poll || poll.status === "closed") {
      const [made] = await tx.db.insert(datePolls).values({ occasionId: data.occasionId }).returning();
      poll = made!;
      await audit(tx, { action: "poll.created", objectType: "date_poll", objectId: poll!.id });
    }
    const existing = await tx.db.select().from(datePollOptions).where(eq(datePollOptions.pollId, poll!.id));
    const fresh = instants.filter((i) => !existing.some((e) => e.startsAt.getTime() === i.getTime()));
    if (existing.length + fresh.length > POLL_MAX_OPTIONS) {
      throw new AppError("VALIDATION", "polls.errors.tooManyDates", {
        fieldErrors: { dates: ["polls.errors.tooManyDates"] },
      });
    }
    if (fresh.length > 0) {
      await tx.db
        .insert(datePollOptions)
        .values(fresh.map((startsAt) => ({ pollId: poll!.id, occasionId: data.occasionId, startsAt })))
        .onConflictDoNothing();
      await bumpGuestRevision(tx, data.occasionId, "rsvp.changes.poll");
    }
    return { pollId: poll!.id };
  });
}

/** Removes a candidate day together with its votes. */
export async function removePollDate(ctx: Ctx, input: { optionId: string }): Promise<void> {
  const id = idSchema.parse(input.optionId);
  const [opt] = await ctx.db.select().from(datePollOptions).where(eq(datePollOptions.id, id));
  if (!opt) return;
  await requireMember(ctx, opt.occasionId, { manage: true });
  await inTx(ctx, async (tx) => {
    await tx.db.delete(datePollOptions).where(eq(datePollOptions.id, id));
    await tx.db
      .update(datePolls)
      .set({ confirmedOptionId: null })
      .where(and(eq(datePolls.id, opt.pollId), eq(datePolls.confirmedOptionId, id)));
    await audit(tx, { action: "poll.date_removed", objectType: "date_poll", objectId: opt.pollId });
  });
}

/** Stops the voting without choosing a day. */
export async function closePoll(ctx: Ctx, input: { pollId: string }): Promise<void> {
  const id = idSchema.parse(input.pollId);
  const [poll] = await ctx.db.select().from(datePolls).where(eq(datePolls.id, id));
  if (!poll) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  await requireMember(ctx, poll.occasionId, { manage: true });
  if (poll.status === "closed") return;
  await inTx(ctx, async (tx) => {
    await tx.db.update(datePolls).set({ status: "closed" }).where(eq(datePolls.id, id));
    await audit(tx, { action: "poll.closed", objectType: "date_poll", objectId: id });
  });
}

/**
 * The host picks a day. Nothing changes yet: this returns the "occasion.moveDate" What-if
 * preview (tasks that shift with the date); the occasion gets the date when the host applies
 * it. Votes stay as they are and never held any place.
 */
export async function confirmPollDate(
  ctx: Ctx,
  input: { pollId: string; optionId: string },
): Promise<WhatIfPreview> {
  const data = z.object({ pollId: idSchema, optionId: idSchema }).parse(input);
  const [poll] = await ctx.db.select().from(datePolls).where(eq(datePolls.id, data.pollId));
  if (!poll) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  await requireMember(ctx, poll.occasionId, { manage: true });
  if (poll.status === "closed") throw new AppError("CONFLICT", "polls.errors.closed");
  const [opt] = await ctx.db
    .select()
    .from(datePollOptions)
    .where(and(eq(datePollOptions.id, data.optionId), eq(datePollOptions.pollId, poll.id)));
  if (!opt) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  const occasion = await occasionOf(ctx, poll.occasionId);
  const preview = await proposeMoveDate(ctx, {
    occasionId: poll.occasionId,
    dateMode: "date",
    startsOn: zonedDateKey(opt.startsAt, occasion.timezone),
  });
  await inTx(ctx, async (tx) => {
    await tx.db.update(datePolls).set({ confirmedOptionId: opt.id }).where(eq(datePolls.id, poll.id));
    await audit(tx, {
      action: "poll.date_chosen",
      objectType: "date_poll",
      objectId: poll.id,
      after: { optionId: opt.id, previewId: preview.id },
    });
  });
  return preview;
}

/* ── Guest side ──────────────────────────────────────────────────────────── */

export type GuestPoll = {
  pollId: string;
  options: Array<{ id: string; startsAt: Date; day: string; vote: PollVote | null }>;
};

async function guestPoll(ctx: Ctx): Promise<GuestPoll | null> {
  const actor = requireGuest(ctx);
  const occasion = await occasionOf(ctx, actor.occasionId);
  const poll = await currentPoll(ctx, actor.occasionId);
  if (!poll || poll.status !== "open") return null;
  const view = await buildView(ctx, poll, occasion);
  if (view.status !== "open" || view.options.length === 0) return null;
  const mine = await ctx.db
    .select()
    .from(datePollVotes)
    .where(and(eq(datePollVotes.pollId, poll.id), eq(datePollVotes.householdId, actor.householdId)));
  return {
    pollId: poll.id,
    // only this household's own votes — never the tally or anyone else's (SEC2)
    options: view.options.map((o) => ({
      id: o.id,
      startsAt: o.startsAt,
      day: o.day,
      vote: mine.find((v) => v.optionId === o.id)?.vote ?? null,
    })),
  };
}

registerGuestSection<GuestPoll>({ key: "polls", order: 20, load: (ctx) => guestPoll(ctx) });

const voteInput = z.object({
  pollId: idSchema,
  votes: z.record(idSchema, z.enum(["yes", "maybe", "no"])),
});

/**
 * The household votes Da / Poate / Nu per day (re-voting replaces its earlier vote).
 * A vote is an opinion about a day: it holds no place and changes no count but the tally.
 */
export async function castPollVotes(ctx: Ctx, input: z.input<typeof voteInput>): Promise<{ saved: number }> {
  const actor = requireGuest(ctx);
  const data = voteInput.parse(input);
  const [poll] = await ctx.db
    .select()
    .from(datePolls)
    .where(and(eq(datePolls.id, data.pollId), eq(datePolls.occasionId, actor.occasionId)));
  if (!poll) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  if (poll.status !== "open") throw new AppError("CONFLICT", "polls.errors.closed");
  const occasion = await occasionOf(ctx, poll.occasionId);
  if ((await buildView(ctx, poll, occasion)).status !== "open") {
    throw new AppError("CONFLICT", "polls.errors.closed");
  }
  const ids = Object.keys(data.votes);
  if (ids.length === 0) return { saved: 0 };
  const options = await ctx.db
    .select({ id: datePollOptions.id })
    .from(datePollOptions)
    .where(and(eq(datePollOptions.pollId, poll.id), inArray(datePollOptions.id, ids)));
  return inTx(ctx, async (tx) => {
    for (const o of options) {
      const vote = data.votes[o.id]!;
      await tx.db
        .insert(datePollVotes)
        .values({ pollId: poll.id, optionId: o.id, householdId: actor.householdId, vote })
        .onConflictDoUpdate({
          target: [datePollVotes.optionId, datePollVotes.householdId],
          set: { vote },
        });
    }
    return { saved: options.length };
  });
}
