import {
  accounts,
  auditLog,
  bookingEvents,
  briefingAcks,
  briefingVersions,
  eq,
  occasionMembers,
  occasions,
  orderDeltas,
  orderSnapshots,
  sql,
  supplierLinks,
  suppliers,
} from "@ed/db";
import { setupTestDb, type TestDb } from "@ed/db/testing";
import { isAppError } from "@ed/shared/errors";
import { hashToken } from "@ed/shared/ids";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listBookingEvents, setBookingState, updateBookingTerms } from "../src/bookings";
import { acknowledgeBriefing, getSupplierLinkView, listBriefingVersions, publishBriefing } from "../src/briefings";
import { accountCtx, anonymousCtx, systemCtx, type Ctx } from "../src/context";
import { createDelivery } from "../src/deliveries";
import { requestDeletion } from "../src/deletion";
import { createHousehold } from "../src/guests";
import { purgeDueOccasions } from "../src/occasions";
import { createOrderSnapshot, getOrderState } from "../src/orders";
import { addPaymentDeadline } from "../src/payments";
import { recordRsvp } from "../src/rsvp";
import {
  createSupplier,
  createSupplierLink,
  deleteSupplier,
  ensureBooking,
  findOrCreateSupplierForListing,
  getSupplier,
  listSuppliers,
  parseMoneyText,
  resolveSupplierLink,
  revokeSupplierLink,
} from "../src/suppliers";

let t: TestDb;
const OWNER = "acc_owner_s";
const HELPER = "acc_helper_s"; // contributor, no finance grant
const OUTSIDER = "acc_outsider_s";
let seq = 0;

beforeAll(async () => {
  t = await setupTestDb();
  await t.db.insert(accounts).values([
    { id: OWNER, kind: "email", email: "owner-s@example.test" },
    { id: HELPER, kind: "email", email: "helper-s@example.test" },
    { id: OUTSIDER, kind: "email", email: "outsider-s@example.test" },
  ]);
});
afterAll(async () => {
  await t.close();
});

const owner = (now?: Date): Ctx => accountCtx(t.db, OWNER, { now });
const helper = (): Ctx => accountCtx(t.db, HELPER);
const outsider = (): Ctx => accountCtx(t.db, OUTSIDER);
const anon = (ip = "203.0.113.9"): Ctx => anonymousCtx(t.db, { ip });

async function newOccasion(): Promise<string> {
  const id = `occs${++seq}aaaaaa`;
  await t.db.insert(occasions).values({
    id,
    ownerAccountId: OWNER,
    title: "Nunta Ioanei și a lui Andrei",
    kind: "nunta",
    startsAt: new Date("2027-06-12T09:00:00Z"),
    venueName: "Conacul Polizu",
  });
  await t.db.insert(occasionMembers).values([
    { occasionId: id, accountId: OWNER, role: "owner" },
    { occasionId: id, accountId: HELPER, role: "contributor" },
  ]);
  return id;
}

async function code(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (e) {
    return isAppError(e) ? e.code : `THROWN:${String(e)}`;
  }
  return "OK";
}

describe("suppliers and bookings (B4, P10)", () => {
  it("money typed in a form: empty is unknown, never zero", () => {
    expect(parseMoneyText("")).toBeNull();
    expect(parseMoneyText("1.500")).toBe(150000);
    expect(parseMoneyText("1.500,50")).toBe(150050);
    expect(parseMoneyText("1500.5")).toBe(150050);
    expect(parseMoneyText("abc")).toBeUndefined();
  });

  it("a supplier gets one booking; every state transition is recorded with actor and time", async () => {
    const occ = await newOccasion();
    const { supplierId, bookingId } = await createSupplier(owner(), { occasionId: occ, name: "Formația Allegro", categoryLabel: "Muzică", contactPhone: "0722 000 111" });
    expect((await ensureBooking(owner(), supplierId)).id).toBe(bookingId);

    await setBookingState(owner(), { bookingId, state: "quoted" });
    await setBookingState(owner(), { bookingId, state: "booked", note: "contract semnat" });
    expect((await setBookingState(owner(), { bookingId, state: "booked" })).changed).toBe(false); // idempotent
    const events = await listBookingEvents(owner(), bookingId);
    expect(events.map((e) => [e.fromState, e.toState])).toEqual([
      [null, "enquired"],
      ["enquired", "quoted"],
      ["quoted", "booked"],
    ]);
    expect(events.every((e) => e.actorKind === "account" && e.actorId === OWNER && e.at instanceof Date)).toBe(true);
    const audits = await t.db.select().from(auditLog).where(eq(auditLog.objectId, bookingId));
    expect(audits.filter((a) => a.action === "booking.state_changed")).toHaveLength(2);

    // contributors read but do not change; outsiders see nothing at all
    expect(await code(() => setBookingState(helper(), { bookingId, state: "confirmed" }))).toBe("FORBIDDEN");
    expect(await code(() => getSupplier(outsider(), supplierId))).toBe("NOT_FOUND");
    expect(await code(() => listSuppliers(outsider(), occ))).toBe("NOT_FOUND");
  });

  it("the agreed amount is unknown until set and is never shown without the finance grant (D2)", async () => {
    const occ = await newOccasion();
    const { supplierId, bookingId } = await createSupplier(owner(), { occasionId: occ, name: "Catering Bun" });
    expect((await getSupplier(owner(), supplierId)).booking.agreedMinor).toBeNull(); // unknown, not 0
    await updateBookingTerms(owner(), { bookingId, agreedAmount: "12.500", notes: "" });
    await addPaymentDeadline(owner(), { bookingId, kind: "advance", dueOn: "2027-03-01", amount: "3.000" });
    const mine = await listSuppliers(owner(), occ);
    expect(mine.items[0]!.booking.agreedMinor).toBe(1250000);
    expect(mine.items[0]!.nextPayment?.dueOn).toBe("2027-03-01");
    const theirs = await listSuppliers(helper(), occ);
    expect(theirs.canSeeMoney).toBe(false);
    expect(theirs.items[0]!.booking.agreedMinor).toBeUndefined();
    expect(theirs.items[0]!.nextPayment).toBeUndefined();
    expect(JSON.stringify(theirs)).not.toContain("1250000");
  });

  it("findOrCreateSupplierForListing reuses the record of a listing (P10)", async () => {
    const occ = await newOccasion();
    const a = await findOrCreateSupplierForListing(helper(), { occasionId: occ, listingId: "lst_1", name: "Florăria Iris", categoryLabel: "Flori" });
    const b = await findOrCreateSupplierForListing(owner(), { occasionId: occ, listingId: "lst_1", name: "Alt nume", categoryLabel: null });
    expect(b.id).toBe(a.id);
    expect(b.name).toBe("Florăria Iris");
    const booking = await ensureBooking(owner(), a.id);
    expect(booking.state).toBe("enquired");
    expect(await t.db.select().from(suppliers).where(eq(suppliers.occasionId, occ))).toHaveLength(1);
    expect(await code(() => findOrCreateSupplierForListing(outsider(), { occasionId: occ, listingId: "lst_2", name: "X", categoryLabel: null }))).toBe("NOT_FOUND");
  });
});

describe("versioned briefings and the scoped supplier link (B4, S6, SEC2)", () => {
  async function scene() {
    const occ = await newOccasion();
    const a = await createSupplier(owner(), { occasionId: occ, name: "Formația Allegro", contactName: "Mihai" });
    const b = await createSupplier(owner(), { occasionId: occ, name: "Catering Bun" });
    return { occ, a, b };
  }

  it("publishing never edits an old version; the table refuses UPDATE and DELETE", async () => {
    const { a } = await scene();
    const v1 = await publishBriefing(owner(), { bookingId: a.bookingId, what: "Muzică live 4 ore", when: "12 iunie, 19:00", where: "Salonul mare" });
    expect(v1.version).toBe(1);
    expect(await code(() => publishBriefing(owner(), { bookingId: a.bookingId, what: "Muzică live 4 ore", when: "12 iunie, 19:00", where: "Salonul mare" }))).toBe("CONFLICT");
    expect(await code(() => publishBriefing(owner(), { bookingId: a.bookingId }))).toBe("VALIDATION");
    const v2 = await publishBriefing(owner(), { bookingId: a.bookingId, what: "Muzică live 5 ore", when: "12 iunie, 18:00", where: "Salonul mare" });
    expect(v2.version).toBe(2);
    const versions = await listBriefingVersions(owner(), a.bookingId);
    expect(versions.map((v) => [v.version, v.content.what])).toEqual([
      [2, "Muzică live 5 ore"],
      [1, "Muzică live 4 ore"],
    ]);
    await expect(t.db.update(briefingVersions).set({ version: 9 }).where(eq(briefingVersions.id, v1.versionId))).rejects.toThrow();
    await expect(t.db.execute(sql`update briefing_versions set content = '{}'::jsonb where id = ${v1.versionId}`)).rejects.toThrow();
    await expect(t.db.delete(briefingVersions).where(eq(briefingVersions.id, v1.versionId))).rejects.toThrow();
    expect(await code(() => publishBriefing(helper(), { bookingId: a.bookingId, what: "x" }))).toBe("FORBIDDEN");
  });

  it("the link shows only its own booking; the token is stored hashed", async () => {
    const { occ, a, b } = await scene();
    await publishBriefing(owner(), { bookingId: a.bookingId, what: "Muzică live", contacts: "Ioana 0722 111 222" });
    await publishBriefing(owner(), { bookingId: b.bookingId, what: "SECRET-CATERING 180 de porții" });
    await updateBookingTerms(owner(), { bookingId: a.bookingId, agreedAmount: "9.999", notes: "NOTA-INTERNA" });
    await createOrderSnapshot(owner(), { bookingId: a.bookingId, items: [{ label: "Ore de program", quantity: 4, unit: "ore" }] });
    await createDelivery(owner(), { occasionId: occ, supplierId: a.supplierId, title: "Montaj scenă", expectedFrom: new Date("2027-06-12T08:00:00Z"), items: [{ label: "Boxe", expectedQty: 4, deposit: "777" }] });
    await createDelivery(owner(), { occasionId: occ, supplierId: b.supplierId, title: "SECRET-LIVRARE" });

    const link = await createSupplierLink(owner(), { bookingId: a.bookingId });
    expect(link.token.length).toBeGreaterThanOrEqual(43); // 32 bytes base64url
    const [stored] = await t.db.select().from(supplierLinks).where(eq(supplierLinks.bookingId, a.bookingId));
    expect(stored!.tokenHash).toBe(hashToken(link.token));
    expect(JSON.stringify(stored)).not.toContain(link.token);

    const view = (await getSupplierLinkView(anon(), link.token))!;
    expect(view.supplier.name).toBe("Formația Allegro");
    expect(view.briefing?.content.what).toBe("Muzică live");
    expect(view.order?.items[0]?.label).toBe("Ore de program");
    expect(view.deliveries.map((d) => d.title)).toEqual(["Montaj scenă"]);
    const json = JSON.stringify(view);
    for (const leak of ["SECRET-CATERING", "SECRET-LIVRARE", "Catering Bun", "999900", "NOTA-INTERNA", "77700", "agreedMinor", "depositMinor"]) {
      expect(json).not.toContain(leak);
    }
  });

  it("acknowledging stores who, when and which version — once; the view says what changed since", async () => {
    const { a, b } = await scene();
    const v1 = await publishBriefing(owner(), { bookingId: a.bookingId, what: "Muzică live 4 ore", where: "Salonul mare" });
    const link = await createSupplierLink(owner(), { bookingId: a.bookingId });
    const other = await publishBriefing(owner(), { bookingId: b.bookingId, what: "Meniu" });

    const first = await acknowledgeBriefing(anon(), { token: link.token, versionId: v1.versionId, name: "Mihai Pop" });
    expect(first).toMatchObject({ version: 1, name: "Mihai Pop", alreadyAcknowledged: false });
    const again = await acknowledgeBriefing(anon(), { token: link.token, versionId: v1.versionId, name: "Altcineva" });
    expect(again).toMatchObject({ version: 1, name: "Mihai Pop", alreadyAcknowledged: true });
    expect(again.at.getTime()).toBe(first.at.getTime());
    expect(await t.db.select().from(briefingAcks).where(eq(briefingAcks.briefingVersionId, v1.versionId))).toHaveLength(1);
    // a version of another booking cannot be acknowledged through this link
    expect(await code(() => acknowledgeBriefing(anon(), { token: link.token, versionId: other.versionId, name: "Mihai Pop" }))).toBe("NOT_FOUND");
    expect(await code(() => acknowledgeBriefing(anon(), { token: link.token, versionId: v1.versionId, name: "" }))).toBe("VALIDATION");

    await publishBriefing(owner(), { bookingId: a.bookingId, what: "Muzică live 5 ore", where: "Salonul mare" });
    const view = (await getSupplierLinkView(anon(), link.token))!;
    expect(view.briefing?.version).toBe(2);
    expect(view.briefing?.ack).toBeNull();
    expect(view.acknowledged).toMatchObject({ version: 1, name: "Mihai Pop" });
    expect(view.changes).toEqual([{ field: "what", before: "Muzică live 4 ore", after: "Muzică live 5 ore" }]);
    const planner = await listBriefingVersions(owner(), a.bookingId);
    expect(planner.map((v) => [v.version, v.ack?.name ?? null])).toEqual([
      [2, null],
      [1, "Mihai Pop"],
    ]);
  });

  it("a revoked link is refused exactly like an unknown one; regenerating replaces it", async () => {
    const { a } = await scene();
    const v1 = await publishBriefing(owner(), { bookingId: a.bookingId, what: "Muzică live" });
    const link = await createSupplierLink(owner(), { bookingId: a.bookingId });
    expect(await resolveSupplierLink(anon(), link.token)).not.toBeNull();

    await revokeSupplierLink(owner(), { bookingId: a.bookingId });
    const unknown = "A".repeat(43);
    const revokedView = await getSupplierLinkView(anon("203.0.113.20"), link.token);
    const unknownView = await getSupplierLinkView(anon("203.0.113.21"), unknown);
    expect(revokedView).toBeNull();
    expect(unknownView).toBeNull();
    const errRevoked = await acknowledgeBriefing(anon("203.0.113.20"), { token: link.token, versionId: v1.versionId, name: "Mihai" }).catch((e) => e);
    const errUnknown = await acknowledgeBriefing(anon("203.0.113.21"), { token: unknown, versionId: v1.versionId, name: "Mihai" }).catch((e) => e);
    expect(isAppError(errRevoked) && isAppError(errUnknown)).toBe(true);
    expect([errRevoked.code, errRevoked.messageKey]).toEqual([errUnknown.code, errUnknown.messageKey]);

    const fresh = await createSupplierLink(owner(), { bookingId: a.bookingId });
    expect(await resolveSupplierLink(anon(), link.token)).toBeNull(); // the old token stays dead
    expect(await resolveSupplierLink(anon(), fresh.token)).not.toBeNull();
    expect(await code(() => createSupplierLink(helper(), { bookingId: a.bookingId }))).toBe("FORBIDDEN");
  });

  it("guessing tokens is rate-limited per IP", async () => {
    const ip = "203.0.113.77";
    let limited = false;
    for (let i = 0; i < 40 && !limited; i += 1) {
      limited = (await code(() => resolveSupplierLink(anon(ip), `${"B".repeat(40)}${String(i).padStart(3, "0")}`))) === "RATE_LIMITED";
    }
    expect(limited).toBe(true);
  });
});

describe("final-order snapshots and deltas (B5)", () => {
  it("a snapshot is immutable; a later RSVP change yields a delta linked to the household; folding makes a NEW version", async () => {
    const occ = await newOccasion();
    const { bookingId } = await createSupplier(owner(), { occasionId: occ, name: "Catering Bun" });
    const pop = await createHousehold(owner(), { occasionId: occ, name: "Familia Popescu" });
    const ion = await createHousehold(owner(), { occasionId: occ, name: "Familia Ionescu" });
    await recordRsvp(owner(), { householdId: pop.householdId, attending: "yes", adultsCount: 2, childrenCount: 1 });

    // before any snapshot exists, guest changes leave no delta
    expect(await t.db.select().from(orderDeltas).where(eq(orderDeltas.occasionId, occ))).toHaveLength(0);

    const s1 = await createOrderSnapshot(owner(), { bookingId, items: [{ label: "Meniu adult", quantity: 2 }, { label: "Meniu copil", quantity: 1 }] });
    expect(s1.version).toBe(1);
    const [row] = await t.db.select().from(orderSnapshots).where(eq(orderSnapshots.id, s1.snapshotId));
    expect(row!.basedOn).toEqual({ adults: 2, children: 1, total: 3 });
    await expect(t.db.update(orderSnapshots).set({ items: [] }).where(eq(orderSnapshots.id, s1.snapshotId))).rejects.toThrow();
    await expect(t.db.delete(orderSnapshots).where(eq(orderSnapshots.id, s1.snapshotId))).rejects.toThrow();

    // post-snapshot changes: a new "yes" and a changed count
    await recordRsvp(owner(), { householdId: ion.householdId, attending: "yes", adultsCount: 2, childrenCount: 0 });
    await recordRsvp(owner(), { householdId: pop.householdId, attending: "yes", adultsCount: 3, childrenCount: 1 });
    await recordRsvp(owner(), { householdId: pop.householdId, attending: "yes", adultsCount: 3, childrenCount: 1 }); // no change, no delta
    const state = await getOrderState(owner(), bookingId);
    expect(state.latest!.items).toHaveLength(2); // the agreed order did not move
    expect(state.latest!.basedOn.total).toBe(3);
    expect(state.openDeltas.map((d) => [d.householdName, d.before, d.after])).toEqual([
      ["Familia Ionescu", { adults: 0, children: 0 }, { adults: 2, children: 0 }],
      ["Familia Popescu", { adults: 2, children: 1 }, { adults: 3, children: 1 }],
    ]);
    expect(state.openDeltas.every((d) => d.snapshotVersion === 1)).toBe(true);
    expect(state.drift).toEqual({ adults: 3, children: 0, total: 3 });
    // a delta row is a record: it cannot be rewritten or removed
    await expect(t.db.update(orderDeltas).set({ after: { adults: 99, children: 0 } }).where(eq(orderDeltas.id, state.openDeltas[0]!.id))).rejects.toThrow();
    await expect(t.db.delete(orderDeltas).where(eq(orderDeltas.id, state.openDeltas[0]!.id))).rejects.toThrow();

    expect(await code(() => createOrderSnapshot(helper(), { bookingId, items: [{ label: "x", quantity: 1 }] }))).toBe("FORBIDDEN");
    const s2 = await createOrderSnapshot(owner(), { bookingId, items: [{ label: "Meniu adult", quantity: 5 }, { label: "Meniu copil", quantity: 1 }] });
    expect(s2).toMatchObject({ version: 2, folded: 2 });
    const after = await getOrderState(owner(), bookingId);
    expect(after.versions.map((v) => v.version)).toEqual([2, 1]);
    expect(after.versions[1]!.items[0]).toMatchObject({ label: "Meniu adult", quantity: 2 }); // v1 untouched
    expect(after.openDeltas).toEqual([]);
    expect(after.drift).toEqual({ adults: 0, children: 0, total: 0 });

    // "no" after the new version: a delta against version 2
    await recordRsvp(owner(), { householdId: ion.householdId, attending: "no", adultsCount: 0, childrenCount: 0 });
    const last = await getOrderState(owner(), bookingId);
    expect(last.openDeltas.map((d) => [d.snapshotVersion, d.after.adults])).toEqual([[2, 0]]);
  });

  it("purging the occasion removes this release's rows, immutable ones included", async () => {
    const occ = await newOccasion();
    const { supplierId, bookingId } = await createSupplier(owner(), { occasionId: occ, name: "Catering Bun" });
    await publishBriefing(owner(), { bookingId, what: "Meniu" });
    await createOrderSnapshot(owner(), { bookingId, items: [{ label: "Meniu", quantity: 1 }] });
    expect(await code(() => deleteSupplier(owner(), { supplierId }))).toBe("CONFLICT"); // on record: cancel instead
    const past = new Date(Date.now() - 9 * 86_400_000);
    await requestDeletion(owner(past), { targetType: "occasion", targetId: occ });
    const purged = await purgeDueOccasions(systemCtx(t.db));
    expect(purged).toContain(occ);
    expect(await t.db.select().from(suppliers).where(eq(suppliers.occasionId, occ))).toHaveLength(0);
    expect(await t.db.select().from(briefingVersions).where(eq(briefingVersions.occasionId, occ))).toHaveLength(0);
    expect(await t.db.select().from(orderSnapshots).where(eq(orderSnapshots.occasionId, occ))).toHaveLength(0);
    expect(await t.db.select().from(bookingEvents).where(eq(bookingEvents.occasionId, occ))).toHaveLength(0);
  });
});
