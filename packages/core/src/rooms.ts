import { and, asc, eq, inArray, roomAssignments, rooms, sql } from "@ed/db";
import { AppError } from "@ed/shared/errors";
import { zCurrency, zOptionalText, zText } from "@ed/shared/zod";
import { z } from "zod";
import { isManager, requireMember } from "./access";
import { audit } from "./audit";
import { requireWriteCapable, type Ctx } from "./context";
import { registerExport, toCsv } from "./exports";
import { assertOccasionWritable } from "./lifecycle";
import { onOccasionPurge } from "./occasions";
import { type LooseInput, canPlanTrip, listPeopleUnchecked, memberPersonKey, resolvePeople, TRIP_PLANNER_ROLES, zPersonKey, type Person } from "./subgroups";
import { inTx } from "./tx";

// RELEASE D (D-04, rooms): rooms with a number of beds, and who sleeps where.
//
// ATOMIC like RSVP capacity (A8): beds are taken by ONE conditional UPDATE
//     UPDATE rooms SET occupants = occupants + n WHERE id = … AND occupants + n <= capacity
// and its row count decides. Two planners placing people in the last bed at the same moment:
// exactly one wins, the other gets TAKEN ("camera e plină") and nothing of theirs is stored.
// A person sleeps in one room: placing them elsewhere MOVES them (the old bed is freed in the
// same transaction). Tap path only: pick the room → tick people → "Cazează aici".

export type Room = typeof rooms.$inferSelect;
const idSchema = z.string().min(1).max(64);
const optInt = (min: number, max: number) =>
  z.preprocess((v) => (v === "" || v === null || v === undefined ? undefined : Number(v)), z.number("common.validation.invalid").int("common.validation.invalid").min(min, "common.validation.tooSmall").max(max, "common.validation.tooBig").optional());

export type RoomView = {
  id: string;
  name: string;
  capacity: number;
  occupants: number;
  left: number;
  notes: string | null;
  /** Per night; null = unknown; undefined = not shown to this member. */
  priceMinor: number | null | undefined;
  currency: string;
  people: Array<{ key: string; label: string; places: number }>;
  mine: boolean;
};

export type Rooming = {
  rooms: RoomView[];
  /** People without a bed yet (trip planners only; empty otherwise). */
  unplaced: Person[];
  beds: { total: number; taken: number };
  canManage: boolean;
};

/** NO access check (rehearsal). */
export async function listRoomsUnchecked(ctx: Ctx, occasionId: string): Promise<Array<Room & { assignments: Array<{ personKey: string; places: number }> }>> {
  const rows = await ctx.db.select().from(rooms).where(eq(rooms.occasionId, occasionId)).orderBy(asc(rooms.name), asc(rooms.createdAt));
  const links = rows.length ? await ctx.db.select().from(roomAssignments).where(eq(roomAssignments.occasionId, occasionId)) : [];
  return rows.map((r) => ({ ...r, assignments: links.filter((l) => l.roomId === r.id).map((l) => ({ personKey: l.personKey, places: l.places })) }));
}

/**
 * The rooming plan. Trip planners see every name; another member sees the rooms and how full
 * they are, and names only in their own room (D2).
 */
export async function getRooming(ctx: Ctx, occasionId: string): Promise<Rooming> {
  const id = idSchema.parse(occasionId);
  const member = await requireMember(ctx, id);
  const planner = canPlanTrip(member);
  const [rows, people] = await Promise.all([listRoomsUnchecked(ctx, id), listPeopleUnchecked(ctx, id)]);
  const byKey = new Map(people.map((p) => [p.key, p]));
  const myKey = memberPersonKey(member);
  const sizeOf = new Map(people.map((p) => [p.key, p.size]));
  const placed = new Set<string>();
  const householdsPlaced = new Set<string>();
  for (const r of rows) {
    for (const a of r.assignments) {
      placed.add(a.personKey);
      const p = byKey.get(a.personKey);
      if (p?.kind === "household") householdsPlaced.add(p.key);
    }
  }
  const view = rows.map((r) => {
    const mine = myKey !== null && r.assignments.some((a) => a.personKey === myKey);
    return {
      id: r.id,
      name: r.name,
      capacity: r.capacity,
      occupants: r.occupants,
      left: Math.max(0, r.capacity - r.occupants),
      notes: r.notes,
      priceMinor: planner ? r.priceMinor : undefined,
      currency: r.currency,
      people: planner || mine ? r.assignments.map((a) => ({ key: a.personKey, label: byKey.get(a.personKey)?.label ?? "—", places: a.places })) : [],
      mine,
    };
  });
  // A household placed as a whole covers its named guests; a guest placed alone leaves the household row out.
  const guestsPlacedBy = new Set(people.filter((p) => p.kind === "guest" && placed.has(p.key)).map((p) => `h:${p.householdId}`));
  const unplaced = planner
    ? people.filter((p) => {
        if (placed.has(p.key)) return false;
        // a household of one is offered once (as the household), not again as its only guest
        if (p.kind === "guest") return !householdsPlaced.has(`h:${p.householdId}`) && (sizeOf.get(`h:${p.householdId}`) ?? 0) > 1;
        if (p.kind === "household") return !guestsPlacedBy.has(p.key);
        return true;
      })
    : [];
  return {
    rooms: view,
    unplaced,
    beds: { total: rows.reduce((n, r) => n + r.capacity, 0), taken: rows.reduce((n, r) => n + r.occupants, 0) },
    canManage: planner,
  };
}

const roomFields = {
  name: zText(80),
  capacity: z.preprocess((v) => Number(v), z.number("common.validation.invalid").int("common.validation.invalid").min(1, "common.validation.tooSmall").max(500, "common.validation.tooBig")),
  notes: zOptionalText(1000),
  /** Minor units per night; absent = unknown. */
  priceMinor: optInt(0, 1_000_000_000),
  currency: zCurrency.optional(),
};

const createRoomInput = z.object({ occasionId: idSchema, ...roomFields });
const updateRoomInput = z.object({ roomId: idSchema, ...roomFields });

export async function createRoom(ctx: Ctx, input: LooseInput<typeof createRoomInput>): Promise<{ roomId: string }> {
  requireWriteCapable(ctx);
  const data = createRoomInput.parse(input);
  await requireMember(ctx, data.occasionId, { roles: TRIP_PLANNER_ROLES });
  await assertOccasionWritable(ctx, data.occasionId);
  const [row] = await ctx.db
    .insert(rooms)
    .values({ occasionId: data.occasionId, name: data.name, capacity: data.capacity, notes: data.notes ?? null, priceMinor: data.priceMinor ?? null, currency: data.currency ?? "RON", createdAt: ctx.now })
    .returning({ id: rooms.id });
  await audit(ctx, { action: "room.created", objectType: "room", objectId: row!.id, after: { name: data.name, capacity: data.capacity } });
  return { roomId: row!.id };
}

async function loadRoom(ctx: Ctx, roomId: string): Promise<Room> {
  const [row] = await ctx.db.select().from(rooms).where(eq(rooms.id, idSchema.parse(roomId)));
  if (!row) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  await requireMember(ctx, row.occasionId, { roles: TRIP_PLANNER_ROLES });
  await assertOccasionWritable(ctx, row.occasionId);
  return row;
}

/** Name, beds, note, price. Beds can never go below the people already placed. */
export async function updateRoom(ctx: Ctx, input: LooseInput<typeof updateRoomInput>): Promise<void> {
  requireWriteCapable(ctx);
  const data = updateRoomInput.parse(input);
  const room = await loadRoom(ctx, data.roomId);
  const done = await ctx.db
    .update(rooms)
    .set({ name: data.name, capacity: data.capacity, notes: data.notes ?? null, priceMinor: data.priceMinor ?? null, currency: data.currency ?? room.currency })
    .where(and(eq(rooms.id, room.id), sql`${rooms.occupants} <= ${data.capacity}`))
    .returning({ id: rooms.id });
  if (!done[0]) {
    throw new AppError("VALIDATION", "travel.errors.bedsBelowOccupants", { fieldErrors: { capacity: ["travel.errors.bedsBelowOccupants"] }, params: { occupants: room.occupants } });
  }
  await audit(ctx, { action: "room.updated", objectType: "room", objectId: room.id, before: { capacity: room.capacity }, after: { capacity: data.capacity } });
}

export async function deleteRoom(ctx: Ctx, input: { roomId: string }): Promise<void> {
  requireWriteCapable(ctx);
  const room = await loadRoom(ctx, input.roomId);
  await ctx.db.delete(rooms).where(eq(rooms.id, room.id));
  await audit(ctx, { action: "room.deleted", objectType: "room", objectId: room.id, before: { name: room.name } });
}

/**
 * "Cazează aici": places the ticked people in the room. People already in THIS room are left
 * alone (idempotent, Q4); people in another room are moved. Over capacity → TAKEN with the
 * number of beds left; nothing is stored and nobody is moved.
 */
export async function assignRoom(ctx: Ctx, input: { roomId: string; personKeys: string[] }): Promise<{ placed: number; moved: number; left: number }> {
  requireWriteCapable(ctx);
  const data = z.object({ roomId: idSchema, personKeys: z.array(zPersonKey).min(1, "travel.errors.pickPeople").max(200) }).parse(input);
  const room = await loadRoom(ctx, data.roomId);
  const people = await resolvePeople(ctx, room.occasionId, [...new Set(data.personKeys)]);
  try {
    return await inTx(ctx, async (tx) => {
      const existing = await tx.db
        .select()
        .from(roomAssignments)
        .where(
          and(
            eq(roomAssignments.occasionId, room.occasionId),
            inArray(
              roomAssignments.personKey,
              people.map((p) => p.key),
            ),
          ),
        );
      const here = new Set(existing.filter((e) => e.roomId === room.id).map((e) => e.personKey));
      const elsewhere = existing.filter((e) => e.roomId !== room.id);
      const incoming = people.filter((p) => !here.has(p.key));
      const need = incoming.reduce((n, p) => n + p.size, 0);
      if (need === 0) return { placed: 0, moved: 0, left: Math.max(0, room.capacity - room.occupants) };
      // THE atomic step: the row count of this conditional UPDATE decides who gets the beds
      const won = await tx.db
        .update(rooms)
        .set({ occupants: sql`${rooms.occupants} + ${need}` })
        .where(and(eq(rooms.id, room.id), sql`${rooms.occupants} + ${need} <= ${rooms.capacity}`))
        .returning({ capacity: rooms.capacity, occupants: rooms.occupants });
      if (!won[0]) {
        const [now] = await tx.db.select({ capacity: rooms.capacity, occupants: rooms.occupants }).from(rooms).where(eq(rooms.id, room.id));
        const left = now ? Math.max(0, now.capacity - now.occupants) : 0;
        throw new AppError("TAKEN", "travel.errors.roomFull", { params: { left, need }, left });
      }
      // free the beds the movers leave behind
      for (const e of elsewhere) {
        await tx.db.delete(roomAssignments).where(eq(roomAssignments.id, e.id));
        await tx.db
          .update(rooms)
          .set({ occupants: sql`GREATEST(0, ${rooms.occupants} - ${e.places})` })
          .where(eq(rooms.id, e.roomId));
      }
      await tx.db.insert(roomAssignments).values(incoming.map((p) => ({ roomId: room.id, occasionId: room.occasionId, personKey: p.key, places: p.size, createdAt: tx.now })));
      await audit(tx, { action: "room.assigned", objectType: "room", objectId: room.id, after: { placed: incoming.length, moved: elsewhere.length, occupants: won[0].occupants } });
      return { placed: incoming.length, moved: elsewhere.length, left: Math.max(0, won[0].capacity - won[0].occupants) };
    });
  } catch (e) {
    // the same person placed in two rooms at the same instant: the unique index stops the second
    if ((e as { code?: string })?.code === "23505" || (e as { cause?: { code?: string } })?.cause?.code === "23505") {
      throw new AppError("CONFLICT", "travel.errors.placedElsewhere");
    }
    throw e;
  }
}

/** Frees one person's bed. Idempotent. */
export async function unassignRoom(ctx: Ctx, input: { roomId: string; personKey: string }): Promise<void> {
  requireWriteCapable(ctx);
  const data = z.object({ roomId: idSchema, personKey: zPersonKey }).parse(input);
  const room = await loadRoom(ctx, data.roomId);
  await inTx(ctx, async (tx) => {
    const gone = await tx.db
      .delete(roomAssignments)
      .where(and(eq(roomAssignments.roomId, room.id), eq(roomAssignments.personKey, data.personKey)))
      .returning({ places: roomAssignments.places });
    if (!gone[0]) return;
    await tx.db
      .update(rooms)
      .set({ occupants: sql`GREATEST(0, ${rooms.occupants} - ${gone[0].places})` })
      .where(eq(rooms.id, room.id));
    await audit(tx, { action: "room.unassigned", objectType: "room", objectId: room.id, before: { personKey: data.personKey } });
  });
}

onOccasionPurge(async (tx, occasionId) => {
  await tx.db.delete(roomAssignments).where(eq(roomAssignments.occasionId, occasionId));
});

registerExport({
  key: "rooming-list",
  titleKey: "travel.exports.rooming",
  descriptionKey: "travel.exports.roomingDescription",
  manageOnly: true,
  run: async (ctx, occasionId, member) => {
    if (!isManager(member)) throw new AppError("FORBIDDEN", "common.errors.FORBIDDEN");
    const plan = await getRooming(ctx, occasionId);
    const ro = ctx.locale !== "en";
    const head = ro ? ["Cameră", "Paturi", "Ocupate", "Persoană", "Locuri", "Observații"] : ["Room", "Beds", "Taken", "Person", "Places", "Notes"];
    const rows: Array<Array<string | number | null>> = [];
    for (const r of plan.rooms) {
      if (r.people.length === 0) rows.push([r.name, r.capacity, r.occupants, "", "", r.notes]);
      for (const p of r.people) rows.push([r.name, r.capacity, r.occupants, p.label, p.places, r.notes]);
    }
    for (const p of plan.unplaced.filter((u) => u.kind !== "guest")) rows.push([ro ? "(fără cameră)" : "(no room)", "", "", p.label, p.size, ""]);
    return { filename: ro ? "lista-camere.csv" : "rooming-list.csv", mime: "text/csv; charset=utf-8", content: toCsv(head, rows) };
  },
});
