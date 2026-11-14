import {
  and,
  asc,
  bookings,
  desc,
  eq,
  households,
  inArray,
  invitations,
  isNotNull,
  isNull,
  lte,
  occasions,
  programmeChanges,
  programmeCueVersions,
  programmeItems,
  programmeState,
  PROGRAMME_KINDS,
  rsvpResponses,
  sql,
  suppliers,
  type BriefingContent,
  type ProgrammeChangeKind,
  type ProgrammeCue,
  type ProgrammeKind,
} from "@ed/db";
import { registerTemplate, sendEmail } from "@ed/email";
import { translate } from "@ed/i18n/load";
import { defineJob } from "@ed/jobs";
import { AppError, isAppError } from "@ed/shared/errors";
import { addMinutes, zonedParts, zonedToUtc } from "@ed/shared/time";
import { z } from "zod";
import { requireMember, type Member } from "./access";
import { audit } from "./audit";
import { listBriefingVersions, publishBriefing } from "./briefings";
import { actorAccountId, requireSystem, type Ctx } from "./context";
import { registerExport, toCsv } from "./exports";
import { withIdempotency } from "./idempotency";
import { bumpGuestRevision, registerGuestSection, requireGuest } from "./invitations";
import { assertOccasionWritable } from "./lifecycle";
import { onOccasionPurge } from "./occasions";
import { inTx } from "./tx";

// Entertainment programme, cue lists and performer briefings (C-03); guests are told ONCE per
// change about the moments that concern them (C-10, INF5).
//
// - Times are wall times relative to the occasion day (see the schema): `dayOffset` +
//   `startMinute`. Instants are derived from the occasion's date and zone on every read, so a
//   moved date moves the programme, and a party past midnight is `dayOffset = 1`.
// - The cue list is versioned per item: saveCueList() inserts version n+1 and never touches an
//   older one. There is no update path for a version.
// - programmeRevision (programme_state.revision) goes up by one for every change a guest can
//   see: a guest-visible moment appears, disappears, or changes its title, time, length, place
//   or audience. Planner notes, cues and the performer are not guest-visible and change nothing.
// - Each such change leaves a programme_changes row naming whom it concerns. The
//   "programme.notify" job (delayed a few minutes so a burst of edits becomes ONE message)
//   emails the household leads who gave an email — once per household and revision — and
//   every guest link marks the changed moments until the household has opened it (INF5).
// - Performer briefings reuse the supplier briefing mechanism (publishBriefing + the
//   supplier's acknowledgement on the link, B4). There is no second acknowledgement system.

export { PROGRAMME_KINDS };
export type { ProgrammeCue, ProgrammeKind };
export type ProgrammeItem = typeof programmeItems.$inferSelect;

const READ_ROLES = ["owner", "pm", "workstream_lead", "contributor"] as const;
/** A burst of edits within this window becomes one notification. */
export const PROGRAMME_NOTIFY_DELAY_MIN = 5;
export const PROGRAMME_MAX_ITEMS = 200;
export const PROGRAMME_MAX_CUES = 60;
export const PROGRAMME_NOTIFY_JOB = "programme.notify";
/** Reason shown on the guest link's "changed since your last visit" notice. */
export const PROGRAMME_CHANGE_REASON = "programme.guest.changedNotice";

const idSchema = z.string().min(1).max(64);
const optionalText = (max: number) =>
  z
    .string()
    .max(max, "common.validation.tooLong")
    .nullish()
    .transform((v) => (v && v.trim() !== "" ? v.trim() : null));
const formBool = z.preprocess((v) => (v === "on" || v === "true" || v === "1" ? true : v === "" || v === "false" || v === "0" || v == null ? false : v), z.boolean()).default(false);

/** "18:30" / "9.05" → minutes after midnight. */
export function parseClock(value: string): number | null {
  const m = /^\s*([01]?\d|2[0-3])[:.]([0-5]\d)\s*$/.exec(value);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export function formatClock(minute: number): string {
  const m = ((minute % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** The instant of a wall time on the occasion day (+ offset days) in the occasion's zone. */
export function programmeInstant(occasionStartsAt: Date | null, timezone: string, dayOffset: number, startMinute: number): Date | null {
  if (!occasionStartsAt) return null;
  const p = zonedParts(occasionStartsAt, timezone);
  const day = new Date(Date.UTC(p.year, p.month - 1, p.day + dayOffset));
  return zonedToUtc(
    { year: day.getUTCFullYear(), month: day.getUTCMonth() + 1, day: day.getUTCDate(), hour: Math.floor(startMinute / 60), minute: startMinute % 60 },
    timezone,
  );
}

async function readAccess(ctx: Ctx, occasionId: string): Promise<Member> {
  return requireMember(ctx, occasionId, { roles: [...READ_ROLES] });
}

async function writeAccess(ctx: Ctx, occasionId: string): Promise<Member> {
  const member = await requireMember(ctx, occasionId, { manage: true });
  if (ctx.actor.kind === "mcp") throw new AppError("FORBIDDEN", "common.errors.FORBIDDEN"); // MCP proposes, never writes
  await assertOccasionWritable(ctx, occasionId);
  return member;
}

/* ── Reading ─────────────────────────────────────────────────────────────── */

export type ProgrammeItemView = {
  id: string;
  title: string;
  kind: ProgrammeKind;
  dayOffset: number;
  startMinute: number;
  /** "18:30" — wall time in the occasion's zone. */
  time: string;
  /** null while the occasion has no date. */
  startsAt: Date | null;
  endsAt: Date | null;
  /** null = unknown. */
  durationMin: number | null;
  place: string | null;
  visibleToGuests: boolean;
  concernsAll: boolean;
  concernsHouseholdIds: string[];
  supplierId: string | null;
  performerName: string | null;
  notes: string | null;
  cueVersion: number;
  /** The latest cue list ([] when none). */
  cues: ProgrammeCue[];
};

export type ProgrammeView = {
  occasion: { id: string; title: string; startsAt: Date | null; timezone: string };
  items: ProgrammeItemView[];
  revision: number;
  canManage: boolean;
};

type OccasionFacts = { id: string; title: string; startsAt: Date | null; timezone: string; status: string; locale: "ro" | "en" };

async function occasionFacts(ctx: Pick<Ctx, "db">, occasionId: string): Promise<OccasionFacts> {
  const [o] = await ctx.db
    .select({ id: occasions.id, title: occasions.title, startsAt: occasions.startsAt, timezone: occasions.timezone, status: occasions.status, locale: occasions.locale })
    .from(occasions)
    .where(eq(occasions.id, occasionId));
  if (!o) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  return o;
}

async function readItems(ctx: Pick<Ctx, "db">, occasion: OccasionFacts, opts: { withCues?: boolean } = {}): Promise<ProgrammeItemView[]> {
  const rows = await ctx.db
    .select({ item: programmeItems, performerName: suppliers.name })
    .from(programmeItems)
    .leftJoin(suppliers, eq(suppliers.id, programmeItems.supplierId))
    .where(eq(programmeItems.occasionId, occasion.id))
    .orderBy(asc(programmeItems.dayOffset), asc(programmeItems.startMinute), asc(programmeItems.createdAt), asc(programmeItems.id));
  const cueRows =
    opts.withCues && rows.some((r) => r.item.cueVersion > 0)
      ? await ctx.db.select().from(programmeCueVersions).where(eq(programmeCueVersions.occasionId, occasion.id))
      : [];
  return rows.map(({ item, performerName }) => {
    const startsAt = programmeInstant(occasion.startsAt, occasion.timezone, item.dayOffset, item.startMinute);
    return {
      id: item.id,
      title: item.title,
      kind: item.kind,
      dayOffset: item.dayOffset,
      startMinute: item.startMinute,
      time: formatClock(item.startMinute),
      startsAt,
      endsAt: startsAt && item.durationMin !== null ? addMinutes(startsAt, item.durationMin) : null,
      durationMin: item.durationMin,
      place: item.place,
      visibleToGuests: item.visibleToGuests,
      concernsAll: item.concernsAll,
      concernsHouseholdIds: item.concernsHouseholdIds,
      supplierId: item.supplierId,
      performerName,
      notes: item.notes,
      cueVersion: item.cueVersion,
      cues: cueRows.find((c) => c.itemId === item.id && c.version === item.cueVersion)?.cues ?? [],
    };
  });
}

async function readRevision(ctx: Pick<Ctx, "db">, occasionId: string): Promise<number> {
  const [s] = await ctx.db.select({ revision: programmeState.revision }).from(programmeState).where(eq(programmeState.occasionId, occasionId));
  return s?.revision ?? 0;
}

/** The whole programme for the planning team, in time order, each item with its latest cues. */
export async function listProgramme(ctx: Ctx, occasionId: string): Promise<ProgrammeView> {
  const member = await readAccess(ctx, occasionId);
  const occasion = await occasionFacts(ctx, occasionId);
  const [items, revision] = await Promise.all([readItems(ctx, occasion, { withCues: true }), readRevision(ctx, occasionId)]);
  return {
    occasion: { id: occasion.id, title: occasion.title, startsAt: occasion.startsAt, timezone: occasion.timezone },
    items,
    revision,
    canManage: member.role === "owner" || member.role === "pm",
  };
}

/**
 * MOUNT POINT for the event-day view (@ed/core/eventday, B-08): the programme as timed items
 * of the day, with performer and latest cues. Same access as the planning pages. Items have
 * `startsAt` instants once the occasion has a date; before that only `time`.
 */
export async function listProgrammeForDay(ctx: Ctx, occasionId: string): Promise<ProgrammeItemView[]> {
  return (await listProgramme(ctx, occasionId)).items;
}

/** programmeRevision — how many guest-visible changes the programme has had. */
export async function getProgrammeRevision(ctx: Ctx, occasionId: string): Promise<number> {
  await readAccess(ctx, occasionId);
  return readRevision(ctx, occasionId);
}

export type GuestProgrammeItem = {
  id: string;
  title: string;
  kind: ProgrammeKind;
  dayOffset: number;
  time: string;
  /** ISO instant or null (JSON-safe for the guest section). */
  startsAt: string | null;
  durationMin: number | null;
  place: string | null;
  /** INF5: changed since this household last opened its link. */
  changed: boolean;
};

function toGuestItem(i: ProgrammeItemView, changed: boolean): GuestProgrammeItem {
  return {
    id: i.id,
    title: i.title,
    kind: i.kind,
    dayOffset: i.dayOffset,
    time: i.time,
    startsAt: i.startsAt ? i.startsAt.toISOString() : null,
    durationMin: i.durationMin,
    place: i.place,
    changed,
  };
}

/**
 * INTERNAL (no access check): the moments EVERY guest may see — visible and concerning all.
 * Used by the public event page after it decided the page is published and shows the programme.
 */
export async function readPublicProgramme(ctx: Pick<Ctx, "db">, occasionId: string): Promise<GuestProgrammeItem[]> {
  const occasion = await occasionFacts(ctx, occasionId);
  const items = await readItems(ctx, occasion);
  return items.filter((i) => i.visibleToGuests && i.concernsAll).map((i) => toGuestItem(i, false));
}

export type GuestProgramme = { items: GuestProgrammeItem[]; timezone: string; removed: string[] };

/**
 * The programme on a guest link: guest-visible moments that concern this household, with the
 * ones changed since its last visit marked. Notes, cues and performers never leave the team.
 */
export async function getGuestProgramme(ctx: Ctx): Promise<GuestProgramme | null> {
  const actor = requireGuest(ctx);
  const occasion = await occasionFacts(ctx, actor.occasionId);
  const all = await readItems(ctx, occasion);
  const mine = all.filter((i) => i.visibleToGuests && (i.concernsAll || i.concernsHouseholdIds.includes(actor.householdId)));
  const [inv] = await ctx.db.select({ lastViewedAt: invitations.lastViewedAt }).from(invitations).where(eq(invitations.id, actor.invitationId));
  // a first visit has nothing to compare with: nothing is "changed"
  const since = inv?.lastViewedAt ?? null;
  const changes = since
    ? (await ctx.db.select().from(programmeChanges).where(eq(programmeChanges.occasionId, actor.occasionId))).filter(
        (c) => c.createdAt.getTime() > since.getTime() && (c.concernsAll || c.householdIds.includes(actor.householdId)),
      )
    : [];
  const changedIds = new Set(changes.filter((c) => c.kind !== "removed").map((c) => c.itemId));
  const removed = [...new Set(changes.filter((c) => c.kind === "removed" && !mine.some((i) => i.id === c.itemId)).map((c) => c.itemTitle))];
  if (mine.length === 0 && removed.length === 0) return null;
  return { items: mine.map((i) => toGuestItem(i, changedIds.has(i.id))), timezone: occasion.timezone, removed };
}

/* ── Writing ─────────────────────────────────────────────────────────────── */

const itemInput = z.object({
  occasionId: idSchema,
  itemId: z.preprocess((v) => (v === "" ? undefined : v), idSchema.optional()).optional(),
  title: z.string().trim().min(1, "common.validation.required").max(160, "common.validation.tooLong"),
  kind: z.enum(PROGRAMME_KINDS, "common.validation.invalid").default("moment"),
  /** "HH:MM" wall time in the occasion's zone. */
  time: z.string().max(8).refine((v) => parseClock(v) !== null, "programme.errors.time"),
  /** true = after midnight (the day after the occasion day). */
  nextDay: formBool.default(false),
  durationMin: z.preprocess(
    (v) => (v === "" || v == null ? null : typeof v === "string" ? Number(v) : v),
    z.number("programme.errors.duration").int("programme.errors.duration").min(1, "programme.errors.duration").max(1440, "programme.errors.duration").nullable(),
  ).default(null),
  place: optionalText(160),
  visibleToGuests: formBool.default(false),
  /** "all" or "some" (with householdIds). */
  concerns: z.enum(["all", "some"]).default("all"),
  householdIds: z.preprocess((v) => (v == null || v === "" ? [] : Array.isArray(v) ? v : [v]), z.array(idSchema).max(2000)).default([]),
  supplierId: z.preprocess((v) => (v === "" ? null : v), idSchema.nullish()).default(null),
  notes: optionalText(2000),
});
export type ProgrammeItemInput = z.input<typeof itemInput>;

type Audience = { visible: boolean; concernsAll: boolean; householdIds: string[] };
const GUEST_FIELDS = ["title", "dayOffset", "startMinute", "durationMin", "place"] as const;

/** What a save means for guests: nothing, or one change and whom it concerns. */
function guestChange(before: ProgrammeItem | null, after: ProgrammeItem | null): { kind: ProgrammeChangeKind; concernsAll: boolean; householdIds: string[]; title: string; itemId: string } | null {
  const b: Audience | null = before ? { visible: before.visibleToGuests, concernsAll: before.concernsAll, householdIds: before.concernsHouseholdIds } : null;
  const a: Audience | null = after ? { visible: after.visibleToGuests, concernsAll: after.concernsAll, householdIds: after.concernsHouseholdIds } : null;
  const wasVisible = !!b?.visible;
  const isVisible = !!a?.visible;
  if (!wasVisible && !isVisible) return null;
  let kind: ProgrammeChangeKind;
  if (!wasVisible) kind = "added";
  else if (!isVisible) kind = "removed";
  else {
    const audienceChanged = b!.concernsAll !== a!.concernsAll || [...b!.householdIds].sort().join() !== [...a!.householdIds].sort().join();
    const fieldChanged = GUEST_FIELDS.some((f) => before![f] !== after![f]);
    if (!audienceChanged && !fieldChanged) return null;
    kind = "changed";
  }
  const sides = [wasVisible ? b! : null, isVisible ? a! : null].filter((s): s is Audience => s !== null);
  return {
    kind,
    concernsAll: sides.some((s) => s.concernsAll),
    householdIds: [...new Set(sides.flatMap((s) => (s.concernsAll ? [] : s.householdIds)))],
    title: (after ?? before)!.title,
    itemId: (after ?? before)!.id,
  };
}

/** Bumps programmeRevision, records the change and schedules the one notification round. */
async function recordGuestChange(tx: Ctx, occasionId: string, change: NonNullable<ReturnType<typeof guestChange>>): Promise<number> {
  const [state] = await tx.db
    .insert(programmeState)
    .values({ occasionId, revision: 1, revisionAt: tx.now })
    .onConflictDoUpdate({ target: programmeState.occasionId, set: { revision: sql`${programmeState.revision} + 1`, revisionAt: tx.now } })
    .returning({ revision: programmeState.revision });
  const revision = state!.revision;
  await tx.db.insert(programmeChanges).values({
    occasionId,
    revision,
    kind: change.kind,
    itemId: change.itemId,
    itemTitle: change.title,
    concernsAll: change.concernsAll,
    householdIds: change.householdIds,
    createdAt: tx.now,
  });
  // the link-wide "changed since your last visit" notice only when everyone is concerned;
  // a change for some households is marked on THEIR programme section alone
  if (change.concernsAll) await bumpGuestRevision(tx, occasionId, PROGRAMME_CHANGE_REASON);
  await notifyJob().enqueue(tx, { occasionId, revision }, { runAt: addMinutes(tx.now, PROGRAMME_NOTIFY_DELAY_MIN), uniqueKey: `${PROGRAMME_NOTIFY_JOB}:${occasionId}:${revision}` });
  return revision;
}

async function loadItem(ctx: Ctx, itemId: string): Promise<ProgrammeItem> {
  const id = idSchema.safeParse(itemId);
  if (!id.success) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  const [item] = await ctx.db.select().from(programmeItems).where(eq(programmeItems.id, id.data));
  if (!item) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  return item;
}

/** Adds or edits a moment (owner / PM). Returns the programmeRevision after the save. */
export async function saveProgrammeItem(ctx: Ctx, input: ProgrammeItemInput): Promise<{ itemId: string; revision: number; guestsNotified: boolean }> {
  const data = itemInput.parse(input);
  await writeAccess(ctx, data.occasionId);
  const householdIds = data.concerns === "some" ? [...new Set(data.householdIds)] : [];
  if (data.concerns === "some" && householdIds.length === 0) {
    throw new AppError("VALIDATION", "programme.errors.chooseHouseholds", { fieldErrors: { householdIds: ["programme.errors.chooseHouseholds"] } });
  }
  if (householdIds.length > 0) {
    const found = await ctx.db.select({ id: households.id }).from(households).where(and(eq(households.occasionId, data.occasionId), inArray(households.id, householdIds)));
    if (found.length !== householdIds.length) throw new AppError("VALIDATION", "common.validation.invalid", { fieldErrors: { householdIds: ["common.validation.invalid"] } });
  }
  if (data.supplierId) {
    const [s] = await ctx.db.select({ id: suppliers.id }).from(suppliers).where(and(eq(suppliers.id, data.supplierId), eq(suppliers.occasionId, data.occasionId)));
    if (!s) throw new AppError("VALIDATION", "common.validation.invalid", { fieldErrors: { supplierId: ["common.validation.invalid"] } });
  }
  const values = {
    title: data.title,
    kind: data.kind,
    dayOffset: data.nextDay ? 1 : 0,
    startMinute: parseClock(data.time)!,
    durationMin: data.durationMin,
    place: data.place,
    visibleToGuests: data.visibleToGuests,
    concernsAll: data.concerns === "all",
    concernsHouseholdIds: householdIds,
    supplierId: data.supplierId ?? null,
    notes: data.notes,
  };
  return inTx(ctx, async (tx) => {
    let before: ProgrammeItem | null = null;
    let after: ProgrammeItem;
    if (data.itemId) {
      const [locked] = await tx.db.select().from(programmeItems).where(and(eq(programmeItems.id, data.itemId), eq(programmeItems.occasionId, data.occasionId))).for("update");
      if (!locked) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
      before = locked;
      [after] = (await tx.db.update(programmeItems).set(values).where(eq(programmeItems.id, locked.id)).returning()) as [ProgrammeItem];
    } else {
      const [count] = await tx.db.select({ n: sql<number>`count(*)::int` }).from(programmeItems).where(eq(programmeItems.occasionId, data.occasionId));
      if ((count?.n ?? 0) >= PROGRAMME_MAX_ITEMS) throw new AppError("LIMIT", "programme.errors.tooMany");
      [after] = (await tx.db.insert(programmeItems).values({ occasionId: data.occasionId, ...values }).returning()) as [ProgrammeItem];
    }
    const change = guestChange(before, after);
    const revision = change ? await recordGuestChange(tx, data.occasionId, change) : await readRevision(tx, data.occasionId);
    await audit(tx, {
      action: before ? "programme.item_updated" : "programme.item_created",
      objectType: "programme_item",
      objectId: after.id,
      before: before ? { title: before.title, dayOffset: before.dayOffset, startMinute: before.startMinute, place: before.place, visibleToGuests: before.visibleToGuests } : undefined,
      after: { title: after.title, dayOffset: after.dayOffset, startMinute: after.startMinute, place: after.place, visibleToGuests: after.visibleToGuests },
      meta: { occasionId: data.occasionId, revision },
    });
    return { itemId: after.id, revision, guestsNotified: !!change };
  });
}

/** The one-tap "vizibil invitaților" switch. */
export async function setProgrammeVisibility(ctx: Ctx, input: { itemId: string; visible: boolean }): Promise<{ revision: number }> {
  const data = z.object({ itemId: idSchema, visible: formBool }).parse(input);
  const item = await loadItem(ctx, data.itemId);
  await writeAccess(ctx, item.occasionId);
  return inTx(ctx, async (tx) => {
    const [before] = await tx.db.select().from(programmeItems).where(eq(programmeItems.id, item.id)).for("update");
    if (!before) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
    if (before.visibleToGuests === data.visible) return { revision: await readRevision(tx, item.occasionId) };
    const [after] = await tx.db.update(programmeItems).set({ visibleToGuests: data.visible }).where(eq(programmeItems.id, item.id)).returning();
    const change = guestChange(before, after!);
    const revision = change ? await recordGuestChange(tx, item.occasionId, change) : await readRevision(tx, item.occasionId);
    await audit(tx, { action: "programme.visibility_set", objectType: "programme_item", objectId: item.id, before: { visible: before.visibleToGuests }, after: { visible: data.visible }, meta: { occasionId: item.occasionId, revision } });
    return { revision };
  });
}

export async function removeProgrammeItem(ctx: Ctx, input: { itemId: string }): Promise<{ revision: number }> {
  const item = await loadItem(ctx, input.itemId);
  await writeAccess(ctx, item.occasionId);
  return inTx(ctx, async (tx) => {
    const [gone] = await tx.db.delete(programmeItems).where(eq(programmeItems.id, item.id)).returning();
    if (!gone) return { revision: await readRevision(tx, item.occasionId) };
    const change = guestChange(gone, null);
    const revision = change ? await recordGuestChange(tx, item.occasionId, change) : await readRevision(tx, item.occasionId);
    await audit(tx, { action: "programme.item_removed", objectType: "programme_item", objectId: item.id, before: { title: gone.title }, meta: { occasionId: item.occasionId, revision } });
    return { revision };
  });
}

/* ── Cue lists (versioned) ───────────────────────────────────────────────── */

const cueSchema = z.object({
  offsetMin: z.preprocess((v) => (typeof v === "string" && v.trim() !== "" ? Number(v) : v === "" || v == null ? 0 : v), z.number("programme.errors.cueOffset").int("programme.errors.cueOffset").min(-240, "programme.errors.cueOffset").max(1440, "programme.errors.cueOffset")),
  instruction: z.string().trim().min(1, "programme.errors.cueInstruction").max(500, "common.validation.tooLong"),
  who: optionalText(120),
});
const cueListInput = z.object({ itemId: idSchema, cues: z.array(cueSchema).max(PROGRAMME_MAX_CUES, "programme.errors.tooManyCues") });

export type CueVersionView = { id: string; version: number; cues: ProgrammeCue[]; createdAt: Date };

/**
 * Saves the cue list of a moment as a NEW version (ordered by offset, then as typed). Saving
 * a list identical to the latest version changes nothing. Older versions stay readable.
 */
export async function saveCueList(ctx: Ctx, input: z.input<typeof cueListInput>): Promise<{ version: number; changed: boolean }> {
  const parsed = cueListInput.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const key = first?.message.includes(".") ? first.message : "common.errors.VALIDATION";
    const row = typeof first?.path[1] === "number" ? first.path[1] : null;
    throw new AppError("VALIDATION", key, { fieldErrors: { [row === null ? "cues" : `cue_${row}_${String(first?.path[2] ?? "instruction")}`]: [key] } });
  }
  const data = parsed.data;
  const item = await loadItem(ctx, data.itemId);
  await writeAccess(ctx, item.occasionId);
  const cues: ProgrammeCue[] = data.cues.map((c, i) => ({ c, i })).sort((a, b) => a.c.offsetMin - b.c.offsetMin || a.i - b.i).map(({ c }) => ({ offsetMin: c.offsetMin, instruction: c.instruction, who: c.who }));
  return inTx(ctx, async (tx) => {
    const [locked] = await tx.db.select().from(programmeItems).where(eq(programmeItems.id, item.id)).for("update");
    if (!locked) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
    const [latest] = await tx.db.select().from(programmeCueVersions).where(eq(programmeCueVersions.itemId, item.id)).orderBy(desc(programmeCueVersions.version)).limit(1);
    // jsonb does not keep key order: compare field by field
    const canon = (list: ProgrammeCue[]) => JSON.stringify(list.map((c) => [c.offsetMin, c.instruction, c.who ?? null]));
    if ((latest && canon(latest.cues) === canon(cues)) || (!latest && cues.length === 0)) {
      return { version: latest?.version ?? 0, changed: false };
    }
    const version = (latest?.version ?? 0) + 1;
    const [row] = await tx.db
      .insert(programmeCueVersions)
      .values({ itemId: item.id, occasionId: item.occasionId, version, cues, createdByAccountId: actorAccountId(tx.actor), createdAt: tx.now })
      .returning({ id: programmeCueVersions.id });
    await tx.db.update(programmeItems).set({ cueVersion: version }).where(eq(programmeItems.id, item.id));
    await audit(tx, { action: "programme.cues_saved", objectType: "programme_cue_version", objectId: row!.id, after: { version, cues: cues.length }, meta: { occasionId: item.occasionId, itemId: item.id } });
    return { version, changed: true };
  });
}

/** Every version of a moment's cue list, newest first. */
export async function listCueVersions(ctx: Ctx, itemId: string): Promise<CueVersionView[]> {
  const item = await loadItem(ctx, itemId);
  await readAccess(ctx, item.occasionId);
  const rows = await ctx.db.select().from(programmeCueVersions).where(eq(programmeCueVersions.itemId, item.id)).orderBy(desc(programmeCueVersions.version));
  return rows.map((r) => ({ id: r.id, version: r.version, cues: r.cues, createdAt: r.createdAt }));
}

/** All cue versions of the occasion grouped by item (one query for the planner page). */
export async function listAllCueVersions(ctx: Ctx, occasionId: string): Promise<Record<string, CueVersionView[]>> {
  await readAccess(ctx, occasionId);
  const rows = await ctx.db.select().from(programmeCueVersions).where(eq(programmeCueVersions.occasionId, occasionId)).orderBy(desc(programmeCueVersions.version));
  const out: Record<string, CueVersionView[]> = {};
  for (const r of rows) (out[r.itemId] ??= []).push({ id: r.id, version: r.version, cues: r.cues, createdAt: r.createdAt });
  return out;
}

/* ── Performer briefing: the programme goes into the supplier briefing (B4) ─────────── */

const BLOCK_START = { ro: "— Program —", en: "— Programme —" } as const;
const BLOCK_END = { ro: "— Sfârșitul programului —", en: "— End of programme —" } as const;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Removes an earlier programme block (either language) from a briefing's free text. */
export function stripProgrammeBlock(freeText: string): string {
  let out = freeText;
  for (const l of ["ro", "en"] as const) {
    out = out.replace(new RegExp(`\\n*${escapeRe(BLOCK_START[l])}[\\s\\S]*?${escapeRe(BLOCK_END[l])}\\n*`, "g"), "\n\n");
  }
  return out.trim();
}

/** The performer's moments and cues as plain text, in the occasion's language. */
export function composeProgrammeBlock(items: ProgrammeItemView[], locale: "ro" | "en"): string {
  const t = (key: string, params?: Record<string, string | number>) => translate(locale, `programme.briefing.${key}`, params);
  const lines: string[] = [BLOCK_START[locale]];
  for (const i of items) {
    const head = [`${i.dayOffset > 0 ? `${t("nextDay")} ` : ""}${i.time}`, i.title];
    if (i.place) head.push(i.place);
    if (i.durationMin !== null) head.push(t("minutes", { n: i.durationMin }));
    lines.push(head.join(" · "));
    for (const c of i.cues) {
      const at = c.offsetMin === 0 ? t("atStart") : c.offsetMin > 0 ? t("after", { n: c.offsetMin }) : t("before", { n: -c.offsetMin });
      lines.push(`   ${at}: ${c.instruction}${c.who ? ` (${c.who})` : ""}`);
    }
  }
  lines.push(BLOCK_END[locale]);
  return lines.join("\n");
}

/**
 * "Include programul în briefing": publishes the NEXT version of the performer's supplier
 * briefing with their moments and latest cues (replacing an earlier programme block, keeping
 * everything else the planner wrote). The supplier acknowledges it on their link like any
 * briefing version. CONFLICT `programme.errors.briefingUpToDate` when nothing changed.
 */
export async function includeProgrammeInBriefing(ctx: Ctx, input: { occasionId: string; supplierId: string }): Promise<{ bookingId: string; version: number; moments: number }> {
  const data = z.object({ occasionId: idSchema, supplierId: idSchema }).parse(input);
  await writeAccess(ctx, data.occasionId);
  const occasion = await occasionFacts(ctx, data.occasionId);
  const [booking] = await ctx.db
    .select({ id: bookings.id })
    .from(bookings)
    .innerJoin(suppliers, eq(suppliers.id, bookings.supplierId))
    .where(and(eq(bookings.supplierId, data.supplierId), eq(suppliers.occasionId, data.occasionId)));
  if (!booking) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  const items = (await readItems(ctx, occasion, { withCues: true })).filter((i) => i.supplierId === data.supplierId);
  if (items.length === 0) throw new AppError("VALIDATION", "programme.errors.noPerformerItems");
  const latest = (await listBriefingVersions(ctx, booking.id))[0]?.content ?? null;
  const base: BriefingContent = latest ?? { what: "", when: "", where: "", contacts: "", specialNotes: "", freeText: "" };
  const kept = stripProgrammeBlock(base.freeText);
  const freeText = [kept, composeProgrammeBlock(items, occasion.locale)].filter((s) => s !== "").join("\n\n");
  try {
    const res = await publishBriefing(ctx, { bookingId: booking.id, ...base, freeText });
    return { bookingId: booking.id, version: res.version, moments: items.length };
  } catch (e) {
    if (isAppError(e) && e.code === "CONFLICT" && e.messageKey === "briefing.errors.unchanged") {
      throw new AppError("CONFLICT", "programme.errors.briefingUpToDate");
    }
    throw e;
  }
}

/* ── C-10 / INF5: guests are told once per change ────────────────────────── */

const notifyPayload = z.object({ occasionId: idSchema, revision: z.number().int().min(1) });

type ProgrammeEmailParams = { occasionTitle: string; householdName: string; moments: string[]; removed: string[] };

registerTemplate<ProgrammeEmailParams>("programme.changed", (p, { t }) => ({
  subject: t("programme.email.subject", { occasion: p.occasionTitle }),
  blocks: [
    { kind: "text", text: t("programme.email.greeting", { household: p.householdName }) },
    { kind: "text", text: t("programme.email.body", { occasion: p.occasionTitle }) },
    ...(p.moments.length > 0 ? [{ kind: "text" as const, text: t("programme.email.moments", { list: p.moments.join(", ") }) }] : []),
    ...(p.removed.length > 0 ? [{ kind: "text" as const, text: t("programme.email.removed", { list: p.removed.join(", ") }) }] : []),
    { kind: "note", text: t("programme.email.where") },
    { kind: "note", text: t("programme.email.why") },
  ],
}));

export type ProgrammeNotifyResult = { sent: number; skipped: number; superseded: boolean };

/**
 * The one notification round of a programme change. Covers every not-yet-notified change up
 * to `revision` (a burst of edits = one message). Each household lead with an email who is
 * concerned by at least one of those changes gets ONE email in the invitation's language
 * (bilingual, Romanian first); households that are not concerned, declined, or gave no email
 * get none — the latter see the marker on their link. Running it again sends nothing.
 * If a newer change exists the round is left to that change's own job (superseded).
 */
export async function notifyProgrammeChange(ctx: Ctx, input: z.input<typeof notifyPayload>): Promise<ProgrammeNotifyResult> {
  requireSystem(ctx);
  const data = notifyPayload.parse(input);
  const none = { sent: 0, skipped: 0, superseded: false };
  const [occasion] = await ctx.db.select().from(occasions).where(eq(occasions.id, data.occasionId));
  if (!occasion) return none;
  if ((await readRevision(ctx, occasion.id)) > data.revision) return { ...none, superseded: true };
  const pending = await ctx.db
    .select()
    .from(programmeChanges)
    .where(and(eq(programmeChanges.occasionId, occasion.id), isNull(programmeChanges.notifiedAt), lte(programmeChanges.revision, data.revision)))
    .orderBy(asc(programmeChanges.revision));
  if (pending.length === 0) return none;

  let sent = 0;
  let skipped = 0;
  if (occasion.status === "planning" || occasion.status === "postponed") {
    const rows = await ctx.db
      .select({ id: households.id, name: households.name, email: households.leadEmail, language: invitations.language, attending: rsvpResponses.attending })
      .from(households)
      .innerJoin(invitations, eq(invitations.householdId, households.id))
      .leftJoin(rsvpResponses, eq(rsvpResponses.householdId, households.id))
      .where(and(eq(households.occasionId, occasion.id), isNotNull(households.leadEmail), isNull(invitations.revokedAt)))
      .limit(5000);
    // the items as they are NOW decide what the message names
    const liveIds = new Set((await ctx.db.select({ id: programmeItems.id }).from(programmeItems).where(and(eq(programmeItems.occasionId, occasion.id), eq(programmeItems.visibleToGuests, true)))).map((r) => r.id));
    for (const h of rows) {
      const mine = pending.filter((c) => c.concernsAll || c.householdIds.includes(h.id));
      if (mine.length === 0 || h.attending === "no") continue;
      const latestByItem = new Map(mine.map((c) => [c.itemId, c]));
      const moments = [...latestByItem.values()].filter((c) => liveIds.has(c.itemId)).map((c) => c.itemTitle);
      const removed = [...latestByItem.values()].filter((c) => !liveIds.has(c.itemId)).map((c) => c.itemTitle);
      try {
        let ran = false; // a replayed key returns the stored outcome without sending again
        const outcome = await withIdempotency(ctx, PROGRAMME_NOTIFY_JOB, `${occasion.id}:${data.revision}:${h.id}`, async (tx) => {
          ran = true;
          const res = await sendEmail(tx, {
            to: h.email!,
            template: "programme.changed",
            params: { occasionTitle: occasion.title, householdName: h.name, moments, removed } satisfies ProgrammeEmailParams,
            locale: h.language,
            occasionId: occasion.id,
          });
          return res.status;
        });
        if (ran && outcome === "sent") sent++;
        else skipped++;
      } catch (e) {
        if (isAppError(e) && e.code === "LIMIT") {
          skipped++;
          break; // daily email cap: the guest link still marks the change
        }
        throw e;
      }
    }
  }
  await ctx.db
    .update(programmeChanges)
    .set({ notifiedAt: ctx.now })
    .where(and(eq(programmeChanges.occasionId, occasion.id), isNull(programmeChanges.notifiedAt), lte(programmeChanges.revision, data.revision)));
  return { sent, skipped, superseded: false };
}

function notifyJob() {
  return defineJob(PROGRAMME_NOTIFY_JOB, notifyPayload, async (ctx, payload) => {
    await notifyProgrammeChange(ctx, payload);
  });
}

/* ── Registrations (import-time, idempotent) ─────────────────────────────── */

const CSV_HEAD = {
  ro: ["Zi", "Ora", "Durată (min)", "Moment", "Fel", "Loc", "Artist / furnizor", "Vizibil invitaților", "Pentru", "Note", "Repere"],
  en: ["Day", "Time", "Length (min)", "Moment", "Kind", "Place", "Performer / supplier", "Visible to guests", "For", "Notes", "Cues"],
} as const;

function register(): void {
  notifyJob();

  registerGuestSection<GuestProgramme>({ key: "programme", order: 32, load: (ctx) => getGuestProgramme(ctx) });

  registerExport({
    key: "programme-csv",
    titleKey: "programme.export.title",
    descriptionKey: "programme.export.description",
    run: async (ctx, occasionId) => {
      const view = await listProgramme(ctx, occasionId);
      const l = ctx.locale === "en" ? "en" : "ro";
      const yes = l === "ro" ? "da" : "yes";
      const no = l === "ro" ? "nu" : "no";
      const rows = view.items.map((i) => [
        i.dayOffset + 1,
        i.time,
        i.durationMin,
        i.title,
        translate(l, `programme.kinds.${i.kind}`),
        i.place,
        i.performerName,
        i.visibleToGuests ? yes : no,
        i.concernsAll ? translate(l, "programme.concerns.all") : translate(l, "programme.concerns.someCount", { count: i.concernsHouseholdIds.length }),
        i.notes,
        i.cues.map((c) => `${c.offsetMin >= 0 ? "+" : ""}${c.offsetMin}′ ${c.instruction}${c.who ? ` (${c.who})` : ""}`).join(" | "),
      ]);
      return { filename: `program-${occasionId}.csv`, mime: "text/csv; charset=utf-8", content: toCsv([...CSV_HEAD[l]], rows) };
    },
  });

  onOccasionPurge(async (tx, occasionId) => {
    await tx.db.delete(programmeChanges).where(eq(programmeChanges.occasionId, occasionId));
    await tx.db.delete(programmeCueVersions).where(eq(programmeCueVersions.occasionId, occasionId));
    await tx.db.delete(programmeItems).where(eq(programmeItems.occasionId, occasionId));
    await tx.db.delete(programmeState).where(eq(programmeState.occasionId, occasionId));
  });
}
register();

export function registerJobs(): void {
  register();
}
