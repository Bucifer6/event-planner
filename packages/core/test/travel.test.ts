import { accounts, activities, auditLog, eq, guests, households, itineraryLegs, occasionMembers, occasions, packingLists, roomAssignments, rooms, taskCheckItems, tasks, transportLegs, whatifPreviews } from "@ed/db";
import { setupTestDb, type TestDb } from "@ed/db/testing";
import { isAppError } from "@ed/shared/errors";
import { formatInZone } from "@ed/i18n/format";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accountCtx, type Ctx } from "../src/context";
import { listExports, runExport } from "../src/exports";
import { createLeg, getItinerary, instantToLocal, ITINERARY_IMPORT_KIND, localToInstant, offsetMinutes, parseBooking, parseConfirmationText, parseIcs, proposeItineraryImport, updateLeg } from "../src/itinerary";
import { addLedgerEntry, addParticipant } from "../src/ledger";
import { addPackingItem, createPackingList, listPackingLists, setPackingItem } from "../src/packing";
import { assignRoom, createRoom, getRooming, unassignRoom, updateRoom } from "../src/rooms";
import { createActivity, createSubgroup, getSubgroup, getTripSettlement, listActivities, listPeople, listSubgroups, optInActivity, optOutActivity, setExchangeNote, setSubgroupPeople } from "../src/subgroups";
import { getTask, queryTasks } from "../src/tasks";
import { claimSeat, createTransportLeg, listTransport, setTransportPeople } from "../src/transport";
import { confirmPreview, discardPreview } from "../src/whatif";

let t: TestDb;
const OWNER = "acc_owner_tr";
const ANA = "acc_ana_tr"; // contributor, in subgroup A
const BOGDAN = "acc_bogdan_tr"; // contributor, in no subgroup
const GUESTY = "acc_guest_tr"; // role guest, no finance grant
const OUTSIDER = "acc_outsider_tr";
const NOW = new Date("2027-07-01T09:00:00Z");
let seq = 0;

beforeAll(async () => {
  t = await setupTestDb();
  await t.db.insert(accounts).values(
    [OWNER, ANA, BOGDAN, GUESTY, OUTSIDER].map((id) => ({ id, kind: "email" as const, email: `${id}@example.test`, displayName: id.replace("acc_", "").replace("_tr", "") })),
  );
});
afterAll(async () => {
  await t.close();
});

const as = (accountId: string, now: Date = NOW): Ctx => accountCtx(t.db, accountId, { now });
const owner = () => as(OWNER);

async function newTrip(): Promise<{ id: string; members: Record<string, string> }> {
  const id = `octr${++seq}aaaaaa`;
  await t.db.insert(occasions).values({ id, ownerAccountId: OWNER, title: "City break la Lisabona", kind: "voiaj_grup", startsAt: new Date("2027-07-14T09:00:00Z"), endsAt: new Date("2027-07-18T09:00:00Z"), dateMode: "range" });
  const rows = await t.db
    .insert(occasionMembers)
    .values([
      { occasionId: id, accountId: OWNER, role: "owner" },
      { occasionId: id, accountId: ANA, role: "contributor" },
      { occasionId: id, accountId: BOGDAN, role: "contributor" },
      { occasionId: id, accountId: GUESTY, role: "guest" },
    ])
    .returning();
  return { id, members: Object.fromEntries(rows.map((r) => [r.accountId!, r.id])) };
}

async function code(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (e) {
    return isAppError(e) ? e.code : `THROWN:${String(e)}`;
  }
  return "OK";
}

async function household(occasionId: string, name: string, people: string[]): Promise<string> {
  const [h] = await t.db.insert(households).values({ occasionId, name }).returning();
  if (people.length) await t.db.insert(guests).values(people.map((fullName) => ({ occasionId, householdId: h!.id, fullName })));
  return h!.id;
}

describe("D-01 itinerary across time zones", () => {
  it("stores UTC and shows the trip zone and Bucharest; a flight can land 'before' it departs", async () => {
    const trip = await newTrip();
    // Bucharest 08:05 (UTC+3) → London 09:40 (UTC+1): 3h35 in the air
    await createLeg(owner(), { occasionId: trip.id, kind: "flight", title: "RO 391 București → Londra", startsLocal: "2027-07-14T08:05", startTz: "Europe/Bucharest", endsLocal: "2027-07-14T09:40", endTz: "Europe/London", reference: "ABC123" });
    // Lisbon 23:30 → Ponta Delgada (Azores, one hour behind) 00:45 next day is plain; the
    // reverse of a westbound hop lands "earlier" on the clock: Madrid 10:00 → Lisbon 09:15
    await createLeg(owner(), { occasionId: trip.id, kind: "flight", title: "TP 1023 Madrid → Lisabona", startsLocal: "2027-07-15T10:00", startTz: "Europe/Madrid", endsLocal: "2027-07-15T10:15", endTz: "Europe/Lisbon" });
    await createLeg(owner(), { occasionId: trip.id, kind: "flight", title: "Hop spre vest", startsLocal: "2027-07-16T10:00", startTz: "Europe/Madrid", endsLocal: "2027-07-16T09:50", endTz: "Atlantic/Azores" });
    const it = await getItinerary(owner(), trip.id);
    expect(it.legs.map((l) => l.title)).toEqual(["RO 391 București → Londra", "TP 1023 Madrid → Lisabona", "Hop spre vest"]);
    const [ro, tp, hop] = it.legs;
    expect(ro!.startsAt.toISOString()).toBe("2027-07-14T05:05:00.000Z");
    expect(ro!.endsAt!.toISOString()).toBe("2027-07-14T08:40:00.000Z");
    expect(ro!.durationMinutes).toBe(215);
    expect(formatInZone(ro!.endsAt!, ro!.endTz, "ro")).toBe("14.07.2027, 09:40");
    expect(formatInZone(ro!.endsAt!, "Europe/Bucharest", "ro")).toBe("14.07.2027, 11:40");
    expect(tp!.durationMinutes).toBe(75);
    expect(tp!.arrivesBeforeLocalDeparture).toBe(false);
    // local clocks: leaves 10:00, lands 09:50 — yet it is 110 real minutes
    expect(hop!.arrivesBeforeLocalDeparture).toBe(true);
    expect(hop!.durationMinutes).toBe(110);
    expect(it.next?.title).toBe("RO 391 București → Londra");
  });

  it("is right across the March and October DST changes", () => {
    // Romania 2027: clocks go forward on 28 March (03:00 → 04:00), back on 31 October (04:00 → 03:00)
    const before = localToInstant("2027-03-27T12:00", "Europe/Bucharest")!;
    const after = localToInstant("2027-03-28T12:00", "Europe/Bucharest")!;
    expect(before.toISOString()).toBe("2027-03-27T10:00:00.000Z");
    expect(after.toISOString()).toBe("2027-03-28T09:00:00.000Z");
    expect((after.getTime() - before.getTime()) / 3_600_000).toBe(23); // a 23-hour day
    expect(offsetMinutes(before, "Europe/Bucharest")).toBe(120);
    expect(offsetMinutes(after, "Europe/Bucharest")).toBe(180);
    const oct1 = localToInstant("2027-10-30T12:00", "Europe/Bucharest")!;
    const oct2 = localToInstant("2027-10-31T12:00", "Europe/Bucharest")!;
    expect((oct2.getTime() - oct1.getTime()) / 3_600_000).toBe(25); // a 25-hour day
    // a night train over the spring change: leaves 23:00, arrives 07:00 — 7 hours, not 8
    const dep = localToInstant("2027-03-27T23:00", "Europe/Bucharest")!;
    const arr = localToInstant("2027-03-28T07:00", "Europe/Bucharest")!;
    expect((arr.getTime() - dep.getTime()) / 3_600_000).toBe(7);
    // round trip of the display helpers on both sides of the changes
    for (const local of ["2027-03-28T04:30", "2027-10-31T02:30", "2027-10-31T05:00", "2027-03-28T01:59"]) {
      expect(instantToLocal(localToInstant(local, "Europe/Bucharest")!, "Europe/Bucharest")).toBe(local);
    }
    // the US changes on different dates (14 March / 7 November 2027): on 20 March New York is
    // already on summer time while Bucharest is not → 6 hours apart instead of 7
    const ny = localToInstant("2027-03-20T12:00", "America/New_York")!;
    expect(formatInZone(ny, "Europe/Bucharest", "ro")).toBe("20.03.2027, 18:00");
    const nyApril = localToInstant("2027-04-20T12:00", "America/New_York")!;
    expect(formatInZone(nyApril, "Europe/Bucharest", "ro")).toBe("20.04.2027, 19:00");
  });

  it("validates zones and order as instants, and keeps subgroup legs private", async () => {
    const trip = await newTrip();
    expect(await code(() => createLeg(owner(), { occasionId: trip.id, title: "X", startsLocal: "2027-07-14T10:00", startTz: "Mars/Olympus" }))).not.toBe("OK");
    expect(await code(() => createLeg(owner(), { occasionId: trip.id, title: "X", startsLocal: "2027-07-14T10:00", startTz: "Europe/Lisbon", endsLocal: "2027-07-14T09:00", endTz: "Europe/Lisbon" }))).toBe("VALIDATION");
    // 11:00 Bucharest is BEFORE 10:00 Lisbon as an instant → refused although the clock reads later
    expect(await code(() => createLeg(owner(), { occasionId: trip.id, title: "X", startsLocal: "2027-07-14T10:00", startTz: "Europe/Lisbon", endsLocal: "2027-07-14T11:00", endTz: "Europe/Bucharest" }))).toBe("VALIDATION");
    const { subgroupId } = await createSubgroup(owner(), { occasionId: trip.id, name: "Surferii", leadMemberId: trip.members[ANA] });
    await createLeg(owner(), { occasionId: trip.id, title: "Transfer Ericeira", startsLocal: "2027-07-15T07:00", startTz: "Europe/Lisbon", subgroupId });
    expect((await getItinerary(as(ANA), trip.id)).legs).toHaveLength(1);
    expect((await getItinerary(as(BOGDAN), trip.id)).legs).toHaveLength(0);
    expect(await code(() => getItinerary(as(OUTSIDER), trip.id))).toBe("NOT_FOUND");
    // contributors cannot add whole-trip legs; the subgroup's lead may edit her group's leg
    expect(await code(() => createLeg(as(BOGDAN), { occasionId: trip.id, title: "Y", startsLocal: "2027-07-15T07:00", startTz: "Europe/Lisbon" }))).toBe("FORBIDDEN");
    const leg = (await getItinerary(as(ANA), trip.id)).legs[0]!;
    expect(leg.canEdit).toBe(true);
    await updateLeg(as(ANA), { legId: leg.id, title: "Transfer Ericeira (7:30)", startsLocal: "2027-07-15T07:30", startTz: "Europe/Lisbon", subgroupId });
    expect((await getItinerary(owner(), trip.id)).legs[0]!.startsAt.toISOString()).toBe("2027-07-15T06:30:00.000Z");
  });
});

const ICS = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "BEGIN:VEVENT",
  "UID:flight-1@example",
  "SUMMARY:Flight RO 391 Bucharest - London",
  "DTSTART;TZID=Europe/Bucharest:20270714T080500",
  "DTEND;TZID=Europe/London:20270714T094000",
  "LOCATION:Henri Coandă (OTP)",
  "DESCRIPTION:Booking reference: ABC123\\nSeat 12A, a very long line that is folded",
  "  over two lines",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:hotel-1@example",
  "SUMMARY:Hotel Alfama\\, Lisboa",
  "DTSTART;VALUE=DATE:20270714",
  "DTEND;VALUE=DATE:20270718",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:utc-1@example",
  "SUMMARY:Tur ghidat",
  "DTSTART:20270715T090000Z",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "SUMMARY:Fără dată",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

describe("D-01 booking import the user confirms", () => {
  it("parses .ics tolerantly and never invents", () => {
    const { candidates, skipped } = parseIcs(ICS, "Europe/Lisbon");
    expect(skipped).toBe(1);
    expect(candidates).toHaveLength(3);
    const [flight, hotel, tour] = candidates;
    expect(flight).toMatchObject({ kind: "flight", title: "Flight RO 391 Bucharest - London", startsAt: "2027-07-14T05:05:00.000Z", endsAt: "2027-07-14T08:40:00.000Z", startTz: "Europe/Bucharest", endTz: "Europe/London", reference: "ABC123", importKey: "ics:flight-1@example", placeFrom: "Henri Coandă (OTP)" });
    expect(flight!.missing).toEqual([]);
    expect(hotel).toMatchObject({ kind: "stay", title: "Hotel Alfama, Lisboa", startTz: "Europe/Lisbon" });
    expect(hotel!.missing).toContain("zone");
    expect(tour).toMatchObject({ startsAt: "2027-07-15T09:00:00.000Z", endsAt: null });
    expect(tour!.missing).toEqual(expect.arrayContaining(["endsAt", "place"]));
    expect(parseIcs("BEGIN:VCALENDAR\nBEGIN:VEVENT\nDTSTART:garbage\nEND:VEVENT\nnonsense", "UTC")).toEqual({ candidates: [], skipped: 1 });
  });

  it("reads only what is reliable from a pasted confirmation", () => {
    const text = `Bună, Ioana!\nRezervarea ta este confirmată. Cod rezervare: XK4P9Q\n\nZbor W6 3001  OTP → LIS\n14.07.2027  06:10 – 09:25\n\nZbor W6 3002  LIS → OTP\n18 iulie 2027, 10:05\nTotal plătit: 1.245,50 RON`;
    const { candidates } = parseConfirmationText(text, "Europe/Bucharest");
    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toMatchObject({ kind: "flight", title: "W6 3001", placeFrom: "OTP", placeTo: "LIS", reference: "XK4P9Q", startsAt: "2027-07-14T03:10:00.000Z", endsAt: "2027-07-14T06:25:00.000Z", importKey: "flight:W63001:2027-07-14" });
    // zones cannot be known from such a text: flagged for the person, not guessed
    expect(candidates[0]!.missing).toContain("zone");
    expect(candidates[1]).toMatchObject({ title: "W6 3002", startsAt: "2027-07-18T07:05:00.000Z", endsAt: null });
    expect(candidates[1]!.missing).toContain("endsAt");
    expect(parseConfirmationText("Mulțumim pentru comandă! Total 45,00 RON.", "Europe/Bucharest").candidates).toEqual([]);
    expect(parseBooking(ICS).candidates).toHaveLength(3);
  });

  it("applies nothing while pending, nothing on discard, once on confirm; re-import detects duplicates", async () => {
    const trip = await newTrip();
    const count = async () => (await t.db.select().from(itineraryLegs).where(eq(itineraryLegs.occasionId, trip.id))).length;
    expect(await code(() => proposeItineraryImport(as(BOGDAN), { occasionId: trip.id, text: ICS }))).toBe("FORBIDDEN");
    expect(await code(() => proposeItineraryImport(owner(), { occasionId: trip.id, text: "nimic util aici" }))).toBe("VALIDATION");

    const discarded = await proposeItineraryImport(owner(), { occasionId: trip.id, text: ICS, defaultTz: "Europe/Lisbon" });
    expect(discarded.kind).toBe(ITINERARY_IMPORT_KIND);
    expect(discarded.delta.filter((d) => d.kindLabelKey === "travel.import.create")).toHaveLength(3);
    expect(await count()).toBe(0); // pending: nothing applied
    await discardPreview(owner(), discarded.id);
    expect(await count()).toBe(0); // discard: no-op
    expect(await code(() => confirmPreview(owner(), discarded.id))).not.toBe("OK");

    const preview = await proposeItineraryImport(owner(), { occasionId: trip.id, text: ICS, defaultTz: "Europe/Lisbon" });
    expect(await count()).toBe(0);
    expect(await code(() => confirmPreview(as(BOGDAN), preview.id))).toBe("FORBIDDEN");
    const first = await confirmPreview(owner(), preview.id);
    expect(first.appliedNow).toBe(true);
    expect(await count()).toBe(3);
    const again = await confirmPreview(owner(), preview.id); // double tap (Q4)
    expect(again.appliedNow).toBe(false);
    expect(await count()).toBe(3);

    // the same file again: every event is recognised (ICS UID / booking code) and skipped
    const dup = await proposeItineraryImport(owner(), { occasionId: trip.id, text: ICS, defaultTz: "Europe/Lisbon" });
    expect(dup.delta.filter((d) => d.kindLabelKey === "travel.import.skip")).toHaveLength(4); // 3 duplicates + the unreadable line
    expect(dup.delta.some((d) => d.kindLabelKey === "travel.import.create")).toBe(false);
    await confirmPreview(owner(), dup.id);
    expect(await count()).toBe(3);

    // the airline moved the flight: same booking, new time → a CHANGE, not a second leg
    const moved = await proposeItineraryImport(owner(), { occasionId: trip.id, text: ICS.replace("20270714T080500", "20270714T091500").replace("20270714T094000", "20270714T105000"), defaultTz: "Europe/Lisbon" });
    const change = moved.delta.find((d) => d.kindLabelKey === "travel.import.change");
    expect(change?.before).toContain("08:05");
    expect(change?.after).toContain("09:15");
    await confirmPreview(owner(), moved.id);
    expect(await count()).toBe(3);
    const legs = (await getItinerary(owner(), trip.id)).legs;
    expect(legs.find((l) => l.reference === "ABC123")!.startsAt.toISOString()).toBe("2027-07-14T06:15:00.000Z");
    expect((await t.db.select().from(whatifPreviews).where(eq(whatifPreviews.occasionId, trip.id))).length).toBe(4);
  });
});

describe("D-02 subgroups and optional activities", () => {
  it("scopes subgroup views (matrix): own subgroup yes, managers all, other members FORBIDDEN, outsiders nothing", async () => {
    const trip = await newTrip();
    const a = await createSubgroup(owner(), { occasionId: trip.id, name: "Grupul A" });
    const b = await createSubgroup(owner(), { occasionId: trip.id, name: "Grupul B" });
    const hh = await household(trip.id, "Familia Ionescu", ["Maria Ionescu", "Dan Ionescu"]);
    await setSubgroupPeople(owner(), { subgroupId: a.subgroupId, personKeys: [`m:${trip.members[ANA]}`, `h:${hh}`] });
    await setSubgroupPeople(owner(), { subgroupId: b.subgroupId, personKeys: [`m:${trip.members[GUESTY]}`] });

    const matrix: Array<[string, string, string]> = [];
    for (const who of [OWNER, ANA, BOGDAN, GUESTY, OUTSIDER]) {
      matrix.push([who, await code(() => getSubgroup(as(who), a.subgroupId)), await code(() => getSubgroup(as(who), b.subgroupId))]);
    }
    expect(matrix).toEqual([
      [OWNER, "OK", "OK"],
      [ANA, "OK", "FORBIDDEN"],
      [BOGDAN, "FORBIDDEN", "FORBIDDEN"],
      [GUESTY, "FORBIDDEN", "OK"],
      [OUTSIDER, "NOT_FOUND", "NOT_FOUND"],
    ]);
    expect((await listSubgroups(owner(), trip.id)).map((g) => g.name)).toEqual(["Grupul A", "Grupul B"]);
    expect((await listSubgroups(as(ANA), trip.id)).map((g) => g.name)).toEqual(["Grupul A"]);
    expect(await listSubgroups(as(BOGDAN), trip.id)).toEqual([]);
    expect(await code(() => listSubgroups(as(OUTSIDER), trip.id))).toBe("NOT_FOUND");
    expect((await getSubgroup(as(ANA), a.subgroupId)).people.map((p) => p.label).sort()).toEqual(["Familia Ionescu", "ana"]);
    // only trip planners shape groups or read the guest list
    expect(await code(() => setSubgroupPeople(as(ANA), { subgroupId: a.subgroupId, personKeys: [] }))).toBe("FORBIDDEN");
    expect(await code(() => listPeople(as(ANA), trip.id))).toBe("FORBIDDEN");
    expect(await code(() => setSubgroupPeople(owner(), { subgroupId: a.subgroupId, personKeys: ["h:doesnotexist"] }))).toBe("VALIDATION");

    // activities follow the same scope
    await createActivity(owner(), { occasionId: trip.id, title: "Lecție de surf", subgroupId: a.subgroupId, capacity: 4 });
    await createActivity(owner(), { occasionId: trip.id, title: "Cină fado" });
    expect((await listActivities(as(ANA), trip.id)).map((x) => x.title).sort()).toEqual(["Cină fado", "Lecție de surf"]);
    expect((await listActivities(as(BOGDAN), trip.id)).map((x) => x.title)).toEqual(["Cină fado"]);
    const surf = (await listActivities(owner(), trip.id)).find((x) => x.title === "Lecție de surf")!;
    expect(await code(() => optInActivity(as(BOGDAN), { activityId: surf.id }))).toBe("FORBIDDEN");
    expect(await code(() => optInActivity(as(OUTSIDER), { activityId: surf.id }))).toBe("NOT_FOUND");
  });

  it("opt-in is atomic and idempotent; unknown cost stays unknown", async () => {
    const trip = await newTrip();
    const { activityId } = await createActivity(owner(), { occasionId: trip.id, title: "Tur cu tramvaiul 28", capacity: 1, startsAt: "2027-07-15T08:00:00Z", tz: "Europe/Lisbon" });
    // two people go for the last place at the same time: exactly one wins
    const results = await Promise.all([code(() => optInActivity(as(ANA), { activityId })), code(() => optInActivity(as(BOGDAN), { activityId }))]);
    expect(results.sort()).toEqual(["OK", "TAKEN"]);
    const [row] = await t.db.select().from(activities).where(eq(activities.id, activityId));
    expect(row!.taken).toBe(1);
    const seen = await listActivities(owner(), trip.id);
    expect(seen[0]!.people).toHaveLength(1);
    expect(seen[0]!.costMinor).toBeNull(); // unknown, never 0
    expect(seen[0]!.left).toBe(0);
    const holder = seen[0]!.people[0]!.key === `m:${trip.members[ANA]}` ? ANA : BOGDAN;
    // double tap by the holder: applied once
    expect(await optInActivity(as(holder), { activityId })).toMatchObject({ already: true });
    expect((await t.db.select().from(activities).where(eq(activities.id, activityId)))[0]!.taken).toBe(1);
    await optOutActivity(as(holder), { activityId });
    await optOutActivity(as(holder), { activityId });
    expect((await t.db.select().from(activities).where(eq(activities.id, activityId)))[0]!.taken).toBe(0);
  });
});

describe("D-03 packing lists reuse the task checklist", () => {
  it("a packing list is a task with check items — no second store", async () => {
    const trip = await newTrip();
    const { taskId } = await createPackingList(as(ANA), { occasionId: trip.id, title: "Bagajul meu", scope: "personal", template: "city" });
    const [flag] = await t.db.select().from(packingLists).where(eq(packingLists.taskId, taskId));
    expect(flag).toMatchObject({ scope: "personal", memberId: trip.members[ANA] });
    const items = await t.db.select().from(taskCheckItems).where(eq(taskCheckItems.taskId, taskId));
    expect(items.length).toBeGreaterThanOrEqual(6);
    expect(items[0]!.label).toBe("Act de identitate sau pașaport");
    // the SAME rows through the task API: the Tasks views count them
    const detail = await getTask(as(ANA), taskId);
    expect(detail.task.title).toBe("Bagajul meu");
    const lists = await listPackingLists(as(ANA), trip.id);
    expect(lists).toHaveLength(1);
    await setPackingItem(as(ANA), { itemId: lists[0]!.items[0]!.id, done: true });
    const row = (await queryTasks(as(ANA), trip.id, {})).rows.find((r) => r.id === taskId)!;
    expect(row.checklist).toEqual({ done: 1, total: items.length });
    const after = (await listPackingLists(as(ANA), trip.id))[0]!;
    expect(after.done).toBe(1);
    expect(after.items[0]!.revision).toBe(lists[0]!.items[0]!.revision + 1); // DB trigger bumps it
    // personal = private: nobody else sees it, the owner of the occasion included
    expect(await listPackingLists(owner(), trip.id)).toEqual([]);
    expect(await code(() => addPackingItem(owner(), { taskId, label: "Altceva" }))).toBe("NOT_FOUND");
    // shared lists: planners shape, everybody on the trip ticks; subgroup lists stay in the subgroup
    const shared = await createPackingList(owner(), { occasionId: trip.id, title: "Pentru toți", scope: "occasion", template: "mare" });
    expect(await code(() => createPackingList(as(BOGDAN), { occasionId: trip.id, title: "X", scope: "occasion" }))).toBe("FORBIDDEN");
    const g = await createSubgroup(owner(), { occasionId: trip.id, name: "Surferii", leadMemberId: trip.members[ANA] });
    await createPackingList(as(ANA), { occasionId: trip.id, title: "Echipament surf", scope: "subgroup", subgroupId: g.subgroupId });
    expect((await listPackingLists(as(BOGDAN), trip.id)).map((l) => l.title)).toEqual(["Pentru toți"]);
    expect((await listPackingLists(as(ANA), trip.id)).map((l) => l.title).sort()).toEqual(["Bagajul meu", "Echipament surf", "Pentru toți"]);
    const sharedItem = (await listPackingLists(as(BOGDAN), trip.id))[0]!.items[0]!;
    await setPackingItem(as(BOGDAN), { itemId: sharedItem.id, done: true });
    expect(await code(() => addPackingItem(as(BOGDAN), { taskId: shared.taskId, label: "Minge" }))).toBe("FORBIDDEN");
    expect(await code(() => listPackingLists(as(OUTSIDER), trip.id))).toBe("NOT_FOUND");
    // English starters for an English-speaking planner
    const en = await createPackingList(accountCtx(t.db, BOGDAN, { now: NOW, locale: "en" }), { occasionId: trip.id, title: "Festival", scope: "personal", template: "festival" });
    expect((await t.db.select().from(taskCheckItems).where(eq(taskCheckItems.taskId, en.taskId)))[0]!.label).toBe("Ticket or wristband");
    expect((await t.db.select().from(tasks).where(eq(tasks.id, en.taskId)))[0]!.ownerMemberId).toBe(trip.members[BOGDAN]);
  });
});

describe("D-04 transport legs and room allocation", () => {
  it("rooms: exactly one wins the last bed in parallel; over capacity is refused with TAKEN", async () => {
    const trip = await newTrip();
    const { roomId } = await createRoom(owner(), { occasionId: trip.id, name: "Camera 12", capacity: 2 });
    const h1 = await household(trip.id, "Popescu", ["Ion Popescu"]);
    const h2 = await household(trip.id, "Marin", ["Elena Marin"]);
    const h3 = await household(trip.id, "Stan", ["Vlad Stan"]);
    const people = await listPeople(owner(), trip.id);
    const guest = (name: string) => people.find((p) => p.label === name)!.key;
    await assignRoom(owner(), { roomId, personKeys: [guest("Ion Popescu")] });
    // one bed left; two planners place different people at the same instant
    await t.db.update(occasionMembers).set({ role: "pm" }).where(eq(occasionMembers.id, trip.members[ANA]!));
    const results = await Promise.all([
      code(() => assignRoom(owner(), { roomId, personKeys: [guest("Elena Marin")] })),
      code(() => assignRoom(as(ANA), { roomId, personKeys: [guest("Vlad Stan")] })),
    ]);
    expect(results.sort()).toEqual(["OK", "TAKEN"]);
    const [room] = await t.db.select().from(rooms).where(eq(rooms.id, roomId));
    expect(room!.occupants).toBe(2);
    expect((await t.db.select().from(roomAssignments).where(eq(roomAssignments.roomId, roomId))).length).toBe(2);
    // a whole household of two does not fit a room with no beds left — nothing stored
    const h4 = await household(trip.id, "Dobre", ["Ana Dobre", "Paul Dobre"]);
    let err: unknown;
    try {
      await assignRoom(owner(), { roomId, personKeys: [`h:${h4}`] });
    } catch (e) {
      err = e;
    }
    expect(isAppError(err) && err.code).toBe("TAKEN");
    expect(isAppError(err) && err.messageKey).toBe("travel.errors.roomFull");
    expect(isAppError(err) && err.details?.params).toMatchObject({ left: 0, need: 2 });
    // idempotent: placing someone already there changes nothing
    expect(await assignRoom(owner(), { roomId, personKeys: [guest("Ion Popescu")] })).toMatchObject({ placed: 0 });
    // moving frees the old bed in the same transaction
    const other = await createRoom(owner(), { occasionId: trip.id, name: "Camera 14", capacity: 3, priceMinor: 45000, currency: "EUR" });
    expect(await assignRoom(owner(), { roomId: other.roomId, personKeys: [guest("Ion Popescu"), `h:${h4}`] })).toMatchObject({ placed: 2, moved: 1, left: 0 });
    expect((await t.db.select().from(rooms).where(eq(rooms.id, roomId)))[0]!.occupants).toBe(1);
    expect(await code(() => updateRoom(owner(), { roomId: other.roomId, name: "Camera 14", capacity: 2 }))).toBe("VALIDATION");
    await unassignRoom(owner(), { roomId: other.roomId, personKey: `h:${h4}` });
    await unassignRoom(owner(), { roomId: other.roomId, personKey: `h:${h4}` });
    expect((await t.db.select().from(rooms).where(eq(rooms.id, other.roomId)))[0]!.occupants).toBe(1);
    // views: planners see names and price; a contributor sees how full, not who or how much
    const plan = await getRooming(owner(), trip.id);
    expect(plan.beds).toEqual({ total: 5, taken: 2 });
    expect(plan.rooms.find((r) => r.id === other.roomId)!.priceMinor).toBe(45000);
    const seenByBogdan = await getRooming(as(BOGDAN), trip.id);
    expect(seenByBogdan.rooms.every((r) => r.people.length === 0 && r.priceMinor === undefined)).toBe(true);
    expect(seenByBogdan.unplaced).toEqual([]);
    expect(await code(() => assignRoom(as(BOGDAN), { roomId, personKeys: [guest("Vlad Stan")] }))).toBe("FORBIDDEN");
    expect(await code(() => getRooming(as(OUTSIDER), trip.id))).toBe("NOT_FOUND");
    void h1;
    void h2;
    void h3;
    // rooming list CSV: managers only
    expect((await listExports(owner(), trip.id)).map((e) => e.key)).toEqual(expect.arrayContaining(["itinerary", "rooming-list"]));
    expect((await listExports(as(BOGDAN), trip.id)).map((e) => e.key)).not.toContain("rooming-list");
    const csv = await runExport(owner(), trip.id, "rooming-list");
    expect(csv.content).toContain("Camera 14");
    expect(await code(() => runExport(as(BOGDAN), trip.id, "rooming-list"))).toBe("FORBIDDEN");
  });

  it("transport: seats are claimed atomically; a household takes as many seats as it has people", async () => {
    const trip = await newTrip();
    const { transportLegId } = await createTransportLeg(owner(), { occasionId: trip.id, label: "Microbuz aeroport", departsLocal: "2027-07-14T10:30", tz: "Europe/Lisbon", placeFrom: "Aeroport LIS", placeTo: "Hotel Alfama", seats: 3 });
    const h = await household(trip.id, "Familia Radu", ["Ioana Radu", "Mihai Radu"]);
    expect(await setTransportPeople(owner(), { transportLegId, personKeys: [`h:${h}`] })).toEqual({ taken: 2, left: 1 });
    const results = await Promise.all([code(() => claimSeat(as(ANA), { transportLegId })), code(() => claimSeat(as(BOGDAN), { transportLegId }))]);
    expect(results.sort()).toEqual(["OK", "TAKEN"]);
    expect((await t.db.select().from(transportLegs).where(eq(transportLegs.id, transportLegId)))[0]!.taken).toBe(3);
    // the tick list is exact and atomic: adding one more than fits changes nothing
    const before = await listTransport(owner(), trip.id);
    expect(await code(() => setTransportPeople(owner(), { transportLegId, personKeys: [...before[0]!.people.map((p) => p.key), `m:${trip.members[GUESTY]}`] }))).toBe("TAKEN");
    expect((await listTransport(owner(), trip.id))[0]!.taken).toBe(3);
    expect(before[0]!.departsAt!.toISOString()).toBe("2027-07-14T09:30:00.000Z");
    // a member cannot place somebody else
    expect(await code(() => claimSeat(as(GUESTY), { transportLegId, personKey: `m:${trip.members[BOGDAN]}` }))).toBe("FORBIDDEN");
    // unknown seats stay unknown (never 0) and do not limit
    const car = await createTransportLeg(owner(), { occasionId: trip.id, label: "Mașina lui Bogdan" });
    await claimSeat(as(BOGDAN), { transportLegId: car.transportLegId });
    const view = (await listTransport(as(BOGDAN), trip.id)).find((v) => v.id === car.transportLegId)!;
    expect(view).toMatchObject({ seats: null, left: null, taken: 1, mine: true });
  });
});

describe("D-05 currencies and participant settlement", () => {
  it("keeps RON and EUR separate and shows people without the finance grant only their own line", async () => {
    const trip = await newTrip();
    const o = owner();
    const pOwner = await addParticipant(o, { occasionId: trip.id, kind: "member", memberId: trip.members[OWNER] });
    const pAna = await addParticipant(o, { occasionId: trip.id, kind: "member", memberId: trip.members[ANA] });
    const pGuest = await addParticipant(o, { occasionId: trip.id, kind: "member", memberId: trip.members[GUESTY] });
    const all = [pOwner.id, pAna.id, pGuest.id];
    await addLedgerEntry(o, { occasionId: trip.id, description: "Benzină până la aeroport", amountMinor: 30000, currency: "RON", paidByParticipantId: pOwner.id, occurredOn: "2027-07-14", split: { mode: "even", participantIds: all }, idempotencyKey: "tr-ron-0001" });
    await addLedgerEntry(o, { occasionId: trip.id, description: "Cină în Alfama", amountMinor: 12000, currency: "EUR", paidByParticipantId: pAna.id, occurredOn: "2027-07-14", split: { mode: "even", participantIds: all }, idempotencyKey: "tr-eur-0001" });
    await setExchangeNote(o, { occasionId: trip.id, currency: "EUR", note: "1 EUR ≈ 4,97 RON la casa de schimb" });

    const s = await getTripSettlement(o, trip.id);
    expect(s.scope).toBe("all");
    expect(s.currencies.map((c) => c.currency)).toEqual(["RON", "EUR"]);
    const ron = s.currencies[0]!;
    const eur = s.currencies[1]!;
    const line = (c: typeof ron, name: string) => c.lines.find((l) => l.name.includes(name))!;
    expect(line(ron, "owner")).toMatchObject({ paidMinor: 30000, owesMinor: 10000, netMinor: 20000, isMe: true });
    expect(line(ron, "ana")).toMatchObject({ paidMinor: 0, owesMinor: 10000, netMinor: -10000 });
    expect(line(eur, "ana")).toMatchObject({ paidMinor: 12000, owesMinor: 4000, netMinor: 8000 });
    expect(line(eur, "owner")).toMatchObject({ paidMinor: 0, owesMinor: 4000, netMinor: -4000 });
    // per currency the balances sum to zero and the transfers settle them — nothing crosses over
    for (const c of s.currencies) expect(c.lines.reduce((n, l) => n + l.netMinor, 0)).toBe(0);
    expect(ron.transfers.reduce((n, x) => n + x.amountMinor, 0)).toBe(20000);
    expect(eur.transfers.reduce((n, x) => n + x.amountMinor, 0)).toBe(8000);
    expect(ron.totalCostMinor).toBe(30000);
    expect(eur.totalCostMinor).toBe(12000);
    // the note is an annotation only: amounts are untouched and RON has none
    expect(eur.exchangeNote).toBe("1 EUR ≈ 4,97 RON la casa de schimb");
    expect(ron.exchangeNote).toBeNull();

    // no finance grant → own line only, per currency
    const own = await getTripSettlement(as(GUESTY), trip.id);
    expect(own.scope).toBe("own");
    expect(own.currencies.map((c) => [c.currency, c.lines.length, c.lines[0]!.netMinor, c.lines[0]!.paidMinor])).toEqual([
      ["RON", 1, -10000, undefined],
      ["EUR", 1, -4000, undefined],
    ]);
    const myName = own.participants[0]!.name;
    expect(own.currencies.every((c) => c.transfers.length > 0 && c.transfers.every((x) => x.from === myName || x.to === myName))).toBe(true);
    expect(own.currencies[0]!.totalCostMinor).toBeUndefined();
    expect((await getTripSettlement(as(BOGDAN), trip.id)).isParticipant).toBe(false);
    expect(await code(() => setExchangeNote(as(GUESTY), { occasionId: trip.id, currency: "EUR", note: "x" }))).toBe("FORBIDDEN");
    expect(await code(() => getTripSettlement(as(OUTSIDER), trip.id))).toBe("NOT_FOUND");
    await setExchangeNote(o, { occasionId: trip.id, currency: "EUR", note: "" });
    expect((await getTripSettlement(o, trip.id)).currencies[1]!.exchangeNote).toBeNull();
    expect((await t.db.select().from(auditLog)).length).toBeGreaterThan(0);
  });
});
