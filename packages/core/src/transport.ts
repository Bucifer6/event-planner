import { and, asc, eq, inArray, sql, transportLegs, transportSeats } from "@ed/db";
import { AppError } from "@ed/shared/errors";
import { zOptionalText, zText } from "@ed/shared/zod";
import { z } from "zod";
import { requireMember } from "./access";
import { audit } from "./audit";
import { requireWriteCapable, type Ctx } from "./context";
import { localToInstant } from "./itinerary";
import { assertOccasionWritable } from "./lifecycle";
import { onOccasionPurge } from "./occasions";
import { type LooseInput, canPlanTrip, listPeopleUnchecked, memberPersonKey, resolvePeople, TRIP_PLANNER_ROLES, zPersonKey, zTimeZone } from "./subgroups";
import { inTx } from "./tx";

// RELEASE D (D-04, transport): vehicles / transfers with a number of seats. Seats are claimed
// ATOMICALLY like RSVP capacity (A8): one conditional UPDATE on transport_legs.taken decides;
// the loser of the last seat gets TAKEN and holds nothing. A claim is idempotent per person.

export type TransportLeg = typeof transportLegs.$inferSelect;
const idSchema = z.string().min(1).max(64);
const blank = (v: unknown) => (v === "" || v === null ? undefined : v);

export type TransportView = {
  id: string;
  label: string;
  departsAt: Date | null;
  arrivesAt: Date | null;
  tz: string;
  placeFrom: string | null;
  placeTo: string | null;
  /** null = unknown. */
  seats: number | null;
  taken: number;
  left: number | null;
  notes: string | null;
  /** Trip planners see everyone; other members only their own seat. */
  people: Array<{ key: string; label: string; seats: number }>;
  mine: boolean;
  canManage: boolean;
};

/** NO access check (rehearsal, exports). */
export async function listTransportUnchecked(ctx: Ctx, occasionId: string): Promise<TransportLeg[]> {
  return ctx.db.select().from(transportLegs).where(eq(transportLegs.occasionId, occasionId)).orderBy(asc(transportLegs.departsAt), asc(transportLegs.createdAt));
}

export async function listTransport(ctx: Ctx, occasionId: string): Promise<TransportView[]> {
  const id = idSchema.parse(occasionId);
  const member = await requireMember(ctx, id);
  const rows = await listTransportUnchecked(ctx, id);
  if (rows.length === 0) return [];
  const [seats, people] = await Promise.all([
    ctx.db
      .select()
      .from(transportSeats)
      .where(
        inArray(
          transportSeats.transportLegId,
          rows.map((r) => r.id),
        ),
      ),
    listPeopleUnchecked(ctx, id),
  ]);
  const byKey = new Map(people.map((p) => [p.key, p.label]));
  const planner = canPlanTrip(member);
  const myKey = memberPersonKey(member);
  return rows.map((r) => {
    const own = seats.filter((s) => s.transportLegId === r.id);
    return {
      id: r.id,
      label: r.label,
      departsAt: r.departsAt,
      arrivesAt: r.arrivesAt,
      tz: r.tz,
      placeFrom: r.placeFrom,
      placeTo: r.placeTo,
      seats: r.seats,
      taken: r.taken,
      left: r.seats === null ? null : Math.max(0, r.seats - r.taken),
      notes: r.notes,
      people: own.filter((s) => planner || s.personKey === myKey).map((s) => ({ key: s.personKey, label: byKey.get(s.personKey) ?? "—", seats: s.seats })),
      mine: myKey !== null && own.some((s) => s.personKey === myKey),
      canManage: planner,
    };
  });
}

const createInput = z.object({
  occasionId: idSchema,
  label: zText(120),
  /** datetime-local values read in `tz`. */
  departsLocal: z.preprocess(blank, z.string().trim().max(25).optional()),
  arrivesLocal: z.preprocess(blank, z.string().trim().max(25).optional()),
  tz: zTimeZone.default("Europe/Bucharest"),
  placeFrom: zOptionalText(160),
  placeTo: zOptionalText(160),
  seats: z.preprocess((v) => (v === "" || v === null || v === undefined ? undefined : Number(v)), z.number("common.validation.invalid").int("common.validation.invalid").min(1, "common.validation.tooSmall").max(1000, "common.validation.tooBig").optional()),
  notes: zOptionalText(1000),
});

export async function createTransportLeg(ctx: Ctx, input: LooseInput<typeof createInput>): Promise<{ transportLegId: string }> {
  requireWriteCapable(ctx);
  const data = createInput.parse(input);
  await requireMember(ctx, data.occasionId, { roles: TRIP_PLANNER_ROLES });
  await assertOccasionWritable(ctx, data.occasionId);
  const at = (local: string | undefined, field: string) => {
    if (!local) return null;
    const d = localToInstant(local, data.tz);
    if (!d) throw new AppError("VALIDATION", "travel.errors.dateTime", { fieldErrors: { [field]: ["travel.errors.dateTime"] } });
    return d;
  };
  const departsAt = at(data.departsLocal, "departsLocal");
  const arrivesAt = at(data.arrivesLocal, "arrivesLocal");
  if (departsAt && arrivesAt && arrivesAt.getTime() < departsAt.getTime()) {
    throw new AppError("VALIDATION", "travel.errors.endBeforeStart", { fieldErrors: { arrivesLocal: ["travel.errors.endBeforeStart"] } });
  }
  const [row] = await ctx.db
    .insert(transportLegs)
    .values({ occasionId: data.occasionId, label: data.label, departsAt, arrivesAt, tz: data.tz, placeFrom: data.placeFrom ?? null, placeTo: data.placeTo ?? null, seats: data.seats ?? null, notes: data.notes ?? null, createdAt: ctx.now })
    .returning({ id: transportLegs.id });
  await audit(ctx, { action: "transport.leg_created", objectType: "transport_leg", objectId: row!.id, after: { label: data.label, seats: data.seats ?? null } });
  return { transportLegId: row!.id };
}

async function loadLeg(ctx: Ctx, transportLegId: string): Promise<TransportLeg> {
  const [row] = await ctx.db.select().from(transportLegs).where(eq(transportLegs.id, idSchema.parse(transportLegId)));
  if (!row) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  return row;
}

export async function deleteTransportLeg(ctx: Ctx, input: { transportLegId: string }): Promise<void> {
  requireWriteCapable(ctx);
  const leg = await loadLeg(ctx, input.transportLegId);
  await requireMember(ctx, leg.occasionId, { roles: TRIP_PLANNER_ROLES });
  await assertOccasionWritable(ctx, leg.occasionId);
  await ctx.db.delete(transportLegs).where(eq(transportLegs.id, leg.id));
  await audit(ctx, { action: "transport.leg_deleted", objectType: "transport_leg", objectId: leg.id, before: { label: leg.label } });
}

/**
 * Sets exactly who rides in the vehicle (tick list → "Rezervă locurile"). Only the DIFFERENCE
 * in seats moves, in one conditional UPDATE: over capacity → TAKEN, nothing changes.
 * A member may add or remove only themselves; trip planners place anyone.
 */
export async function setTransportPeople(ctx: Ctx, input: { transportLegId: string; personKeys: string[] }): Promise<{ taken: number; left: number | null }> {
  requireWriteCapable(ctx);
  const data = z.object({ transportLegId: idSchema, personKeys: z.array(zPersonKey).max(500) }).parse(input);
  const leg = await loadLeg(ctx, data.transportLegId);
  const member = await requireMember(ctx, leg.occasionId);
  await assertOccasionWritable(ctx, leg.occasionId);
  const wanted = [...new Set(data.personKeys)];
  const people = await resolvePeople(ctx, leg.occasionId, wanted);
  const planner = canPlanTrip(member);
  const myKey = memberPersonKey(member);
  return inTx(ctx, async (tx) => {
    // lock the vehicle row: concurrent tick lists for the same vehicle run one after the other
    await tx.db.select({ id: transportLegs.id }).from(transportLegs).where(eq(transportLegs.id, leg.id)).for("update");
    const current = await tx.db.select().from(transportSeats).where(eq(transportSeats.transportLegId, leg.id));
    const have = new Map(current.map((s) => [s.personKey, s]));
    const add = people.filter((p) => !have.has(p.key));
    const remove = planner ? current.filter((s) => !wanted.includes(s.personKey)) : current.filter((s) => s.personKey === myKey && !wanted.includes(s.personKey));
    if (!planner && (add.some((p) => p.key !== myKey) || wanted.some((k) => k !== myKey && !have.has(k)))) {
      throw new AppError("FORBIDDEN", "common.errors.FORBIDDEN");
    }
    const delta = add.reduce((n, p) => n + p.size, 0) - remove.reduce((n, s) => n + s.seats, 0);
    const where = delta > 0 ? and(eq(transportLegs.id, leg.id), sql`(${transportLegs.seats} IS NULL OR ${transportLegs.taken} + ${delta} <= ${transportLegs.seats})`) : eq(transportLegs.id, leg.id);
    const won = await tx.db
      .update(transportLegs)
      .set({ taken: sql`GREATEST(0, ${transportLegs.taken} + ${delta})` })
      .where(where)
      .returning({ seats: transportLegs.seats, taken: transportLegs.taken });
    if (!won[0]) {
      const [now] = await tx.db.select({ seats: transportLegs.seats, taken: transportLegs.taken }).from(transportLegs).where(eq(transportLegs.id, leg.id));
      const left = now?.seats == null ? 0 : Math.max(0, now.seats - now.taken);
      throw new AppError("TAKEN", "travel.errors.vehicleFull", { params: { left }, left });
    }
    if (remove.length > 0) {
      await tx.db.delete(transportSeats).where(
        inArray(
          transportSeats.id,
          remove.map((s) => s.id),
        ),
      );
    }
    if (add.length > 0) {
      await tx.db.insert(transportSeats).values(add.map((p) => ({ transportLegId: leg.id, occasionId: leg.occasionId, personKey: p.key, seats: p.size, createdAt: tx.now })));
    }
    if (add.length > 0 || remove.length > 0) {
      await audit(tx, { action: "transport.seats_set", objectType: "transport_leg", objectId: leg.id, after: { added: add.length, removed: remove.length, taken: won[0].taken } });
    }
    return { taken: won[0].taken, left: won[0].seats === null ? null : Math.max(0, won[0].seats - won[0].taken) };
  });
}

/** One person takes a seat. Idempotent per person (Q4); TAKEN when the vehicle is full. */
export async function claimSeat(ctx: Ctx, input: { transportLegId: string; personKey?: string }): Promise<{ already: boolean; left: number | null }> {
  requireWriteCapable(ctx);
  const data = z.object({ transportLegId: idSchema, personKey: zPersonKey.optional() }).parse(input);
  const leg = await loadLeg(ctx, data.transportLegId);
  const member = await requireMember(ctx, leg.occasionId);
  await assertOccasionWritable(ctx, leg.occasionId);
  const own = memberPersonKey(member);
  const key = data.personKey ?? own;
  if (!key || (key !== own && !canPlanTrip(member))) throw new AppError("FORBIDDEN", "common.errors.FORBIDDEN");
  const [person] = await resolvePeople(ctx, leg.occasionId, [key]);
  return inTx(ctx, async (tx) => {
    const inserted = await tx.db
      .insert(transportSeats)
      .values({ transportLegId: leg.id, occasionId: leg.occasionId, personKey: person!.key, seats: person!.size, createdAt: tx.now })
      .onConflictDoNothing({ target: [transportSeats.transportLegId, transportSeats.personKey] })
      .returning({ id: transportSeats.id });
    const read = async () => {
      const [now] = await tx.db.select({ seats: transportLegs.seats, taken: transportLegs.taken }).from(transportLegs).where(eq(transportLegs.id, leg.id));
      return now?.seats == null ? null : Math.max(0, now.seats - now.taken);
    };
    if (!inserted[0]) return { already: true, left: await read() };
    const won = await tx.db
      .update(transportLegs)
      .set({ taken: sql`${transportLegs.taken} + ${person!.size}` })
      .where(and(eq(transportLegs.id, leg.id), sql`(${transportLegs.seats} IS NULL OR ${transportLegs.taken} + ${person!.size} <= ${transportLegs.seats})`))
      .returning({ id: transportLegs.id });
    if (!won[0]) {
      const left = (await read()) ?? 0;
      throw new AppError("TAKEN", "travel.errors.vehicleFull", { params: { left }, left });
    }
    await audit(tx, { action: "transport.seat_claimed", objectType: "transport_leg", objectId: leg.id, after: { personKey: person!.key, seats: person!.size } });
    return { already: false, left: await read() };
  });
}

onOccasionPurge(async (tx, occasionId) => {
  await tx.db.delete(transportSeats).where(eq(transportSeats.occasionId, occasionId));
});
