import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import {
  accounts,
  assets,
  bookings,
  categories,
  drawingVersions,
  eq,
  localities,
  occasionGuestSettings,
  occasionMembers,
  occasions,
  planItems,
  seatAssignments,
  sessions,
  spaceModels,
  spaces,
  sql,
  staffMembers,
  suppliers,
  whatifPreviews,
  type StaffRole,
} from "@ed/db";
import { runSeeds } from "@ed/db/seed";
import { setupTestDb, type TestDb } from "@ed/db/testing";
import { isAppError, newId } from "@ed/shared";
import { createLocalTransport, setStorageTransport, uploadAsset } from "@ed/storage";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createBusiness } from "../src/business";
import { accountCtx, anonymousCtx, makeCtx, systemCtx, type Ctx } from "../src/context";
import {
  attachDrawing,
  calibrateSpace,
  createSpace,
  getListingSpaces,
  getListingSpacesEditor,
  getSpaceEditor,
  imagePixelSize,
  parkingView,
  saveMarkings,
  setPdfRasteriser,
  submitParking,
  submitSpace,
} from "../src/drawings";
import { runExport } from "../src/exports";
import { createHousehold } from "../src/guests";
import { getGuestView, resolveGuestLink } from "../src/invitations";
import { createListing, submitListing } from "../src/listings";
import { decideRevision, listModerationQueue } from "../src/moderation";
import { recordRsvp } from "../src/rsvp";
import {
  addFixture,
  addMealStage,
  addTable,
  assignSeats,
  attachVenueSpace,
  createOwnSpace,
  getFitChecks,
  getGuestSeat,
  getGuestSpaceView,
  getSeatingRoster,
  getSeatingSummary,
  getSpaceModel,
  listAttachableSpaces,
  moveItem,
  proposeDrawingUpdate,
  publishSeating,
  setSeatNumber,
  setStageItem,
  unassignSeats,
  unpublishSeating,
} from "../src/seating";
import type { SpaceMarkings } from "../src/spacemodel";
import { confirmPreview, createPreview, discardPreview, listPending } from "../src/whatif";

let t: TestDb;
let dir: string;
let cat: string[] = [];
let cj: { id: string }[] = [];
let moderator: Ctx;
const T0 = new Date("2026-05-04T08:00:00Z");
let seq = 0;

beforeAll(async () => {
  process.env.SESSION_SECRET = "test-secret-test-secret-test-secret-0123";
  process.env.APP_URL = "https://app.example.test";
  process.env.MEDIA_URL = "https://media.example.test";
  t = await setupTestDb();
  dir = await mkdtemp(join(tmpdir(), "ed-drawings-test-"));
  setStorageTransport(createLocalTransport(dir));
  await runSeeds(t.db, ["categories", "geography"]);
  cat = (await t.db.select().from(categories).orderBy(categories.sortOrder)).map((c) => c.id);
  cj = await t.db.select({ id: localities.id }).from(localities).where(eq(localities.countyCode, "CJ")).orderBy(localities.sortOrder);
  moderator = await mkStaff(["listing_moderator"]);
});
afterAll(async () => {
  setStorageTransport(null);
  setPdfRasteriser(null);
  await rm(dir, { recursive: true, force: true });
  await t.close();
});

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "OK";
  } catch (e) {
    if (isAppError(e)) return e.code;
    throw e;
  }
}
async function key(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
    return "OK";
  } catch (e) {
    if (isAppError(e)) return e.messageKey;
    throw e;
  }
}

async function mkAccount(): Promise<{ id: string; ctx: Ctx }> {
  const id = newId();
  await t.db.insert(accounts).values({ id, kind: "email", email: `om${++seq}@example.test` });
  await t.db.insert(sessions).values({ accountId: id, tokenHash: newId(), lastSeenAt: T0, expiresAt: new Date(T0.getTime() + 30 * 86_400_000), freshAuthAt: new Date(T0.getTime() - 60_000) });
  return { id, ctx: accountCtx(t.db, id, { now: T0 }) };
}
async function mkStaff(roles: StaffRole[]): Promise<Ctx> {
  const acc = (await mkAccount()).id;
  const [row] = await t.db.insert(staffMembers).values({ accountId: acc, roles }).returning();
  return makeCtx(t.db, { kind: "staff", accountId: acc, staffId: row!.id, roles }, { now: T0 });
}

/** A real PNG of the given size (grey), built by hand. */
function png(width: number, height: number): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 0, 0, 0, 0], 8); // 8-bit greyscale
  const raw = Buffer.alloc((width + 1) * height, 0xcc);
  for (let y = 0; y < height; y++) raw[y * (width + 1)] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

async function mkVenue() {
  const owner = await mkAccount();
  const business = await createBusiness(owner.ctx, { name: `Conac ${++seq} SRL` });
  const listing = await createListing(owner.ctx, {
    businessId: business.id,
    payload: {
      name: `Conacul Polizu ${seq}`,
      descriptionRo: "Sală de evenimente cu grădină, la douăzeci de minute de Cluj, pentru nunți și botezuri.",
      categoryIds: [cat[0]!],
      countyCodes: ["CJ"],
      localityIds: [cj[0]!.id],
      contactPhone: "0264 123 456",
    },
  });
  const { revisionId } = await submitListing(owner.ctx, { listingId: listing.id });
  await decideRevision(moderator, { id: revisionId, decision: "approve" });
  return { owner, business, listingId: listing.id };
}

/** 20 mm per pixel on a 1000 × 600 px picture → a 20 × 12 m sheet. */
const CAL = { ax: 100, ay: 100, bx: 600, by: 100, distanceMm: 10_000 };

const markings = (over: Partial<SpaceMarkings> = {}): SpaceMarkings => ({
  areas: [{ id: "floor", name: "Salon", points: [{ x: 0, y: 0 }, { x: 20_000, y: 0 }, { x: 20_000, y: 12_000 }, { x: 0, y: 12_000 }] }],
  tableTypes: [
    { id: "round10", name: "Rotundă 10", shape: "round", diameterMm: 1800, widthMm: null, lengthMm: null, seats: 10, count: 3 },
    { id: "mystery", name: "Masă veche", shape: "rect", diameterMm: null, widthMm: null, lengthMm: null, seats: 6, count: null },
  ],
  fixtures: [{ id: "ring", kind: "dance", name: "Ring de dans", x: 15_000, y: 8000, widthMm: 5000, lengthMm: 4000, rotation: 0 }],
  pois: [
    { id: "wc", kind: "toilets", name: "Toalete", x: 19_500, y: 500 },
    { id: "bar", kind: "bar", name: null, x: 500, y: 11_500 },
  ],
  parkingAreas: [],
  ...over,
});

/** A space with a real uploaded picture; optionally calibrated, marked and approved. */
async function mkSpace(v: Awaited<ReturnType<typeof mkVenue>>, opts: { calibrate?: boolean; mark?: SpaceMarkings | false; approve?: boolean } = {}) {
  const space = await createSpace(v.owner.ctx, { listingId: v.listingId, name: "Sala Mare", widthMm: 20_000, lengthMm: 12_000 });
  const asset = await uploadAsset(v.owner.ctx, { ownerType: "business", ownerId: v.business.id, file: { name: "plan.png", bytes: png(1000, 600) } });
  await attachDrawing(v.owner.ctx, { spaceId: space.id, assetId: asset.id });
  if (opts.calibrate !== false) {
    await calibrateSpace(v.owner.ctx, { spaceId: space.id, ...CAL });
    if (opts.mark !== false) await saveMarkings(v.owner.ctx, { spaceId: space.id, markings: opts.mark ?? markings() });
  }
  if (opts.approve !== false) await approveSpace(v, space.id);
  return space.id;
}
async function approveSpace(v: Awaited<ReturnType<typeof mkVenue>>, spaceId: string) {
  const rev = await submitSpace(v.owner.ctx, { spaceId });
  await decideRevision(moderator, { id: rev.id, decision: "approve" });
}

async function mkOccasion(ownerId: string, listing?: { listingId: string; state?: string }) {
  const id = newId();
  await t.db.insert(occasions).values({ id, ownerAccountId: ownerId, title: "Nunta Ioanei și a lui Andrei", kind: "nunta", startsAt: new Date("2027-06-12T14:00:00Z") });
  await t.db.insert(occasionMembers).values({ occasionId: id, accountId: ownerId, role: "owner" });
  if (listing) {
    const [s] = await t.db.insert(suppliers).values({ occasionId: id, name: "Conacul Polizu", listingId: listing.listingId }).returning();
    await t.db.insert(bookings).values({ supplierId: s!.id, occasionId: id, state: (listing.state ?? "enquired") as "enquired" });
  }
  return id;
}

async function guestCtx(token: string): Promise<Ctx> {
  const link = await resolveGuestLink(anonymousCtx(t.db, { now: T0 }), token);
  if (!link) throw new Error("link did not resolve");
  return makeCtx(t.db, link.actor, { now: T0 });
}

describe("venue drawings — calibration gate (V7)", () => {
  it("reads the pixel size from the file header", () => {
    expect(imagePixelSize(png(1000, 600))).toEqual({ width: 1000, height: 600 });
    expect(imagePixelSize(Buffer.from("not an image"))).toBeNull();
  });

  it("an uncalibrated drawing is stored but takes no markings", async () => {
    const v = await mkVenue();
    const spaceId = await mkSpace(v, { calibrate: false, approve: false });
    const ed = await getSpaceEditor(v.owner.ctx, spaceId);
    expect(ed.space.pixelWidth).toBe(1000);
    expect(ed.space.mmPerPx).toBeNull();
    expect(ed.pictureUrl).toContain("/api/media/");
    await expect(saveMarkings(v.owner.ctx, { spaceId, markings: markings() })).rejects.toMatchObject({ code: "CONFLICT", messageKey: "drawings.errors.notCalibrated" });
    // not even the table inventory
    await expect(saveMarkings(v.owner.ctx, { spaceId, markings: markings({ areas: [], fixtures: [], pois: [] }) })).rejects.toMatchObject({ messageKey: "drawings.errors.notCalibrated" });
    // the database refuses a scale without its two points, whoever writes
    await expect(t.db.update(spaces).set({ mmPerPx: 20 }).where(eq(spaces.id, spaceId))).rejects.toThrow();
  });

  it("calibration derives the scale; re-calibrating keeps markings on the picture and recomputes real positions", async () => {
    const v = await mkVenue();
    const spaceId = await mkSpace(v, { approve: false });
    let ed = await getSpaceEditor(v.owner.ctx, spaceId);
    expect(ed.space.mmPerPx).toBe(20);
    expect(ed.model.backdrop).toEqual({ widthMm: 20_000, heightMm: 12_000 });
    // the same two points were really 5 m apart → everything is half as far
    await calibrateSpace(v.owner.ctx, { spaceId, ...CAL, distanceMm: 5000 });
    ed = await getSpaceEditor(v.owner.ctx, spaceId);
    expect(ed.space.mmPerPx).toBe(10);
    expect(ed.space.markings.pois[0]).toMatchObject({ x: 9750, y: 250 });
    expect(ed.space.markings.areas[0]!.points[2]).toEqual({ x: 10_000, y: 6000 });
    // stated sizes are facts: they do not scale
    expect(ed.space.markings.fixtures[0]).toMatchObject({ widthMm: 5000, lengthMm: 4000, x: 7500, y: 4000 });
    expect(ed.space.markings.tableTypes[0]!.diameterMm).toBe(1800);
    // bad calibrations
    await expect(calibrateSpace(v.owner.ctx, { spaceId, ax: 10, ay: 10, bx: 15, by: 10, distanceMm: 3000 })).rejects.toMatchObject({ messageKey: "drawings.errors.pointsTooClose" });
    await expect(calibrateSpace(v.owner.ctx, { spaceId, ax: 10, ay: 10, bx: 5000, by: 10, distanceMm: 3000 })).rejects.toMatchObject({ messageKey: "drawings.errors.pointOutside" });
  });

  it("replacing the drawing voids the calibration and the markings; a PDF needs a rasteriser to be calibrated", async () => {
    const v = await mkVenue();
    const spaceId = await mkSpace(v, { approve: false });
    const pdf = await uploadAsset(v.owner.ctx, { ownerType: "business", ownerId: v.business.id, file: { name: "plan.pdf", bytes: Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n") }, allowPdf: true });
    setPdfRasteriser(async () => null); // production without poppler
    const stored = await attachDrawing(v.owner.ctx, { spaceId, assetId: pdf.id });
    expect(stored).toMatchObject({ pdfWithoutPicture: true, displayAssetId: null, mmPerPx: null, calibration: null });
    expect(stored.markings.areas).toEqual([]);
    await expect(calibrateSpace(v.owner.ctx, { spaceId, ...CAL })).rejects.toMatchObject({ messageKey: "drawings.errors.noPicture" });
    setPdfRasteriser(async () => png(800, 500)); // with a rasteriser: page 1 becomes the picture
    const drawn = await attachDrawing(v.owner.ctx, { spaceId, assetId: pdf.id });
    expect(drawn).toMatchObject({ pdfWithoutPicture: false, pixelWidth: 800, pixelHeight: 500 });
    expect(drawn.displayAssetId).not.toBe(pdf.id);
    setPdfRasteriser(null);
    // someone else's file cannot be attached
    const other = await mkVenue();
    const foreign = await uploadAsset(other.owner.ctx, { ownerType: "business", ownerId: other.business.id, file: { name: "x.png", bytes: png(50, 50) } });
    expect(await code(attachDrawing(v.owner.ctx, { spaceId, assetId: foreign.id }))).toBe("NOT_FOUND");
  });

  it("two people editing: the stale one is told, nothing is overwritten", async () => {
    const v = await mkVenue();
    const spaceId = await mkSpace(v, { approve: false });
    const seen = (await getSpaceEditor(v.owner.ctx, spaceId)).space.version;
    await saveMarkings(v.owner.ctx, { spaceId, markings: markings({ pois: [] }), version: seen });
    await expect(saveMarkings(v.owner.ctx, { spaceId, markings: markings(), version: seen })).rejects.toMatchObject({ code: "CONFLICT", messageKey: "drawings.errors.conflict" });
    expect((await getSpaceEditor(v.owner.ctx, spaceId)).space.markings.pois).toEqual([]);
  });
});

describe("venue drawings — moderation (V3)", () => {
  it("nothing is public until approved; an edit waits while the live version stays up", async () => {
    const v = await mkVenue();
    const stranger = await mkAccount();
    const spaceId = await mkSpace(v, { approve: false });
    expect((await getListingSpaces(anonymousCtx(t.db), v.listingId)).spaces).toEqual([]);

    const rev = await submitSpace(v.owner.ctx, { spaceId });
    const queue = await listModerationQueue(moderator, {});
    expect(queue.items.some((q) => q.id === rev.id && q.kind === "drawing")).toBe(true);
    expect((await getListingSpaces(stranger.ctx, v.listingId)).spaces).toEqual([]);
    // a member of the business can never approve its own drawing
    expect(await code(decideRevision(v.owner.ctx, { id: rev.id, decision: "approve" }))).toBe("FORBIDDEN");

    await decideRevision(moderator, { id: rev.id, decision: "approve" });
    const pub = await getListingSpaces(anonymousCtx(t.db, { now: T0 }), v.listingId);
    expect(pub.spaces).toHaveLength(1);
    expect(pub.spaces[0]).toMatchObject({ name: "Sala Mare", versionNo: 1, calibrated: true, widthMm: 20_000 });
    expect(pub.spaces[0]!.model.tableTypes.map((x) => x.name)).toEqual(["Rotundă 10", "Masă veche"]);
    expect(pub.spaces[0]!.pictureUrl).toContain("/api/media/");

    // the business edits: v1 stays live while the edit waits …
    await saveMarkings(v.owner.ctx, { spaceId, markings: markings({ pois: [] }) });
    const edit = await submitSpace(v.owner.ctx, { spaceId });
    expect((await getListingSpaces(stranger.ctx, v.listingId)).spaces[0]).toMatchObject({ versionNo: 1 });
    expect((await getListingSpaces(stranger.ctx, v.listingId)).spaces[0]!.model.pois).toHaveLength(2);
    const ed = await getSpaceEditor(v.owner.ctx, spaceId);
    expect(ed.pending?.revisionId).toBe(edit.id);
    expect(ed.live?.versionNo).toBe(1);
    // … and a rejection leaves it live, with the reason for the business
    await decideRevision(moderator, { id: edit.id, decision: "reject", reason: "Lipsesc ieșirile de urgență." });
    expect((await getListingSpaces(stranger.ctx, v.listingId)).spaces[0]).toMatchObject({ versionNo: 1 });
    expect((await getSpaceEditor(v.owner.ctx, spaceId)).lastRejection?.reason).toBe("Lipsesc ieșirile de urgență.");
    // approved versions are immutable
    await expect(t.db.update(drawingVersions).set({ versionNo: 9 }).where(eq(drawingVersions.spaceId, spaceId))).rejects.toThrow();
    // outsiders cannot open the editor
    expect(await code(getSpaceEditor(stranger.ctx, spaceId))).toBe("NOT_FOUND");
    expect(await code(getListingSpacesEditor(stranger.ctx, v.listingId))).toBe("NOT_FOUND");
  });

  it("an uncalibrated drawing can be published as a picture, but never with markings", async () => {
    const v = await mkVenue();
    const spaceId = await mkSpace(v, { calibrate: false });
    const pub = await getListingSpaces(anonymousCtx(t.db, { now: T0 }), v.listingId);
    expect(pub.spaces[0]).toMatchObject({ calibrated: false });
    expect(pub.spaces[0]!.model.areas).toEqual([]);
    void spaceId;
  });
});

describe("parking facts (V10, V11)", () => {
  it("each fact is known or unknown; 'no parking on site' is stated; moderated like the listing", async () => {
    const v = await mkVenue();
    const rev = await submitParking(v.owner.ctx, { listingId: v.listingId, onSite: false, spaceCount: 40, onStreet: true, paid: null, accessibleSpaces: true, walkingDistanceM: 150 });
    expect((await getListingSpaces(anonymousCtx(t.db), v.listingId)).parking).toBeNull(); // waits for a moderator
    await decideRevision(moderator, { id: rev.id, decision: "approve" });
    const p = (await getListingSpaces(anonymousCtx(t.db), v.listingId)).parking!;
    // no parking on site: stated explicitly; a count makes no sense and is dropped, never guessed
    expect(p).toMatchObject({ onSite: false, spaceCount: null, onStreet: true, paid: null, accessibleSpaces: null, walkingDistanceM: 150 });
  });

  it("V11: a drawn count that disagrees with the stated one makes the count unknown until confirmed", async () => {
    const v = await mkVenue();
    await mkSpace(v, {
      mark: markings({ parkingAreas: [{ id: "p1", name: "Parcare față", points: [{ x: 0, y: 13_000 }, { x: 10_000, y: 13_000 }, { x: 10_000, y: 18_000 }, { x: 0, y: 18_000 }], spaces: 24 }] }),
    });
    const approve = async (input: Parameters<typeof submitParking>[1]) => decideRevision(moderator, { id: (await submitParking(v.owner.ctx, input)).id, decision: "approve" });
    const base = { listingId: v.listingId, onSite: true, onStreet: null, paid: false, accessibleSpaces: null, walkingDistanceM: null };
    await approve({ ...base, spaceCount: 30 });
    let p = (await getListingSpaces(anonymousCtx(t.db), v.listingId)).parking!;
    expect(p.spaceCount).toBeNull();
    expect(p.countMismatch).toEqual({ stated: 30, drawn: 24 });
    // matching numbers → known
    await approve({ ...base, spaceCount: 24 });
    p = (await getListingSpaces(anonymousCtx(t.db), v.listingId)).parking!;
    expect(p).toMatchObject({ spaceCount: 24, countMismatch: null });
    // or the business confirms its stated number
    await approve({ ...base, spaceCount: 30, confirmCount: true });
    p = (await getListingSpaces(anonymousCtx(t.db), v.listingId)).parking!;
    expect(p).toMatchObject({ spaceCount: 30, countMismatch: null });
    // the confirmation covers exactly that pair of numbers
    expect(parkingView({ onSite: true, spaceCount: 30, onStreet: null, paid: null, accessibleSpaces: null, walkingDistanceM: null, countConfirmedFor: { stated: 30, drawn: 24 } }, 26).spaceCount).toBeNull();
    expect(parkingView(null, 12)).toMatchObject({ onSite: null, spaceCount: null });
  });
});

describe("space model in the plan (V4–V6)", () => {
  it("only a booked venue's calibrated, approved space can be attached; version and effective date are kept", async () => {
    const v = await mkVenue();
    const calibrated = await mkSpace(v);
    const picture = await mkSpace(v, { calibrate: false });
    const planner = await mkAccount();
    const noBooking = await mkOccasion(planner.id);
    expect(await listAttachableSpaces(planner.ctx, noBooking)).toEqual([]);
    expect(await code(attachVenueSpace(planner.ctx, { occasionId: noBooking, spaceId: calibrated }))).toBe("NOT_FOUND");
    const cancelled = await mkOccasion(planner.id, { listingId: v.listingId, state: "cancelled" });
    expect(await listAttachableSpaces(planner.ctx, cancelled)).toEqual([]);

    const occ = await mkOccasion(planner.id, { listingId: v.listingId });
    const list = await listAttachableSpaces(planner.ctx, occ);
    expect(list.map((s) => [s.spaceId, s.calibrated])).toEqual([[calibrated, true], [picture, false]]);
    // V7: the uncalibrated one cannot become a space model
    await expect(attachVenueSpace(planner.ctx, { occasionId: occ, spaceId: picture })).rejects.toMatchObject({ code: "CONFLICT", messageKey: "space.errors.notCalibrated" });
    expect(await getSpaceModel(planner.ctx, occ)).toBeNull();
    expect(await getFitChecks(planner.ctx, occ)).toBeNull();

    await attachVenueSpace(planner.ctx, { occasionId: occ, spaceId: calibrated });
    const model = (await getSpaceModel(planner.ctx, occ))!;
    expect(model).toMatchObject({ source: "venue", versionNo: 1, name: "Sala Mare", newerVersion: null });
    expect(model.effectiveAt).toEqual(T0);
    // the venue's fixtures arrive as venue items; its POIs and inventory as facts
    expect(model.model.items.map((i) => [i.kind, i.source, i.name])).toEqual([["fixture", "venue", "Ring de dans"]]);
    expect(model.model.pois).toHaveLength(2);
    // one model per occasion; strangers see nothing
    expect(await code(createOwnSpace(planner.ctx, { occasionId: occ, name: "Altă sală" }))).toBe("CONFLICT");
    expect(await code(getSpaceModel((await mkAccount()).ctx, occ))).toBe("NOT_FOUND");
  });

  it("a newer drawing arrives as a preview and applies only on confirm — never a silent overwrite", async () => {
    const v = await mkVenue();
    const spaceId = await mkSpace(v);
    const planner = await mkAccount();
    const occ = await mkOccasion(planner.id, { listingId: v.listingId });
    await attachVenueSpace(planner.ctx, { occasionId: occ, spaceId });
    const t1 = await addTable(planner.ctx, { occasionId: occ, tableTypeId: "round10", x: 3000, y: 3000 });
    const t2 = await addTable(planner.ctx, { occasionId: occ, tableTypeId: "round10", x: 7000, y: 3000 });
    const t3 = await addTable(planner.ctx, { occasionId: occ, tableTypeId: "round10", x: 17_000, y: 3000 });

    // the venue: narrower floor (15 m), only 2 round tables, bigger ones, dance floor gone, a stage added
    await saveMarkings(v.owner.ctx, {
      spaceId,
      markings: markings({
        areas: [{ id: "floor", name: "Salon", points: [{ x: 0, y: 0 }, { x: 15_000, y: 0 }, { x: 15_000, y: 12_000 }, { x: 0, y: 12_000 }] }],
        tableTypes: [{ id: "round10", name: "Rotundă 10", shape: "round", diameterMm: 2000, widthMm: null, lengthMm: null, seats: 10, count: 2 }],
        fixtures: [{ id: "scena", kind: "stage", name: "Scenă", x: 7000, y: 10_500, widthMm: 4000, lengthMm: 2000, rotation: 0 }],
      }),
    });
    const later = makeCtx(t.db, moderator.actor, { now: new Date("2026-06-01T09:00:00Z") });
    const rev = await submitSpace(v.owner.ctx, { spaceId });
    // while it waits for the moderator the planner sees nothing new
    expect((await getSpaceModel(planner.ctx, occ))!.newerVersion).toBeNull();
    await decideRevision(later, { id: rev.id, decision: "approve" });

    // the plan is STILL on version 1, with its three tables untouched
    let model = (await getSpaceModel(planner.ctx, occ))!;
    expect(model.versionNo).toBe(1);
    expect(model.model.areas[0]!.points[1]!.x).toBe(20_000);
    expect(model.model.items.filter((i) => i.kind === "table").every((i) => i.diameterMm === 1800 && i.source === "venue")).toBe(true);
    expect(model.newerVersion).toMatchObject({ versionNo: 2, usable: true });
    // … and a proposal from the system is waiting
    const pending = await listPending(planner.ctx, occ);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ kind: "space.updateDrawing", proposedByKind: "system", state: "pending" });
    expect(model.pendingUpdatePreviewId).toBe(pending[0]!.id);
    expect((await proposeDrawingUpdate(planner.ctx, occ))!.id).toBe(pending[0]!.id); // no duplicate
    const keys = pending[0]!.delta.map((d) => d.key);
    expect(keys).toEqual(expect.arrayContaining(["version", "areas", "type:round10", "type:mystery", "fixture:ring", "fixture:scena", `item:${t3.id}`, `fit:${t3.id}`]));
    expect(keys).not.toContain(`fit:${t1.id}`);

    // discard → still version 1
    await discardPreview(planner.ctx, pending[0]!.id);
    expect((await getSpaceModel(planner.ctx, occ))!.versionNo).toBe(1);
    // ask again, a non-manager cannot confirm, the owner can
    const again = (await proposeDrawingUpdate(planner.ctx, occ))!;
    const helper = await mkAccount();
    await t.db.insert(occasionMembers).values({ occasionId: occ, accountId: helper.id, role: "contributor" });
    expect(await code(confirmPreview(helper.ctx, again.id))).toBe("FORBIDDEN");
    expect((await getSpaceModel(planner.ctx, occ))!.versionNo).toBe(1);
    await confirmPreview(planner.ctx, again.id);

    model = (await getSpaceModel(planner.ctx, occ))!;
    expect(model.versionNo).toBe(2);
    expect(model.effectiveAt).toEqual(new Date("2026-06-01T09:00:00Z"));
    expect(model.newerVersion).toBeNull();
    const byId = new Map(model.model.items.map((i) => [i.id, i]));
    expect(byId.get(t1.id)).toMatchObject({ source: "venue", diameterMm: 2000 });
    expect(byId.get(t2.id)).toMatchObject({ source: "venue", diameterMm: 2000 });
    // the third table is beyond the venue's inventory now: kept, but honestly custom
    expect(byId.get(t3.id)).toMatchObject({ source: "custom", venueRef: null });
    expect(model.model.items.filter((i) => i.kind === "fixture").map((i) => i.name)).toEqual(["Scenă"]);
    // confirming twice changes nothing
    expect((await confirmPreview(planner.ctx, again.id)).appliedNow).toBe(false);
  });

  it("custom tables are flagged custom, venue tables are limited by the stated count (V5)", async () => {
    const v = await mkVenue();
    const spaceId = await mkSpace(v);
    const planner = await mkAccount();
    const occ = await mkOccasion(planner.id, { listingId: v.listingId });
    await attachVenueSpace(planner.ctx, { occasionId: occ, spaceId });
    for (let i = 0; i < 3; i++) expect((await addTable(planner.ctx, { occasionId: occ, tableTypeId: "round10" })).source).toBe("venue");
    await expect(addTable(planner.ctx, { occasionId: occ, tableTypeId: "round10" })).rejects.toMatchObject({ code: "LIMIT", messageKey: "seating.errors.inventoryExhausted" });
    const custom = await addTable(planner.ctx, { occasionId: occ, custom: { name: "Masa mirilor", shape: "rect", widthMm: 2400, lengthMm: 900, seats: 4 }, label: "Miri" });
    expect(custom).toMatchObject({ source: "custom", venueRef: null, label: "Miri" });
    await expect(addTable(planner.ctx, { occasionId: occ, custom: { name: "Pe jumătate", shape: "rect", widthMm: 2400, seats: 4 } })).rejects.toMatchObject({ messageKey: "seating.errors.bothSides" });
    // idempotent by client id
    const id = newId();
    const a = await addTable(planner.ctx, { occasionId: occ, id, custom: { name: "Copii", shape: "round", diameterMm: 1200, seats: 6 } });
    const b = await addTable(planner.ctx, { occasionId: occ, id, custom: { name: "Copii", shape: "round", diameterMm: 1200, seats: 6 } });
    expect(b.id).toBe(a.id);
    const rows = await t.db.select().from(planItems).where(eq(planItems.occasionId, occ));
    expect(rows.filter((r) => r.kind === "table")).toHaveLength(5);
    // the what-if kind for assistants: nothing until confirmed, then flagged custom
    const preview = await createPreview(planner.ctx, { kind: "space.addCustomTable", occasionId: occ, subjectType: "occasion", subjectId: occ, input: { name: "Masă de prezidiu", shape: "rect", widthMm: 3000, lengthMm: 800, seats: 6, count: 2 } });
    expect((await t.db.select().from(planItems).where(eq(planItems.occasionId, occ))).filter((r) => r.name === "Masă de prezidiu")).toHaveLength(0);
    await confirmPreview(planner.ctx, preview.id);
    const added = (await t.db.select().from(planItems).where(eq(planItems.occasionId, occ))).filter((r) => r.name === "Masă de prezidiu");
    expect(added.map((r) => r.source)).toEqual(["custom", "custom"]);
  });

  it("unknown dimensions are excluded from the fit check and reported; fit per stage (V6, C-02)", async () => {
    const v = await mkVenue();
    const spaceId = await mkSpace(v);
    const planner = await mkAccount();
    const occ = await mkOccasion(planner.id, { listingId: v.listingId });
    await attachVenueSpace(planner.ctx, { occasionId: occ, spaceId });
    const h = await createHousehold(planner.ctx, { occasionId: occ, name: "Familia Popescu", guestNames: ["Ana Popescu", "Dan Popescu"] });
    await recordRsvp(planner.ctx, { householdId: h.householdId, attending: "yes", adultsCount: 14, childrenCount: 2, answers: {} });

    const t1 = await addTable(planner.ctx, { occasionId: occ, tableTypeId: "round10", x: 3000, y: 3000 });
    await addTable(planner.ctx, { occasionId: occ, tableTypeId: "round10", x: 8000, y: 3000 });
    let fit = (await getFitChecks(planner.ctx, occ))!;
    expect(fit.attending).toBe(16);
    expect(fit.base.status).toBe("fits");
    expect(fit.base.seats).toEqual({ available: 20, needed: 16, missing: 0 });

    // the venue's "Masă veche" has no stated size: placed, shown, but excluded — and the answer is no longer "fits"
    const old = await addTable(planner.ctx, { occasionId: occ, tableTypeId: "mystery", x: 3000, y: 3000 /* right on top of table 1 */ });
    fit = (await getFitChecks(planner.ctx, occ))!;
    expect(fit.base.excluded.map((e) => e.name)).toEqual(["Masă veche"]);
    expect(fit.base.seats.available).toBe(20); // its 6 places are not counted
    expect(fit.base.issues).toEqual([]); // and it collides with nothing
    expect(fit.base.status).toBe("unknown");
    await t.db.delete(planItems).where(eq(planItems.id, old.id));

    // stages: during "Dans" table 1 is put away → 6 places missing in that stage only
    const dinner = await addMealStage(planner.ctx, { occasionId: occ, name: "Felul principal" });
    const dance = await addMealStage(planner.ctx, { occasionId: occ, name: "Dans" });
    await setStageItem(planner.ctx, { stageId: dance.id, itemId: t1.id, present: false });
    fit = (await getFitChecks(planner.ctx, occ))!;
    expect(fit.stages.map((s) => [s.name, s.result.status, s.result.seats.missing])).toEqual([["Felul principal", "fits", 0], ["Dans", "no", 6]]);
    // an alternative position in one stage: the ring is pulled over table 2 between courses → overlap there, base untouched
    const ring = (await getSpaceModel(planner.ctx, occ))!.model.items.find((i) => i.kind === "fixture")!;
    await setStageItem(planner.ctx, { stageId: dinner.id, itemId: ring.id, present: true, x: 8000, y: 3500 });
    fit = (await getFitChecks(planner.ctx, occ))!;
    expect(fit.stages[0]!.result.issues.map((i) => i.type)).toEqual(["overlap"]);
    expect(fit.base.status).toBe("fits");
    // back to the base position → the variant row disappears
    await setStageItem(planner.ctx, { stageId: dinner.id, itemId: ring.id, present: true });
    expect((await getFitChecks(planner.ctx, occ))!.stages[0]!.result.status).toBe("fits");
  });

  it("a planner without a venue listing gets a simple own space; unknown sides stay unknown", async () => {
    const planner = await mkAccount();
    const occ = await mkOccasion(planner.id);
    await createOwnSpace(planner.ctx, { occasionId: occ, name: "Curtea bunicilor" });
    await addTable(planner.ctx, { occasionId: occ, custom: { name: "Masă lungă", shape: "rect", widthMm: 3000, lengthMm: 900, seats: 10 } });
    let fit = (await getFitChecks(planner.ctx, occ))!;
    expect(fit.base.status).toBe("unknown");
    expect(fit.base.unknown).toContain("noFloorArea");
    const occ2 = await mkOccasion(planner.id);
    await createOwnSpace(planner.ctx, { occasionId: occ2, name: "Cort", widthMm: 10_000, lengthMm: 8000 });
    const model = (await getSpaceModel(planner.ctx, occ2))!;
    expect(model).toMatchObject({ source: "own", versionNo: null });
    expect(model.model.areas).toHaveLength(1);
    await addTable(planner.ctx, { occasionId: occ2, custom: { name: "Masă lungă", shape: "rect", widthMm: 3000, lengthMm: 900, seats: 10 }, x: 5000, y: 4000 });
    fit = (await getFitChecks(planner.ctx, occ2))!;
    expect(fit.base.status).toBe("fits");
  });
});

describe("seating (C-01, C-08)", () => {
  async function setup() {
    const planner = await mkAccount();
    const occ = await mkOccasion(planner.id);
    await createOwnSpace(planner.ctx, { occasionId: occ, name: "Salon", widthMm: 20_000, lengthMm: 12_000 });
    const pop = await createHousehold(planner.ctx, { occasionId: occ, name: "Familia Popescu", guestNames: ["Ana Popescu", "Dan Popescu"] });
    const ion = await createHousehold(planner.ctx, { occasionId: occ, name: "Familia Ionescu", guestNames: ["Maria Ionescu"] });
    await recordRsvp(planner.ctx, { householdId: pop.householdId, attending: "yes", adultsCount: 3, childrenCount: 2, answers: {} });
    const roster = await getSeatingRoster(planner.ctx, occ);
    const guestId = (name: string) => roster.flatMap((h) => h.adults).find((a) => a.name === name)!.guestId;
    const small = await addTable(planner.ctx, { occasionId: occ, custom: { name: "Masă mică", shape: "round", diameterMm: 1200, seats: 4 }, x: 4000, y: 4000 });
    const big = await addTable(planner.ctx, { occasionId: occ, custom: { name: "Masă mare", shape: "round", diameterMm: 1800, seats: 10 }, x: 10_000, y: 4000 });
    return { planner, occ, pop, ion, guestId, small, big };
  }

  it("children are counted places on the household, never persons; capacity is enforced as a whole", async () => {
    const s = await setup();
    const roster = await getSeatingRoster(s.planner.ctx, s.occ);
    const pop = roster.find((h) => h.name === "Familia Popescu")!;
    // 3 adults confirmed, 2 named → one unnamed adult; 2 children as a number
    expect(pop.extra).toEqual({ count: 1, tableItemId: null });
    expect(pop.children).toEqual({ count: 2, tableItemId: null });

    // 2 adults + 1 unnamed + 2 children = 5 places > 4 → refused as a whole, nobody is seated
    await expect(
      assignSeats(s.planner.ctx, { occasionId: s.occ, tableItemId: s.small.id, guestIds: [s.guestId("Ana Popescu"), s.guestId("Dan Popescu")], groups: [{ householdId: s.pop.householdId, kind: "extra" }, { householdId: s.pop.householdId, kind: "children" }] }),
    ).rejects.toMatchObject({ code: "CONFLICT", messageKey: "seating.errors.tableFull" });
    expect(await t.db.select().from(seatAssignments).where(eq(seatAssignments.occasionId, s.occ))).toEqual([]);

    const res = await assignSeats(s.planner.ctx, { occasionId: s.occ, tableItemId: s.small.id, guestIds: [s.guestId("Ana Popescu"), s.guestId("Dan Popescu")], groups: [{ householdId: s.pop.householdId, kind: "children" }] });
    expect(res).toEqual({ seated: 4, seats: 4 });
    // repeating the same call changes nothing (idempotent)
    expect(await assignSeats(s.planner.ctx, { occasionId: s.occ, tableItemId: s.small.id, guestIds: [s.guestId("Ana Popescu")], groups: [{ householdId: s.pop.householdId, kind: "children" }] })).toEqual({ seated: 4, seats: 4 });
    // the table is full for anyone else
    await expect(assignSeats(s.planner.ctx, { occasionId: s.occ, tableItemId: s.small.id, guestIds: [s.guestId("Maria Ionescu")] })).rejects.toMatchObject({ messageKey: "seating.errors.tableFull" });
    // no child rows anywhere: the children are ONE counted row
    const rows = await t.db.select().from(seatAssignments).where(eq(seatAssignments.occasionId, s.occ));
    expect(rows.filter((r) => r.kind === "children")).toMatchObject([{ guestId: null, places: 2 }]);

    const summary = await getSeatingSummary(s.planner.ctx, s.occ);
    expect(summary.tables.find((x) => x.id === s.small.id)).toMatchObject({ seated: 4, seats: 4 });
    expect(summary.seats).toEqual({ total: 14, taken: 4 });
    expect(summary.unseated).toEqual({ adults: 2, children: 0 }); // the unnamed Popescu adult + Maria

    // moving someone to another table frees their place and their numbered seat
    await setSeatNumber(s.planner.ctx, { occasionId: s.occ, guestId: s.guestId("Ana Popescu"), seatNo: 2 });
    await expect(setSeatNumber(s.planner.ctx, { occasionId: s.occ, guestId: s.guestId("Dan Popescu"), seatNo: 2 })).rejects.toMatchObject({ code: "CONFLICT", messageKey: "seating.errors.seatTaken" });
    await expect(setSeatNumber(s.planner.ctx, { occasionId: s.occ, guestId: s.guestId("Dan Popescu"), seatNo: 9 })).rejects.toMatchObject({ messageKey: "seating.errors.seatOutOfRange" });
    await assignSeats(s.planner.ctx, { occasionId: s.occ, tableItemId: s.big.id, guestIds: [s.guestId("Ana Popescu")] });
    const moved = (await getSeatingRoster(s.planner.ctx, s.occ)).flatMap((h) => h.adults).find((a) => a.name === "Ana Popescu")!;
    expect(moved).toMatchObject({ tableItemId: s.big.id, seatNo: null });
    await unassignSeats(s.planner.ctx, { occasionId: s.occ, guestIds: [s.guestId("Dan Popescu")], groups: [{ householdId: s.pop.householdId, kind: "children" }] });
    expect((await getSeatingSummary(s.planner.ctx, s.occ)).seats.taken).toBe(1);
  });

  it("concurrent editors: a stale move gets a clear conflict, not a silent loss", async () => {
    const s = await setup();
    const first = await moveItem(s.planner.ctx, { itemId: s.big.id, x: 11_000, y: 4000, version: s.big.version });
    expect(first.version).toBe(s.big.version! + 1);
    // a second editor still holds the old version
    const err = await moveItem(s.planner.ctx, { itemId: s.big.id, x: 2000, y: 2000, version: s.big.version }).catch((e) => e);
    expect(isAppError(err) && err.code).toBe("CONFLICT");
    expect(err.messageKey).toBe("seating.errors.conflict");
    expect(err.details.current).toMatchObject({ x: 11_000, y: 4000 });
    const [row] = await t.db.select().from(planItems).where(eq(planItems.id, s.big.id));
    expect(row).toMatchObject({ x: 11_000, y: 4000 });
    // the same move twice is a no-op (idempotent)
    const again = await moveItem(s.planner.ctx, { itemId: s.big.id, x: 11_000, y: 4000, version: first.version });
    expect(again.version).toBe(first.version);
    // a contributor reads but does not arrange
    const helper = await mkAccount();
    await t.db.insert(occasionMembers).values({ occasionId: s.occ, accountId: helper.id, role: "contributor" });
    expect(await code(moveItem(helper.ctx, { itemId: s.big.id, x: 1, y: 1 }))).toBe("FORBIDDEN");
    expect((await getSeatingSummary(helper.ctx, s.occ)).hasSpace).toBe(true);
  });

  it("guests see their own table only after the plan is published — and never anyone else", async () => {
    const s = await setup();
    await addFixture(s.planner.ctx, { occasionId: s.occ, name: "Candy bar", widthMm: 2000, lengthMm: 800, x: 15_000, y: 10_000 });
    await assignSeats(s.planner.ctx, { occasionId: s.occ, tableItemId: s.big.id, guestIds: [s.guestId("Ana Popescu"), s.guestId("Dan Popescu"), s.guestId("Maria Ionescu")], groups: [{ householdId: s.pop.householdId, kind: "children" }] });
    await setSeatNumber(s.planner.ctx, { occasionId: s.occ, guestId: s.guestId("Ana Popescu"), seatNo: 3 });
    const popCtx = await guestCtx(s.pop.token);
    const ionCtx = await guestCtx(s.ion.token);

    // unpublished: invisible, both through the function and through the guest page view
    expect(await getGuestSeat(popCtx)).toBeNull();
    expect((await getGuestView(popCtx)).sections.find((x) => x.key === "seat")).toBeUndefined();

    await publishSeating(s.planner.ctx, { occasionId: s.occ });
    const [settings] = await t.db.select().from(occasionGuestSettings).where(eq(occasionGuestSettings.occasionId, s.occ));
    expect(settings).toMatchObject({ guestRevisionReasonKey: "seating.changes.published" });
    const before = settings!.guestRevision;
    await publishSeating(s.planner.ctx, { occasionId: s.occ }); // publishing twice does not bump again
    expect((await t.db.select().from(occasionGuestSettings).where(eq(occasionGuestSettings.occasionId, s.occ)))[0]!.guestRevision).toBe(before);

    const seat = (await getGuestSeat(popCtx))!;
    expect(seat.places).toEqual([
      { tableLabel: "2", tableItemId: s.big.id, who: { kind: "guest", name: "Ana Popescu" }, seatNo: 3 },
      { tableLabel: "2", tableItemId: s.big.id, who: { kind: "guest", name: "Dan Popescu" }, seatNo: null },
      { tableLabel: "2", tableItemId: s.big.id, who: { kind: "children", count: 2 }, seatNo: null },
    ]);
    // the mini plan holds their table and the fixtures — not the other table, no counts, no names
    expect(seat.plan!.items.map((i) => i.name).sort()).toEqual(["Candy bar", "Masă mare"]);
    expect(JSON.stringify(seat)).not.toContain("Ionescu");
    const section = (await getGuestView(popCtx)).sections.find((x) => x.key === "seat");
    expect(section?.data).toMatchObject({ places: expect.any(Array) });
    expect(JSON.stringify((await getGuestView(ionCtx)).sections)).not.toContain("Popescu");
    expect((await getGuestSeat(ionCtx))!.places).toHaveLength(1);
    // planners and strangers are not guests
    expect(await code(getGuestSeat(s.planner.ctx))).toBe("NOT_FOUND");

    await unpublishSeating(s.planner.ctx, { occasionId: s.occ });
    expect(await getGuestSeat(popCtx)).toBeNull();
    expect((await getGuestView(popCtx)).sections.find((x) => x.key === "seat")).toBeUndefined();
  });

  it("V9/V10: the guest space view shows POIs and parking facts from the same model — no tables", async () => {
    const v = await mkVenue();
    const spaceId = await mkSpace(v);
    await decideRevision(moderator, { id: (await submitParking(v.owner.ctx, { listingId: v.listingId, onSite: true, spaceCount: 40, onStreet: null, paid: false, accessibleSpaces: true, walkingDistanceM: null })).id, decision: "approve" });
    const planner = await mkAccount();
    const occ = await mkOccasion(planner.id, { listingId: v.listingId });
    const h = await createHousehold(planner.ctx, { occasionId: occ, name: "Familia Pop", guestNames: ["Ion Pop"] });
    const g = await guestCtx(h.token);
    expect(await getGuestSpaceView(g)).toBeNull(); // no space model yet
    await attachVenueSpace(planner.ctx, { occasionId: occ, spaceId });
    await addTable(planner.ctx, { occasionId: occ, tableTypeId: "round10" });
    const view = (await getGuestSpaceView(g))!;
    expect(view.pois).toEqual([{ index: 1, kind: "toilets", name: "Toalete" }, { index: 2, kind: "bar", name: null }]);
    expect(view.plan!.items.every((i) => i.kind === "fixture")).toBe(true);
    expect(view.plan!.tableTypes).toEqual([]);
    expect(view.parking).toMatchObject({ onSite: true, spaceCount: 40, onStreet: null, walkingDistanceM: null });
    expect((await getGuestView(g)).sections.map((x) => x.key)).toContain("spaceView");
    // a guest never reaches planner reads
    expect(await code(getSpaceModel(g, occ))).toBe("NOT_FOUND");
  });

  it("seating.applyLayout: fit-checked proposal, applied only on confirm; seating CSV for managers", async () => {
    const s = await setup();
    const input = {
      tables: [
        { itemId: s.big.id, x: 12_000, y: 6000, guestIds: [s.guestId("Maria Ionescu")] },
        { custom: { name: "Masă nouă", shape: "round" as const, diameterMm: 1800, seats: 8 }, label: "Nași", x: 16_000, y: 6000, guestIds: [s.guestId("Ana Popescu")], groups: [{ householdId: s.pop.householdId, kind: "children" as const }] },
      ],
    };
    const preview = await createPreview(s.planner.ctx, { kind: "seating.applyLayout", occasionId: s.occ, subjectType: "occasion", subjectId: s.occ, input });
    expect(preview.delta.map((d) => d.key)).toEqual(expect.arrayContaining([`table:${s.big.id}`, "table:new-1", "fit"]));
    // nothing moved, nobody seated
    expect((await t.db.select().from(planItems).where(eq(planItems.id, s.big.id)))[0]).toMatchObject({ x: 10_000, y: 4000 });
    expect(await t.db.select().from(seatAssignments).where(eq(seatAssignments.occasionId, s.occ))).toEqual([]);
    // a proposal that seats too many is refused when applied — and then nothing of it sticks
    const tooMany = await createPreview(s.planner.ctx, {
      kind: "seating.applyLayout",
      occasionId: s.occ,
      subjectType: "occasion",
      subjectId: s.occ,
      input: { tables: [{ custom: { name: "Minusculă", shape: "round", diameterMm: 800, seats: 1 }, x: 2000, y: 9000, guestIds: [s.guestId("Ana Popescu"), s.guestId("Dan Popescu")] }] },
    });
    expect(await key(confirmPreview(s.planner.ctx, tooMany.id))).toBe("seating.errors.tableFull");
    expect((await t.db.select().from(planItems).where(eq(planItems.occasionId, s.occ))).some((r) => r.name === "Minusculă")).toBe(false);
    expect((await t.db.select().from(whatifPreviews).where(eq(whatifPreviews.id, tooMany.id)))[0]!.state).toBe("pending");

    await confirmPreview(s.planner.ctx, preview.id);
    expect((await t.db.select().from(planItems).where(eq(planItems.id, s.big.id)))[0]).toMatchObject({ x: 12_000, y: 6000 });
    const summary = await getSeatingSummary(s.planner.ctx, s.occ);
    expect(summary.tables.find((x) => x.label === "Nași")).toMatchObject({ source: "custom", seated: 3 });

    const csv = await runExport(s.planner.ctx, s.occ, "seating");
    expect(csv.content).toContain("Nași");
    // children appear only as a count, in the occasion's language, and without a formula-guard apostrophe
    expect(csv.content).toContain("Copii: 2");
    expect(csv.content).not.toContain("'");
    expect(csv.content.split("\r\n")[0]).toBe("\ufeffMasa,Locul,Familia,Invitat,Locuri,Răspuns");
    const stranger = await mkAccount();
    expect(await code(runExport(stranger.ctx, s.occ, "seating"))).toBe("NOT_FOUND");
  });

  it("purging the occasion's rows leaves nothing behind", async () => {
    const s = await setup();
    await assignSeats(s.planner.ctx, { occasionId: s.occ, tableItemId: s.big.id, guestIds: [s.guestId("Maria Ionescu")] });
    await t.db.execute(sql`delete from space_models where occasion_id = ${s.occ}`);
    expect(await t.db.select().from(planItems).where(eq(planItems.occasionId, s.occ))).toEqual([]);
    expect(await t.db.select().from(seatAssignments).where(eq(seatAssignments.occasionId, s.occ))).toEqual([]);
    expect(await t.db.select().from(spaceModels).where(eq(spaceModels.occasionId, s.occ))).toEqual([]);
    void assets;
    void systemCtx;
  });
});
