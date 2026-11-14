import {
  accounts,
  activities,
  activityOptins,
  and,
  exchangeNotes,
  asc,
  eq,
  guests,
  households,
  inArray,
  isNull,
  occasionMembers,
  sql,
  subgroupMembers,
  subgroups,
  type OccasionRole,
} from "@ed/db";
import { AppError } from "@ed/shared/errors";
import { zCurrency, zOptionalText, zText } from "@ed/shared/zod";
import { z } from "zod";
import { requireMember, type Member } from "./access";
import { audit } from "./audit";
import { requireWriteCapable, type Ctx } from "./context";
import { getLedger, getOwnBalance } from "./ledger";
import { assertOccasionWritable } from "./lifecycle";
import { onOccasionPurge } from "./occasions";
import { inTx } from "./tx";

// RELEASE D (D-02): subgroups and optional activities — plus the small vocabulary every trip
// module shares: who may plan the trip, the people of a trip ("person keys") and time zones.
//
// ACCESS (D2). A subgroup is private to its people: a member sees the subgroups they belong to
// (or lead) with their details; owners / project managers / workstream leads see all; a member
// outside a subgroup gets FORBIDDEN for it and never sees it in a list. People who are not
// members of the occasion get NOT_FOUND from requireMember, like everywhere else.

export type Subgroup = typeof subgroups.$inferSelect;
export type Activity = typeof activities.$inferSelect;

const idSchema = z.string().min(1).max(64);

/** z.input with the z.preprocess fields (typed `unknown`) made optional — what callers actually pass. */
export type LooseInput<S extends z.ZodType> = z.input<S> extends infer T ? { [K in keyof T as unknown extends T[K] ? never : K]: T[K] } & { [K in keyof T as unknown extends T[K] ? K : never]?: T[K] } : never;

/** Owner, project manager or workstream lead: may shape the trip (legs, rooms, vehicles, groups). */
export const TRIP_PLANNER_ROLES: OccasionRole[] = ["owner", "pm", "workstream_lead"];
export function canPlanTrip(member: Pick<Member, "role">): boolean {
  return TRIP_PLANNER_ROLES.includes(member.role);
}

/* ── Time zones ─────────────────────────────────────────────────────────── */

/** The short list the picker leads with; any other IANA zone can be typed / searched. */
export const CURATED_TIME_ZONES = [
  "Europe/Bucharest",
  "Europe/London",
  "Europe/Lisbon",
  "Europe/Paris",
  "Europe/Madrid",
  "Europe/Rome",
  "Europe/Berlin",
  "Europe/Vienna",
  "Europe/Budapest",
  "Europe/Sofia",
  "Europe/Athens",
  "Europe/Istanbul",
  "Europe/Chisinau",
  "Asia/Dubai",
  "Asia/Bangkok",
  "Asia/Tokyo",
  "Africa/Cairo",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "UTC",
] as const;

export function isValidTimeZone(tz: string): boolean {
  if (typeof tz !== "string" || tz.length < 2 || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
export const zTimeZone = z
  .string()
  .trim()
  .refine(isValidTimeZone, "travel.errors.timeZone");

/** Every zone the runtime knows (for the picker's search), curated ones first. */
export function allTimeZones(): string[] {
  const all = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  const curated = new Set<string>(CURATED_TIME_ZONES);
  return [...CURATED_TIME_ZONES, ...all.filter((z) => !curated.has(z))];
}

/* ── People of a trip ───────────────────────────────────────────────────── */

export const zPersonKey = z.string().regex(/^[mhg]:[a-z0-9_]{1,64}$/, "common.validation.invalid");

export type Person = {
  /** "m:<occasionMemberId>" | "h:<householdId>" | "g:<guestId>" */
  key: string;
  kind: "member" | "household" | "guest";
  label: string;
  /** Places this person / party takes (a household = its named guests, else its expected size, else 1). */
  size: number;
  /** Guests: the household they belong to. */
  householdId?: string;
};

/** The person key of a member, or null for a business-team member without a seat of their own. */
export function memberPersonKey(member: Pick<Member, "id" | "viaBusiness">): string | null {
  return member.viaBusiness ? null : `m:${member.id}`;
}

/** NO access check — call from checked code. Members (accepted), households and their named guests. */
export async function listPeopleUnchecked(ctx: Ctx, occasionId: string): Promise<Person[]> {
  const [members, hh, gg] = await Promise.all([
    ctx.db
      .select({ id: occasionMembers.id, displayName: accounts.displayName, email: accounts.email, username: accounts.username })
      .from(occasionMembers)
      .innerJoin(accounts, eq(accounts.id, occasionMembers.accountId))
      .where(and(eq(occasionMembers.occasionId, occasionId), isNull(occasionMembers.removedAt)))
      .orderBy(asc(occasionMembers.createdAt)),
    ctx.db
      .select({ id: households.id, name: households.name, expected: households.expectedPartySize })
      .from(households)
      .where(eq(households.occasionId, occasionId))
      .orderBy(asc(households.name)),
    ctx.db
      .select({ id: guests.id, name: guests.fullName, householdId: guests.householdId })
      .from(guests)
      .where(eq(guests.occasionId, occasionId))
      .orderBy(asc(guests.fullName)),
  ]);
  const named = new Map<string, number>();
  for (const g of gg) named.set(g.householdId, (named.get(g.householdId) ?? 0) + 1);
  return [
    ...members.map((m) => ({ key: `m:${m.id}`, kind: "member" as const, label: m.displayName ?? m.email ?? m.username ?? "—", size: 1 })),
    ...hh.map((h) => ({ key: `h:${h.id}`, kind: "household" as const, label: h.name, size: Math.max(1, named.get(h.id) ?? h.expected ?? 1) })),
    ...gg.map((g) => ({ key: `g:${g.id}`, kind: "guest" as const, label: g.name, size: 1, householdId: g.householdId })),
  ];
}

/** The people a planner can place in rooms, vehicles, groups (trip planners only — it is the guest list). */
export async function listPeople(ctx: Ctx, occasionId: string): Promise<Person[]> {
  await requireMember(ctx, occasionId, { roles: TRIP_PLANNER_ROLES });
  return listPeopleUnchecked(ctx, occasionId);
}

/** Resolves keys to people of THIS occasion; unknown keys throw VALIDATION. */
export async function resolvePeople(ctx: Ctx, occasionId: string, keys: string[]): Promise<Person[]> {
  const all = new Map((await listPeopleUnchecked(ctx, occasionId)).map((p) => [p.key, p]));
  return keys.map((k) => {
    const p = all.get(k);
    if (!p) throw new AppError("VALIDATION", "travel.errors.unknownPerson");
    return p;
  });
}

/* ── Subgroups ──────────────────────────────────────────────────────────── */

export type SubgroupView = {
  id: string;
  name: string;
  leadMemberId: string | null;
  leadName: string | null;
  leadEmail: string | null;
  people: Array<{ key: string; label: string; kind: Person["kind"]; size: number }>;
  isMine: boolean;
  canManage: boolean;
};

/** Ids of the subgroups this member belongs to or leads. */
export async function mySubgroupIds(ctx: Ctx, member: Member): Promise<string[]> {
  if (member.viaBusiness) return [];
  const [mine, led] = await Promise.all([
    ctx.db
      .select({ id: subgroupMembers.subgroupId })
      .from(subgroupMembers)
      .where(and(eq(subgroupMembers.occasionId, member.occasionId), eq(subgroupMembers.personKey, `m:${member.id}`))),
    ctx.db
      .select({ id: subgroups.id })
      .from(subgroups)
      .where(and(eq(subgroups.occasionId, member.occasionId), eq(subgroups.leadMemberId, member.id))),
  ]);
  return [...new Set([...mine, ...led].map((r) => r.id))];
}

/**
 * Which subgroup-scoped rows this member may see: "all" for trip planners, else the ids of
 * their own subgroups. Rows with no subgroup are for every member.
 */
export async function visibleSubgroups(ctx: Ctx, member: Member): Promise<"all" | string[]> {
  return canPlanTrip(member) ? "all" : mySubgroupIds(ctx, member);
}

export function seesSubgroup(visible: "all" | string[], subgroupId: string | null): boolean {
  return subgroupId === null || visible === "all" || visible.includes(subgroupId);
}

/** Subgroups the actor may see (D2): all for trip planners, own ones otherwise. */
export async function listSubgroups(ctx: Ctx, occasionId: string): Promise<SubgroupView[]> {
  const id = idSchema.parse(occasionId);
  const member = await requireMember(ctx, id);
  const visible = await visibleSubgroups(ctx, member);
  if (visible !== "all" && visible.length === 0) return [];
  const rows = await ctx.db
    .select()
    .from(subgroups)
    .where(visible === "all" ? eq(subgroups.occasionId, id) : and(eq(subgroups.occasionId, id), inArray(subgroups.id, visible)))
    .orderBy(asc(subgroups.name));
  if (rows.length === 0) return [];
  const [links, people, mine] = await Promise.all([
    ctx.db
      .select()
      .from(subgroupMembers)
      .where(
        inArray(
          subgroupMembers.subgroupId,
          rows.map((r) => r.id),
        ),
      ),
    listPeopleUnchecked(ctx, id),
    mySubgroupIds(ctx, member),
  ]);
  const byKey = new Map(people.map((p) => [p.key, p]));
  return rows.map((g) => ({
    id: g.id,
    name: g.name,
    leadMemberId: g.leadMemberId,
    leadName: g.leadMemberId ? (byKey.get(`m:${g.leadMemberId}`)?.label ?? null) : null,
    leadEmail: canPlanTrip(member) || g.leadMemberId === member.id ? g.leadEmail : null,
    people: links
      .filter((l) => l.subgroupId === g.id)
      .map((l) => byKey.get(l.personKey))
      .filter((p): p is Person => !!p)
      .map((p) => ({ key: p.key, label: p.label, kind: p.kind, size: p.size })),
    isMine: mine.includes(g.id),
    canManage: canPlanTrip(member),
  }));
}

/** One subgroup; FORBIDDEN for a member who is neither in it nor a trip planner. */
export async function getSubgroup(ctx: Ctx, subgroupId: string): Promise<SubgroupView> {
  const [row] = await ctx.db.select().from(subgroups).where(eq(subgroups.id, idSchema.parse(subgroupId)));
  if (!row) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  const member = await requireMember(ctx, row.occasionId);
  const visible = await visibleSubgroups(ctx, member);
  if (!seesSubgroup(visible, row.id)) throw new AppError("FORBIDDEN", "common.errors.FORBIDDEN");
  const found = (await listSubgroups(ctx, row.occasionId)).find((g) => g.id === row.id);
  if (!found) throw new AppError("FORBIDDEN", "common.errors.FORBIDDEN");
  return found;
}

const subgroupInput = z.object({
  occasionId: idSchema,
  name: zText(80),
  leadMemberId: z.preprocess((v) => (v === "" || v === null ? undefined : v), idSchema.optional()),
  leadEmail: z.preprocess((v) => (v === "" || v === null ? undefined : v), z.string().trim().toLowerCase().email("common.validation.invalidEmail").max(200).optional()),
});

async function assertRealMember(ctx: Ctx, occasionId: string, memberId: string | undefined): Promise<void> {
  if (!memberId) return;
  const [m] = await ctx.db
    .select({ id: occasionMembers.id })
    .from(occasionMembers)
    .where(and(eq(occasionMembers.id, memberId), eq(occasionMembers.occasionId, occasionId), isNull(occasionMembers.removedAt)));
  if (!m) throw new AppError("VALIDATION", "travel.errors.unknownPerson", { fieldErrors: { leadMemberId: ["travel.errors.unknownPerson"] } });
}

export async function createSubgroup(ctx: Ctx, input: LooseInput<typeof subgroupInput>): Promise<{ subgroupId: string }> {
  requireWriteCapable(ctx);
  const data = subgroupInput.parse(input);
  await requireMember(ctx, data.occasionId, { roles: TRIP_PLANNER_ROLES });
  await assertOccasionWritable(ctx, data.occasionId);
  await assertRealMember(ctx, data.occasionId, data.leadMemberId);
  return inTx(ctx, async (tx) => {
    const [row] = await tx.db
      .insert(subgroups)
      .values({ occasionId: data.occasionId, name: data.name, leadMemberId: data.leadMemberId ?? null, leadEmail: data.leadEmail ?? null, createdAt: tx.now })
      .returning({ id: subgroups.id });
    if (data.leadMemberId) {
      await tx.db
        .insert(subgroupMembers)
        .values({ subgroupId: row!.id, occasionId: data.occasionId, personKey: `m:${data.leadMemberId}` })
        .onConflictDoNothing();
    }
    await audit(tx, { action: "subgroup.created", objectType: "subgroup", objectId: row!.id, after: { name: data.name } });
    return { subgroupId: row!.id };
  });
}

async function loadSubgroupForManage(ctx: Ctx, subgroupId: string): Promise<Subgroup> {
  const [row] = await ctx.db.select().from(subgroups).where(eq(subgroups.id, idSchema.parse(subgroupId)));
  if (!row) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  await requireMember(ctx, row.occasionId, { roles: TRIP_PLANNER_ROLES });
  await assertOccasionWritable(ctx, row.occasionId);
  return row;
}

/** Sets exactly who is in the subgroup (tick list). Idempotent. */
export async function setSubgroupPeople(ctx: Ctx, input: { subgroupId: string; personKeys: string[] }): Promise<void> {
  requireWriteCapable(ctx);
  const data = z.object({ subgroupId: idSchema, personKeys: z.array(zPersonKey).max(500) }).parse(input);
  const group = await loadSubgroupForManage(ctx, data.subgroupId);
  const keys = [...new Set(data.personKeys)];
  await resolvePeople(ctx, group.occasionId, keys);
  await inTx(ctx, async (tx) => {
    await tx.db.delete(subgroupMembers).where(eq(subgroupMembers.subgroupId, group.id));
    if (keys.length > 0) {
      await tx.db.insert(subgroupMembers).values(keys.map((personKey) => ({ subgroupId: group.id, occasionId: group.occasionId, personKey })));
    }
    await audit(tx, { action: "subgroup.people_set", objectType: "subgroup", objectId: group.id, after: { count: keys.length } });
  });
}

export async function deleteSubgroup(ctx: Ctx, input: { subgroupId: string }): Promise<void> {
  requireWriteCapable(ctx);
  const group = await loadSubgroupForManage(ctx, input.subgroupId);
  await ctx.db.delete(subgroups).where(eq(subgroups.id, group.id));
  await audit(ctx, { action: "subgroup.deleted", objectType: "subgroup", objectId: group.id, before: { name: group.name } });
}

/* ── Optional activities ────────────────────────────────────────────────── */

export type ActivityView = {
  id: string;
  title: string;
  startsAt: Date | null;
  endsAt: Date | null;
  tz: string;
  place: string | null;
  /** null = unknown (never 0). */
  costMinor: number | null;
  currency: string;
  /** null = no limit. */
  capacity: number | null;
  taken: number;
  left: number | null;
  subgroupId: string | null;
  subgroupName: string | null;
  notes: string | null;
  /** The actor's own opt-in. */
  mine: boolean;
  /** Names of who opted in — trip planners and the subgroup's own people only see them. */
  people: Array<{ key: string; label: string; places: number }>;
  canManage: boolean;
};

const zInstant = z.preprocess((v) => (v === "" || v === null || v === undefined ? undefined : v), z.coerce.date("common.validation.invalid").optional());
const zOptionalInt = (min: number, max: number) =>
  z.preprocess((v) => (v === "" || v === null || v === undefined ? undefined : Number(v)), z.number("common.validation.invalid").int("common.validation.invalid").min(min, "common.validation.tooSmall").max(max, "common.validation.tooBig").optional());

const activityInput = z.object({
  occasionId: idSchema,
  title: zText(160),
  startsAt: zInstant,
  endsAt: zInstant,
  tz: zTimeZone.default("Europe/Bucharest"),
  place: zOptionalText(200),
  /** Minor units per person; absent = unknown. */
  costMinor: zOptionalInt(0, 1_000_000_000),
  currency: zCurrency.optional(),
  capacity: zOptionalInt(1, 100_000),
  subgroupId: z.preprocess((v) => (v === "" || v === null ? undefined : v), idSchema.optional()),
  notes: zOptionalText(2000),
});

export async function createActivity(ctx: Ctx, input: LooseInput<typeof activityInput>): Promise<{ activityId: string }> {
  requireWriteCapable(ctx);
  const data = activityInput.parse(input);
  await requireMember(ctx, data.occasionId, { roles: TRIP_PLANNER_ROLES });
  await assertOccasionWritable(ctx, data.occasionId);
  if (data.startsAt && data.endsAt && data.endsAt.getTime() < data.startsAt.getTime()) {
    throw new AppError("VALIDATION", "travel.errors.endBeforeStart", { fieldErrors: { endsAt: ["travel.errors.endBeforeStart"] } });
  }
  if (data.subgroupId) {
    const [g] = await ctx.db.select({ id: subgroups.id }).from(subgroups).where(and(eq(subgroups.id, data.subgroupId), eq(subgroups.occasionId, data.occasionId)));
    if (!g) throw new AppError("VALIDATION", "common.validation.invalid", { fieldErrors: { subgroupId: ["common.validation.invalid"] } });
  }
  const [row] = await ctx.db
    .insert(activities)
    .values({
      occasionId: data.occasionId,
      title: data.title,
      startsAt: data.startsAt ?? null,
      endsAt: data.endsAt ?? null,
      tz: data.tz,
      place: data.place ?? null,
      costMinor: data.costMinor ?? null,
      currency: data.currency ?? "RON",
      capacity: data.capacity ?? null,
      subgroupId: data.subgroupId ?? null,
      notes: data.notes ?? null,
      createdAt: ctx.now,
    })
    .returning({ id: activities.id });
  await audit(ctx, { action: "activity.created", objectType: "activity", objectId: row!.id, after: { title: data.title, capacity: data.capacity ?? null } });
  return { activityId: row!.id };
}

export async function deleteActivity(ctx: Ctx, input: { activityId: string }): Promise<void> {
  requireWriteCapable(ctx);
  const [row] = await ctx.db.select().from(activities).where(eq(activities.id, idSchema.parse(input.activityId)));
  if (!row) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  await requireMember(ctx, row.occasionId, { roles: TRIP_PLANNER_ROLES });
  await assertOccasionWritable(ctx, row.occasionId);
  await ctx.db.delete(activities).where(eq(activities.id, row.id));
  await audit(ctx, { action: "activity.deleted", objectType: "activity", objectId: row.id, before: { title: row.title } });
}

/** NO access check: every activity of the occasion (for the rehearsal and exports). */
export async function listActivitiesUnchecked(ctx: Ctx, occasionId: string): Promise<Activity[]> {
  return ctx.db.select().from(activities).where(eq(activities.occasionId, occasionId)).orderBy(asc(activities.startsAt), asc(activities.createdAt));
}

/** Activities the actor may see: whole-trip ones, and those of their own subgroups (D2). */
export async function listActivities(ctx: Ctx, occasionId: string): Promise<ActivityView[]> {
  const id = idSchema.parse(occasionId);
  const member = await requireMember(ctx, id);
  const visible = await visibleSubgroups(ctx, member);
  const rows = (await listActivitiesUnchecked(ctx, id)).filter((a) => seesSubgroup(visible, a.subgroupId));
  if (rows.length === 0) return [];
  const [optins, people, groups] = await Promise.all([
    ctx.db
      .select()
      .from(activityOptins)
      .where(
        inArray(
          activityOptins.activityId,
          rows.map((r) => r.id),
        ),
      ),
    listPeopleUnchecked(ctx, id),
    ctx.db.select({ id: subgroups.id, name: subgroups.name }).from(subgroups).where(eq(subgroups.occasionId, id)),
  ]);
  const byKey = new Map(people.map((p) => [p.key, p]));
  const groupName = new Map(groups.map((g) => [g.id, g.name]));
  const myKey = memberPersonKey(member);
  const planner = canPlanTrip(member);
  return rows.map((a) => {
    const mine = optins.filter((o) => o.activityId === a.id);
    return {
      id: a.id,
      title: a.title,
      startsAt: a.startsAt,
      endsAt: a.endsAt,
      tz: a.tz,
      place: a.place,
      costMinor: a.costMinor,
      currency: a.currency,
      capacity: a.capacity,
      taken: a.taken,
      left: a.capacity === null ? null : Math.max(0, a.capacity - a.taken),
      subgroupId: a.subgroupId,
      subgroupName: a.subgroupId ? (groupName.get(a.subgroupId) ?? null) : null,
      notes: a.notes,
      mine: myKey !== null && mine.some((o) => o.personKey === myKey),
      // names: planners, and the people of the subgroup the activity belongs to
      people:
        planner || a.subgroupId !== null
          ? mine.map((o) => ({ key: o.personKey, label: byKey.get(o.personKey)?.label ?? "—", places: o.places }))
          : mine.filter((o) => o.personKey === myKey).map((o) => ({ key: o.personKey, label: byKey.get(o.personKey)?.label ?? "—", places: o.places })),
      canManage: planner,
    };
  });
}

async function loadActivityFor(ctx: Ctx, activityId: string, personKey: string | undefined): Promise<{ activity: Activity; person: Person }> {
  const [activity] = await ctx.db.select().from(activities).where(eq(activities.id, idSchema.parse(activityId)));
  if (!activity) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  const member = await requireMember(ctx, activity.occasionId);
  const visible = await visibleSubgroups(ctx, member);
  if (!seesSubgroup(visible, activity.subgroupId)) throw new AppError("FORBIDDEN", "common.errors.FORBIDDEN");
  await assertOccasionWritable(ctx, activity.occasionId);
  const own = memberPersonKey(member);
  const key = personKey ?? own;
  if (!key) throw new AppError("FORBIDDEN", "common.errors.FORBIDDEN");
  // a member opts THEMSELVES in or out; placing somebody else is for trip planners
  if (key !== own && !canPlanTrip(member)) throw new AppError("FORBIDDEN", "common.errors.FORBIDDEN");
  const [person] = await resolvePeople(ctx, activity.occasionId, [key]);
  return { activity, person: person! };
}

/**
 * Opt in to an activity. ATOMIC like RSVP capacity (A8): the places are taken by one
 * conditional UPDATE; whoever loses the last place gets TAKEN and holds nothing. Idempotent per
 * person (Q4): a second tap changes nothing.
 */
export async function optInActivity(ctx: Ctx, input: { activityId: string; personKey?: string }): Promise<{ joined: boolean; already: boolean; left: number | null }> {
  requireWriteCapable(ctx);
  const data = z.object({ activityId: idSchema, personKey: zPersonKey.optional() }).parse(input);
  const { activity, person } = await loadActivityFor(ctx, data.activityId, data.personKey);
  return inTx(ctx, async (tx) => {
    const inserted = await tx.db
      .insert(activityOptins)
      .values({ activityId: activity.id, occasionId: activity.occasionId, personKey: person.key, places: person.size, createdAt: tx.now })
      .onConflictDoNothing({ target: [activityOptins.activityId, activityOptins.personKey] })
      .returning({ id: activityOptins.id });
    if (!inserted[0]) {
      const [now] = await tx.db.select({ capacity: activities.capacity, taken: activities.taken }).from(activities).where(eq(activities.id, activity.id));
      return { joined: true, already: true, left: now?.capacity == null ? null : Math.max(0, now.capacity - now.taken) };
    }
    const won = await tx.db
      .update(activities)
      .set({ taken: sql`${activities.taken} + ${person.size}` })
      .where(and(eq(activities.id, activity.id), sql`(${activities.capacity} IS NULL OR ${activities.taken} + ${person.size} <= ${activities.capacity})`))
      .returning({ capacity: activities.capacity, taken: activities.taken });
    if (!won[0]) {
      const [now] = await tx.db.select({ capacity: activities.capacity, taken: activities.taken }).from(activities).where(eq(activities.id, activity.id));
      const left = now?.capacity == null ? 0 : Math.max(0, now.capacity - now.taken);
      // rolls the opt-in row back with the transaction: nothing is held
      throw new AppError("TAKEN", "travel.errors.activityFull", { params: { left }, left });
    }
    await audit(tx, { action: "activity.opted_in", objectType: "activity", objectId: activity.id, after: { personKey: person.key, places: person.size } });
    return { joined: true, already: false, left: won[0].capacity === null ? null : Math.max(0, won[0].capacity - won[0].taken) };
  });
}

/** Gives the places back. Idempotent. */
export async function optOutActivity(ctx: Ctx, input: { activityId: string; personKey?: string }): Promise<{ joined: boolean }> {
  requireWriteCapable(ctx);
  const data = z.object({ activityId: idSchema, personKey: zPersonKey.optional() }).parse(input);
  const { activity, person } = await loadActivityFor(ctx, data.activityId, data.personKey);
  return inTx(ctx, async (tx) => {
    const gone = await tx.db
      .delete(activityOptins)
      .where(and(eq(activityOptins.activityId, activity.id), eq(activityOptins.personKey, person.key)))
      .returning({ places: activityOptins.places });
    if (gone[0]) {
      await tx.db
        .update(activities)
        .set({ taken: sql`GREATEST(0, ${activities.taken} - ${gone[0].places})` })
        .where(eq(activities.id, activity.id));
      await audit(tx, { action: "activity.opted_out", objectType: "activity", objectId: activity.id, before: { personKey: person.key } });
    }
    return { joined: false };
  });
}

/* ── D-05: participant settlement view (per currency, from the ONE ledger) ─ */

export const TRIP_CURRENCIES = ["RON", "EUR", "USD", "GBP", "HUF", "BGN"] as const;

export type SettlementLine = {
  participantId: string;
  name: string;
  /** Shared costs this person paid for. undefined = not shown (own-line view). */
  paidMinor: number | undefined;
  /** Their share of the shared costs. */
  owesMinor: number | undefined;
  /** Positive = is owed money, negative = owes money (settle-up payments included). */
  netMinor: number;
  isMe: boolean;
};
export type CurrencyView = {
  currency: string;
  lines: SettlementLine[];
  /** "cine cui dă" in this currency. */
  transfers: Array<{ from: string; to: string; amountMinor: number }>;
  totalCostMinor: number | undefined;
  /** The planner's own note about an exchange rate — an ANNOTATION, never used to convert. */
  exchangeNote: string | null;
};
export type TripSettlement = {
  /** "all": the member holds the finance grant. "own": only their own line (D2). */
  scope: "all" | "own";
  /** One block per currency; currencies are NEVER merged or converted. */
  currencies: CurrencyView[];
  participants: Array<{ id: string; name: string }>;
  /** False when the member is not a participant of the ledger (own scope, nothing to show). */
  isParticipant: boolean;
};

/**
 * Who paid what, who owes what and who gives whom — per participant AND per currency, read
 * from the one balanced ledger (B3). RON and EUR stay two separate settlements: nothing is
 * converted. Members without the finance grant get their own line only (getOwnBalance).
 */
export async function getTripSettlement(ctx: Ctx, occasionId: string): Promise<TripSettlement> {
  const id = idSchema.parse(occasionId);
  const member = await requireMember(ctx, id);
  const notes = await ctx.db.select().from(exchangeNotes).where(eq(exchangeNotes.occasionId, id));
  const noteOf = (currency: string) => notes.find((n) => n.currency === currency)?.note ?? null;
  if (!member.grants.finance) {
    const own = await getOwnBalance(ctx, id);
    return {
      scope: "own",
      isParticipant: own !== null,
      participants: own ? [{ id: own.participantId, name: own.name }] : [],
      currencies: (own?.perCurrency ?? []).map((c) => ({
        currency: c.currency,
        lines: [{ participantId: own!.participantId, name: own!.name, paidMinor: undefined, owesMinor: undefined, netMinor: c.balanceMinor, isMe: true }],
        transfers: c.transfers.map((t) => (t.direction === "pay" ? { from: own!.name, to: t.otherName, amountMinor: t.amountMinor } : { from: t.otherName, to: own!.name, amountMinor: t.amountMinor })),
        totalCostMinor: undefined,
        exchangeNote: noteOf(c.currency),
      })),
    };
  }
  const ledger = await getLedger(ctx, id);
  const name = new Map(ledger.participants.map((p) => [p.id, p.name]));
  const me = ledger.participants.find((p) => p.memberId === member.id)?.id ?? null;
  const currencies = ledger.settlements.map((s) => {
    const paid = new Map<string, number>();
    const owes = new Map<string, number>();
    for (const e of ledger.entries) {
      if (e.voidedAt || e.kind !== "cost" || e.currency !== s.currency) continue;
      paid.set(e.paidByParticipantId, (paid.get(e.paidByParticipantId) ?? 0) + e.amountMinor);
      for (const sh of e.shares) owes.set(sh.participantId, (owes.get(sh.participantId) ?? 0) + sh.shareMinor);
    }
    return {
      currency: s.currency,
      lines: s.balances
        .map((b) => ({ participantId: b.participantId, name: name.get(b.participantId) ?? "—", paidMinor: paid.get(b.participantId) ?? 0, owesMinor: owes.get(b.participantId) ?? 0, netMinor: b.balanceMinor, isMe: b.participantId === me }))
        .sort((a, b) => a.name.localeCompare(b.name, "ro")),
      transfers: s.transfers.map((t) => ({ from: name.get(t.fromParticipantId) ?? "—", to: name.get(t.toParticipantId) ?? "—", amountMinor: t.amountMinor })),
      totalCostMinor: s.totalCostMinor,
      exchangeNote: noteOf(s.currency),
    };
  });
  return { scope: "all", isParticipant: me !== null, participants: ledger.participants.map((p) => ({ id: p.id, name: p.name })), currencies };
}

/** Saves (or, with an empty note, removes) the exchange-rate note of one currency. Finance grant. */
export async function setExchangeNote(ctx: Ctx, input: { occasionId: string; currency: string; note?: string | null }): Promise<void> {
  requireWriteCapable(ctx);
  const data = z.object({ occasionId: idSchema, currency: z.string().regex(/^[A-Z]{3}$/, "common.validation.invalid"), note: zOptionalText(200) }).parse(input);
  await requireMember(ctx, data.occasionId, { grant: "finance" });
  await assertOccasionWritable(ctx, data.occasionId);
  if (!data.note) {
    await ctx.db.delete(exchangeNotes).where(and(eq(exchangeNotes.occasionId, data.occasionId), eq(exchangeNotes.currency, data.currency)));
    return;
  }
  await ctx.db
    .insert(exchangeNotes)
    .values({ occasionId: data.occasionId, currency: data.currency, note: data.note })
    .onConflictDoUpdate({ target: [exchangeNotes.occasionId, exchangeNotes.currency], set: { note: data.note } });
}

/* ── Purge ──────────────────────────────────────────────────────────────── */

onOccasionPurge(async (tx, occasionId) => {
  // rows without an FK to occasions (the rest cascades from occasions / subgroups / activities)
  await tx.db.delete(subgroupMembers).where(eq(subgroupMembers.occasionId, occasionId));
  await tx.db.delete(activityOptins).where(eq(activityOptins.occasionId, occasionId));
});
