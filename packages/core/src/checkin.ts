import { and, asc, checkIns, eq, guests, households, invitations, occasions, rsvpResponses, sql, type CheckInSource } from "@ed/db";
import { AppError } from "@ed/shared/errors";
import { hashToken } from "@ed/shared/ids";
import { z } from "zod";
import { isManager, requireMember, type Member } from "./access";
import { audit } from "./audit";
import { requireWriteCapable, type Ctx } from "./context";
import { listCorrections, recordCorrection, type Correction } from "./corrections";
import { registerExport, toCsv } from "./exports";
import { assertOccasionWritable } from "./lifecycle";
import { onOccasionPurge } from "./occasions";
import { PLANNING_ROLES } from "./suppliers";
import { inTx } from "./tx";

// RELEASE E (E-02): QR check-in and guest-flow estimates.
//
// An arrival is a FACT (principle 4): one check_ins row per household, written once. A second
// scan or tap finds the row and changes nothing (Q4). Counts, the time and "un-check" change
// only through correctCheckIn — a corrections row with a reason in the SAME transaction; the
// database refuses any other change (sql/040_operate_guards.sql, GUC ed.correction).
//
// Who may check in: any PLANNING member (owner, PM, workstream lead, contributor). Check-in
// works on a cancelled / postponed occasion too; only a CLOSED occasion is read-only.
//
// Guest flow (Q5: 1,000 attendees) is aggregates only — counts per time bucket and one
// summary statement; no names leave the check-in roster.

export type CheckIn = typeof checkIns.$inferSelect;
export const CHECK_INS_TABLE = "check_ins";
const idSchema = z.string().min(1).max(64);
const zCount = z.number().int().min(0).max(200);

/** sha-256 of an invitation QR id — what the roster carries, so devices never hold the ids themselves. */
export const qrDigest = (qrId: string): string => hashToken(qrId);

/** The QR on an invitation holds a link ending in the QR id (…/g/q/<qrId>) or the bare id. */
export function qrIdFromScan(scanned: string): string {
  const s = scanned.trim();
  const m = /\/g\/q\/([A-Za-z0-9_-]{4,128})\/?(?:[?#].*)?$/.exec(s);
  return (m ? m[1]! : s).slice(0, 128);
}

async function requireDoor(ctx: Ctx, occasionId: string): Promise<Member> {
  return requireMember(ctx, occasionId, { roles: PLANNING_ROLES });
}

/* ── Roster ─────────────────────────────────────────────────────────────── */

export type RosterRow = {
  householdId: string;
  name: string;
  /** Folded names of the household and its adults, for searching on the device. */
  search: string;
  rsvp: "yes" | "no" | "maybe" | "pending";
  /** From the RSVP when answered yes; otherwise what is known (named adults, expected size). null = unknown. */
  expectedAdults: number | null;
  expectedChildren: number | null;
  /** sha-256 of the invitation QR id (null when no QR was issued). */
  qr: string | null;
  arrived: null | { checkInId: string; adults: number; children: number; at: string };
};

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
export const foldName = fold;

/**
 * Everyone expected at the door (household names and counts — no contacts), with who already
 * arrived. Planning members only. This is also what a device keeps for offline check-in.
 */
export async function getCheckInRoster(ctx: Ctx, occasionId: string): Promise<{ rows: RosterRow[]; status: string; title: string }> {
  const id = idSchema.parse(occasionId);
  await requireDoor(ctx, id);
  const [[occasion], hh, gg, rr, inv, arrivals] = await Promise.all([
    ctx.db.select({ status: occasions.status, title: occasions.title }).from(occasions).where(eq(occasions.id, id)),
    ctx.db.select({ id: households.id, name: households.name, leadName: households.leadName, expected: households.expectedPartySize }).from(households).where(eq(households.occasionId, id)).orderBy(asc(households.name)),
    ctx.db.select({ householdId: guests.householdId, name: guests.fullName }).from(guests).where(eq(guests.occasionId, id)),
    ctx.db.select().from(rsvpResponses).where(eq(rsvpResponses.occasionId, id)),
    ctx.db.select({ householdId: invitations.householdId, qrId: invitations.qrId }).from(invitations).where(eq(invitations.occasionId, id)),
    ctx.db.select().from(checkIns).where(eq(checkIns.occasionId, id)),
  ]);
  const names = new Map<string, string[]>();
  for (const g of gg) (names.get(g.householdId) ?? names.set(g.householdId, []).get(g.householdId)!).push(g.name);
  const rsvp = new Map(rr.map((r) => [r.householdId, r]));
  const qr = new Map(inv.map((i) => [i.householdId, i.qrId]));
  const arrived = new Map(arrivals.filter((a) => a.voidedAt === null).map((a) => [a.householdId, a]));
  return {
    status: occasion?.status ?? "planning",
    title: occasion?.title ?? "",
    rows: hh.map((h) => {
      const r = rsvp.get(h.id);
      const adults = names.get(h.id) ?? [];
      const a = arrived.get(h.id);
      const q = qr.get(h.id);
      return {
        householdId: h.id,
        name: h.name,
        search: fold([h.name, h.leadName ?? "", ...adults].join(" ")),
        rsvp: r ? r.attending : "pending",
        expectedAdults: r?.attending === "yes" ? r.adultsCount : adults.length > 0 ? adults.length : h.expected,
        expectedChildren: r?.attending === "yes" ? r.childrenCount : null,
        qr: q ? qrDigest(q) : null,
        arrived: a ? { checkInId: a.id, adults: a.adultsArrived, children: a.childrenArrived, at: a.arrivedAt.toISOString() } : null,
      };
    }),
  };
}

/* ── Recording an arrival ───────────────────────────────────────────────── */

export type CheckInResult = {
  checkInId: string;
  householdId: string;
  householdName: string;
  adults: number;
  children: number;
  arrivedAt: Date;
  /** True when this household had already arrived: nothing was changed. */
  already: boolean;
};

const arrivalInput = z.object({
  occasionId: idSchema,
  householdId: idSchema,
  adults: zCount.optional(),
  children: zCount.optional(),
  source: z.enum(["qr", "search", "offline"]).default("search"),
  /** When it happened (offline capture). Never in the future; defaults to now. */
  at: z.date().optional(),
});

/**
 * Records that a household arrived. Idempotent per household (Q4): the unique index decides;
 * a repeat returns the first arrival untouched with `already: true`. Counts default to the
 * RSVP (else the named adults, else 1 adult). A household that was un-checked by a correction
 * arrives again through a correction too (the fact trail stays whole).
 */
export async function checkInHousehold(ctx: Ctx, input: z.input<typeof arrivalInput>): Promise<CheckInResult> {
  requireWriteCapable(ctx);
  const data = arrivalInput.parse(input);
  const member = await requireDoor(ctx, data.occasionId);
  await assertOccasionWritable(ctx, data.occasionId);
  const [h] = await ctx.db.select({ id: households.id, name: households.name, expected: households.expectedPartySize }).from(households).where(and(eq(households.id, data.householdId), eq(households.occasionId, data.occasionId)));
  if (!h) throw new AppError("NOT_FOUND", "operate.errors.householdNotFound");
  const [[r], [named]] = await Promise.all([
    ctx.db.select().from(rsvpResponses).where(eq(rsvpResponses.householdId, h.id)),
    ctx.db.select({ n: sql<number>`count(*)::int` }).from(guests).where(eq(guests.householdId, h.id)),
  ]);
  const adults = data.adults ?? (r?.attending === "yes" && r.adultsCount > 0 ? r.adultsCount : Math.max(1, named?.n ?? 0, r ? 0 : (h.expected ?? 0)));
  const children = data.children ?? (r?.attending === "yes" ? r.childrenCount : 0);
  const at = data.at && data.at.getTime() < ctx.now.getTime() ? data.at : ctx.now;
  return inTx(ctx, async (tx) => {
    const inserted = await tx.db
      .insert(checkIns)
      .values({
        occasionId: data.occasionId,
        householdId: h.id,
        adultsArrived: adults,
        childrenArrived: children,
        arrivedAt: at,
        source: data.source as CheckInSource,
        byMemberId: member.viaBusiness ? null : member.id,
        byAccountId: member.accountId,
        createdAt: tx.now,
      })
      .onConflictDoNothing({ target: checkIns.householdId })
      .returning();
    if (inserted[0]) {
      await audit(tx, { action: "checkin.arrived", objectType: "check_in", objectId: inserted[0].id, after: { householdId: h.id, adults, children, source: data.source } });
      return { checkInId: inserted[0].id, householdId: h.id, householdName: h.name, adults, children, arrivedAt: at, already: false };
    }
    const [existing] = await tx.db.select().from(checkIns).where(eq(checkIns.householdId, h.id)).for("update");
    if (!existing) throw new AppError("CONFLICT", "common.errors.CONFLICT");
    if (existing.voidedAt === null) {
      return { checkInId: existing.id, householdId: h.id, householdName: h.name, adults: existing.adultsArrived, children: existing.childrenArrived, arrivedAt: existing.arrivedAt, already: true };
    }
    // un-checked earlier: arriving again is a change of the fact → a correction
    await recordCorrection(tx, {
      occasionId: data.occasionId,
      targetTable: CHECK_INS_TABLE,
      targetId: existing.id,
      field: "voidedAt",
      before: existing.voidedAt.toISOString(),
      after: null,
      reason: "Sosire înregistrată din nou / arrived again",
    });
    await tx.db.execute(sql`select set_config('ed.correction', 'on', true)`);
    await tx.db.update(checkIns).set({ voidedAt: null, adultsArrived: adults, childrenArrived: children, arrivedAt: at }).where(eq(checkIns.id, existing.id));
    await tx.db.execute(sql`select set_config('ed.correction', '', true)`);
    return { checkInId: existing.id, householdId: h.id, householdName: h.name, adults, children, arrivedAt: at, already: false };
  });
}

/**
 * Check-in by scanning the QR printed on an invitation (invitations.qr_id). `qrId` may be the
 * scanned link or the bare id. An unknown, revoked or other-occasion code is NOT_FOUND.
 */
export async function checkInByQr(ctx: Ctx, input: { occasionId: string; qrId: string; adults?: number; children?: number }): Promise<CheckInResult> {
  requireWriteCapable(ctx);
  const data = z.object({ occasionId: idSchema, qrId: z.string().trim().min(1, "common.validation.required").max(600), adults: zCount.optional(), children: zCount.optional() }).parse(input);
  await requireDoor(ctx, data.occasionId);
  const qrId = qrIdFromScan(data.qrId);
  const [inv] = await ctx.db
    .select({ householdId: invitations.householdId, revokedAt: invitations.revokedAt })
    .from(invitations)
    .where(and(eq(invitations.qrId, qrId), eq(invitations.occasionId, data.occasionId)));
  if (!inv || inv.revokedAt) throw new AppError("NOT_FOUND", "operate.errors.qrUnknown", { fieldErrors: { qrId: ["operate.errors.qrUnknown"] } });
  return checkInHousehold(ctx, { occasionId: data.occasionId, householdId: inv.householdId, adults: data.adults, children: data.children, source: "qr" });
}

/**
 * The ONLY way to change an arrival after it was recorded: new counts and / or un-check, with
 * a reason. Writes the corrections row and the change in one transaction.
 */
export async function correctCheckIn(ctx: Ctx, input: { checkInId: string; adults?: number; children?: number; undo?: boolean; reason: string }): Promise<{ correctionIds: string[] }> {
  requireWriteCapable(ctx);
  const data = z.object({ checkInId: idSchema, adults: zCount.optional(), children: zCount.optional(), undo: z.boolean().optional(), reason: z.string() }).parse(input);
  const [row] = await ctx.db.select().from(checkIns).where(eq(checkIns.id, data.checkInId));
  if (!row) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  await requireDoor(ctx, row.occasionId);
  await assertOccasionWritable(ctx, row.occasionId);
  return inTx(ctx, async (tx) => {
    const [cur] = await tx.db.select().from(checkIns).where(eq(checkIns.id, row.id)).for("update");
    if (!cur) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
    const changes: Array<{ field: string; before: unknown; after: unknown }> = [];
    const set: Partial<CheckIn> = {};
    if (data.undo && cur.voidedAt === null) {
      changes.push({ field: "voidedAt", before: null, after: tx.now.toISOString() });
      set.voidedAt = tx.now;
    }
    if (data.adults !== undefined && data.adults !== cur.adultsArrived) {
      changes.push({ field: "adultsArrived", before: cur.adultsArrived, after: data.adults });
      set.adultsArrived = data.adults;
    }
    if (data.children !== undefined && data.children !== cur.childrenArrived) {
      changes.push({ field: "childrenArrived", before: cur.childrenArrived, after: data.children });
      set.childrenArrived = data.children;
    }
    if (changes.length === 0) return { correctionIds: [] };
    const correctionIds: string[] = [];
    for (const c of changes) {
      correctionIds.push(await recordCorrection(tx, { occasionId: cur.occasionId, targetTable: CHECK_INS_TABLE, targetId: cur.id, reason: data.reason, ...c }));
    }
    await tx.db.execute(sql`select set_config('ed.correction', 'on', true)`);
    await tx.db.update(checkIns).set(set).where(eq(checkIns.id, cur.id));
    await tx.db.execute(sql`select set_config('ed.correction', '', true)`);
    return { correctionIds };
  });
}

/** Correction history of one arrival, oldest first (planning members). */
export async function listCheckInCorrections(ctx: Ctx, checkInId: string): Promise<Correction[]> {
  const [row] = await ctx.db.select({ occasionId: checkIns.occasionId }).from(checkIns).where(eq(checkIns.id, idSchema.parse(checkInId)));
  if (!row) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  await requireDoor(ctx, row.occasionId);
  return listCorrections(ctx, { targetTable: CHECK_INS_TABLE, targetId: checkInId });
}

/* ── Guest flow (aggregates only) ───────────────────────────────────────── */

export type ArrivalSummary = {
  /** RSVP "yes": households and people (adults + children counts). */
  expectedHouseholds: number;
  expectedPeople: number;
  arrivedHouseholds: number;
  arrivedPeople: number;
  /** Expected households that have not arrived yet. */
  notYetHouseholds: number;
  firstArrivalAt: Date | null;
  lastArrivalAt: Date | null;
};

/** NO access check. ONE aggregate statement over rsvp_responses and check_ins (Q5). */
export async function readArrivalSummaryUnchecked(ctx: Ctx, occasionId: string): Promise<ArrivalSummary> {
  const res = await ctx.db.execute(sql`
    select
      (select count(*) from rsvp_responses r where r.occasion_id = ${occasionId} and r.attending = 'yes')::int as expected_households,
      (select coalesce(sum(r.adults_count + r.children_count), 0) from rsvp_responses r where r.occasion_id = ${occasionId} and r.attending = 'yes')::int as expected_people,
      (select count(*) from check_ins c where c.occasion_id = ${occasionId} and c.voided_at is null)::int as arrived_households,
      (select coalesce(sum(c.adults_arrived + c.children_arrived), 0) from check_ins c where c.occasion_id = ${occasionId} and c.voided_at is null)::int as arrived_people,
      (select count(*) from rsvp_responses r where r.occasion_id = ${occasionId} and r.attending = 'yes'
          and not exists (select 1 from check_ins c where c.household_id = r.household_id and c.voided_at is null))::int as not_yet_households,
      (select min(c.arrived_at) from check_ins c where c.occasion_id = ${occasionId} and c.voided_at is null) as first_at,
      (select max(c.arrived_at) from check_ins c where c.occasion_id = ${occasionId} and c.voided_at is null) as last_at
  `);
  const row = (res.rows[0] ?? {}) as Record<string, unknown>;
  const date = (v: unknown) => (v === null || v === undefined ? null : new Date(v as string));
  return {
    expectedHouseholds: Number(row.expected_households ?? 0),
    expectedPeople: Number(row.expected_people ?? 0),
    arrivedHouseholds: Number(row.arrived_households ?? 0),
    arrivedPeople: Number(row.arrived_people ?? 0),
    notYetHouseholds: Number(row.not_yet_households ?? 0),
    firstArrivalAt: date(row.first_at),
    lastArrivalAt: date(row.last_at),
  };
}

export type FlowBucket = { start: Date; households: number; people: number };
export type FlowProjection =
  | { status: "unknown" } // not enough arrivals yet to say anything
  | { status: "reached"; share: number } // most guests are already here
  | { status: "estimate"; at: Date; perHour: number; share: number };

export type GuestFlow = {
  summary: ArrivalSummary;
  bucketMinutes: 15 | 30;
  buckets: FlowBucket[];
  projection: FlowProjection;
};

/** "Most guests" = this share of the people expected. */
export const FLOW_MOST_SHARE = 0.9;
/** Fewer arrivals than this in the rate window → "necunoscut". */
export const FLOW_MIN_ARRIVALS = 5;
const RATE_WINDOW_MINUTES = 30;

/**
 * Pure. A simple rate projection: people arriving per minute over the last 30 minutes carried
 * forward until 90% of the expected people are in. Never projects past the people expected;
 * says "unknown" until there is enough to go on.
 */
export function projectFlow(summary: Pick<ArrivalSummary, "expectedPeople" | "arrivedPeople">, recent: { people: number; households: number }, now: Date): FlowProjection {
  if (summary.expectedPeople <= 0) return { status: "unknown" };
  const target = Math.ceil(summary.expectedPeople * FLOW_MOST_SHARE);
  const share = Math.min(1, summary.arrivedPeople / summary.expectedPeople);
  if (summary.arrivedPeople >= target) return { status: "reached", share };
  if (recent.households < FLOW_MIN_ARRIVALS || recent.people <= 0) return { status: "unknown" };
  const perMinute = recent.people / RATE_WINDOW_MINUTES;
  const minutes = Math.ceil((target - summary.arrivedPeople) / perMinute);
  if (!Number.isFinite(minutes) || minutes > 24 * 60) return { status: "unknown" };
  return { status: "estimate", at: new Date(now.getTime() + minutes * 60_000), perHour: Math.round(perMinute * 60), share };
}

/** Expected, arrived, not yet, arrivals per 15/30-minute bucket and the projection (planning members). */
export async function getGuestFlow(ctx: Ctx, occasionId: string, opts: { bucketMinutes?: 15 | 30 } = {}): Promise<GuestFlow> {
  const id = idSchema.parse(occasionId);
  await requireDoor(ctx, id);
  const bucketMinutes = opts.bucketMinutes === 30 ? 30 : 15;
  const seconds = bucketMinutes * 60;
  const since = new Date(ctx.now.getTime() - RATE_WINDOW_MINUTES * 60_000);
  const [summary, buckets, recent] = await Promise.all([
    readArrivalSummaryUnchecked(ctx, id),
    ctx.db.execute(sql`
      select to_timestamp(floor(extract(epoch from c.arrived_at) / ${seconds}) * ${seconds}) as start,
             count(*)::int as households,
             coalesce(sum(c.adults_arrived + c.children_arrived), 0)::int as people
      from check_ins c
      where c.occasion_id = ${id} and c.voided_at is null
      group by 1 order by 1
      limit 400`),
    ctx.db.execute(sql`
      select count(*)::int as households, coalesce(sum(c.adults_arrived + c.children_arrived), 0)::int as people
      from check_ins c
      where c.occasion_id = ${id} and c.voided_at is null and c.arrived_at > ${since.toISOString()}::timestamptz and c.arrived_at <= ${ctx.now.toISOString()}::timestamptz`),
  ]);
  const r = (recent.rows[0] ?? {}) as Record<string, unknown>;
  return {
    summary,
    bucketMinutes,
    buckets: (buckets.rows as Array<Record<string, unknown>>).map((b) => ({ start: new Date(b.start as string), households: Number(b.households), people: Number(b.people) })),
    projection: projectFlow(summary, { people: Number(r.people ?? 0), households: Number(r.households ?? 0) }, ctx.now),
  };
}

/* ── Purge, export ──────────────────────────────────────────────────────── */

onOccasionPurge(async (tx, occasionId) => {
  // arrivals are facts: the purge transaction says so before the rows go
  await tx.db.execute(sql`select set_config('ed.purge', 'on', true)`);
  await tx.db.delete(checkIns).where(eq(checkIns.occasionId, occasionId));
});

registerExport({
  key: "arrivals",
  titleKey: "operate.exports.arrivals",
  descriptionKey: "operate.exports.arrivalsDescription",
  manageOnly: true,
  run: async (ctx, occasionId, member) => {
    if (!isManager(member)) throw new AppError("FORBIDDEN", "common.errors.FORBIDDEN");
    const roster = await getCheckInRoster(ctx, occasionId);
    const ro = ctx.locale !== "en";
    const head = ro ? ["Familie", "Răspuns", "Adulți așteptați", "Copii așteptați", "Sosit", "Adulți sosiți", "Copii sosiți", "Ora sosirii (UTC)"] : ["Household", "RSVP", "Adults expected", "Children expected", "Arrived", "Adults arrived", "Children arrived", "Arrival time (UTC)"];
    const yes = ro ? "da" : "yes";
    const no = ro ? "nu" : "no";
    const rows = roster.rows.map((r) => [r.name, r.rsvp, r.expectedAdults, r.expectedChildren, r.arrived ? yes : no, r.arrived?.adults ?? "", r.arrived?.children ?? "", r.arrived?.at ?? ""]);
    return { filename: ro ? "sosiri.csv" : "arrivals.csv", mime: "text/csv; charset=utf-8", content: toCsv(head, rows) };
  },
});
