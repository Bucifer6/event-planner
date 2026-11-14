import {
  and,
  asc,
  desc,
  drawingVersions,
  eq,
  inArray,
  listingParking,
  listingRevisions,
  listings,
  spaces,
  sql,
  type Calibration,
  type DrawingSnapshot,
  type ParkingFacts,
  type SpaceMarkings,
} from "@ed/db";
import { AppError } from "@ed/shared/errors";
import { zId } from "@ed/shared/zod";
import { getAsset, getAssetUrl, openSignedAsset, registerUploadPurpose, signAssetLink, uploadAsset } from "@ed/storage";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { audit } from "./audit";
import type { BusinessRole } from "./business";
import { systemCtx, type Ctx } from "./context";
import { requireListingMember } from "./listings";
import { registerModerationKind, submitForModeration, type ModerationField, type ModerationRevision } from "./moderation";
import {
  calibrationScale,
  markingsEmpty,
  mmToMetresText,
  modelFromSnapshot,
  zMm,
  zSpaceMarkings,
  type PlanModel,
  shapeUsesDiameter,
} from "./spacemodel";
import { inTx } from "./tx";

// VENUE DRAWINGS (P-06, PRD V1–V3, V7, V8, V10, V11) — the business side and the public read.
//
//   createSpace / updateSpaceDetails          a space of a venue listing with its stated real size (V1)
//   attachDrawing(ctx, { spaceId, assetId })  the drawing: PNG/JPG, or a PDF whose first page is
//                                             turned into a picture when `pdftoppm` is installed
//   calibrateSpace(ctx, { two points, distance })   V7: derives the scale (mm per pixel)
//   saveMarkings(ctx, { spaceId, markings })  V2, V8, V11 — REFUSED until the drawing is calibrated
//   submitSpace(ctx, { spaceId })             queues the working copy for a moderator (V3)
//   submitParking(ctx, { listingId, facts })  V10 parking facts, moderated the same way
//   getListingSpaces(ctx, listingId)          what the public / a planner sees: approved versions only
//   onDrawingVersionPublished(fn)             hook: seating proposes the update to planners (V4)
//
// The business edits a WORKING COPY (the `spaces` row). Nothing is public until a moderator
// approves; approval writes an immutable `drawing_versions` row (version n+1, effective now)
// and the previous version stays live until that moment.

export type Space = typeof spaces.$inferSelect;
export type DrawingVersion = typeof drawingVersions.$inferSelect;
export type { DrawingSnapshot, ParkingFacts, SpaceMarkings } from "@ed/db";

export const DRAWING_KIND = "drawing";
export const PARKING_KIND = "parking";
export const DRAWING_UPLOAD_PURPOSE = "business.drawing";
export const MAX_SPACES_PER_LISTING = 12;

const EMPTY: SpaceMarkings = { areas: [], tableTypes: [], fixtures: [], pois: [], parkingAreas: [] };
const UNKNOWN_FACTS: ParkingFacts = { onSite: null, spaceCount: null, onStreet: null, paid: null, accessibleSpaces: null, walkingDistanceM: null, countConfirmedFor: null };

const nameSchema = z.string().trim().min(1, "common.validation.required").max(120, "common.validation.tooLong");
const optMm = zMm.nullable().optional();

/* ── Access ───────────────────────────────────────────────────────────────────────────── */

async function loadSpace(ctx: Ctx, spaceId: string): Promise<Space> {
  const id = zId.safeParse(spaceId);
  if (!id.success) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  const [row] = await ctx.db.select().from(spaces).where(eq(spaces.id, id.data));
  if (!row) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  return row;
}

/** The space + the actor's membership of its business. Non-members get NOT_FOUND. */
export async function requireSpaceMember(ctx: Ctx, spaceId: string, opts: { write?: boolean } = {}) {
  const space = await loadSpace(ctx, spaceId);
  const access = await requireListingMember(ctx, space.listingId);
  if (opts.write) {
    // W3: a restricted or suspended business cannot change its content
    if (access.business.status !== "active") throw new AppError("FORBIDDEN", `business.errors.${access.business.status}`);
    if (space.status === "retired") throw new AppError("CONFLICT", "drawings.errors.retired");
  }
  return { space, ...access };
}

/** Optimistic concurrency of the editor: a stale tab gets a clear message instead of overwriting. */
async function writeSpace(ctx: Ctx, space: Space, expectedVersion: number | undefined, set: Partial<typeof spaces.$inferInsert>): Promise<Space> {
  const [row] = await ctx.db
    .update(spaces)
    .set({ ...set, dirty: true, version: sql`${spaces.version} + 1` })
    .where(and(eq(spaces.id, space.id), eq(spaces.version, expectedVersion ?? space.version)))
    .returning();
  if (!row) throw new AppError("CONFLICT", "drawings.errors.conflict");
  return row;
}

/* ── Spaces (V1) ──────────────────────────────────────────────────────────────────────── */

const createInput = z.object({ listingId: zId, name: nameSchema, widthMm: optMm, lengthMm: optMm });

export async function createSpace(ctx: Ctx, input: z.input<typeof createInput>): Promise<Space> {
  const data = createInput.parse(input);
  const { listing, business } = await requireListingMember(ctx, data.listingId);
  if (business.status !== "active") throw new AppError("FORBIDDEN", `business.errors.${business.status}`);
  if (listing.status === "retired") throw new AppError("CONFLICT", "drawings.errors.listingRetired");
  return inTx(ctx, async (tx) => {
    const existing = await tx.db.select({ id: spaces.id }).from(spaces).where(and(eq(spaces.listingId, listing.id), sql`${spaces.status} <> 'retired'`));
    if (existing.length >= MAX_SPACES_PER_LISTING) throw new AppError("LIMIT", "drawings.errors.tooManySpaces", { params: { max: MAX_SPACES_PER_LISTING } });
    const [row] = await tx.db
      .insert(spaces)
      .values({ listingId: listing.id, businessId: business.id, name: data.name, widthMm: data.widthMm ?? null, lengthMm: data.lengthMm ?? null, markings: EMPTY })
      .returning();
    await audit(tx, { action: "space.created", objectType: "space", objectId: row!.id, after: { name: row!.name, listingId: listing.id } });
    return row!;
  });
}

const detailsInput = z.object({ spaceId: zId, name: nameSchema, widthMm: optMm, lengthMm: optMm, version: z.number().int().optional() });

export async function updateSpaceDetails(ctx: Ctx, input: z.input<typeof detailsInput>): Promise<Space> {
  const data = detailsInput.parse(input);
  const { space } = await requireSpaceMember(ctx, data.spaceId, { write: true });
  return writeSpace(ctx, space, data.version, { name: data.name, widthMm: data.widthMm ?? null, lengthMm: data.lengthMm ?? null });
}

/** Withdraws a space: it leaves the listing page; planners who already use a version keep it (V4). */
export async function retireSpace(ctx: Ctx, input: { spaceId: string }): Promise<void> {
  const { space } = await requireSpaceMember(ctx, input.spaceId, { write: true });
  await inTx(ctx, async (tx) => {
    await tx.db
      .update(listingRevisions)
      .set({ state: "withdrawn", decidedAt: tx.now })
      .where(and(eq(listingRevisions.kind, DRAWING_KIND), eq(listingRevisions.subjectId, space.id), eq(listingRevisions.state, "pending")));
    await tx.db.update(spaces).set({ status: "retired", liveVersionId: null }).where(eq(spaces.id, space.id));
    await audit(tx, { action: "space.retired", objectType: "space", objectId: space.id });
  });
}

/* ── The drawing file ─────────────────────────────────────────────────────────────────── */

/** Pixel size from the file header (PNG IHDR / JPEG SOFn). null when it cannot be read. */
export function imagePixelSize(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length >= 24 && bytes.readUInt32BE(0) === 0x89504e47) {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = bytes[i + 1]!;
      if (marker === 0xff) {
        i++;
        continue;
      }
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: bytes.readUInt16BE(i + 5), width: bytes.readUInt16BE(i + 7) };
      }
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
        i += 2;
        continue;
      }
      i += 2 + bytes.readUInt16BE(i + 2);
    }
  }
  return null;
}

/** For tests and deployments: replace how a PDF's first page becomes a PNG (null = cannot). */
export type PdfRasteriser = (pdf: Buffer) => Promise<Buffer | null>;

const g = globalThis as unknown as { __edPdfRasteriser?: PdfRasteriser; __edDrawingPublished?: DrawingPublishedHook[] };

/**
 * Default rasteriser: poppler's `pdftoppm` (PDF_RASTERISER_BIN overrides the binary). When it
 * is not installed the PDF is still stored — the business is told to upload a picture to
 * calibrate (operator note: install poppler-utils on web hosts to enable PDF drawings).
 */
/** Long side of the picture made from a PDF drawing, in pixels. */
export const PDF_RASTER_LONG_SIDE_PX = 3000;

/**
 * Arguments for pdftoppm: first page only, as PNG, with its long side FIXED in pixels. The
 * size must not follow the page's own dimensions: a PDF of a few hundred bytes can declare a
 * page 200 inches wide, and rendering that at a fixed resolution takes gigabytes of memory.
 */
export function pdfRasteriserArgs(input: string, outputBase: string): string[] {
  return ["-png", "-scale-to", String(PDF_RASTER_LONG_SIDE_PX), "-f", "1", "-l", "1", "-singlefile", input, outputBase];
}

async function pdftoppmRasteriser(pdf: Buffer): Promise<Buffer | null> {
  const bin = process.env.PDF_RASTERISER_BIN || "pdftoppm";
  const dir = await mkdtemp(join(tmpdir(), "ed-drawing-"));
  try {
    await writeFile(join(dir, "in.pdf"), pdf);
    await new Promise<void>((resolve, reject) => {
      execFile(bin, pdfRasteriserArgs(join(dir, "in.pdf"), join(dir, "page")), { timeout: 30_000 }, (err) => (err ? reject(err) : resolve()));
    });
    return await readFile(join(dir, "page.png"));
  } catch {
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export function setPdfRasteriser(fn: PdfRasteriser | null): void {
  g.__edPdfRasteriser = fn ?? undefined;
}

async function assetBytes(ctx: Ctx, assetId: string): Promise<Buffer> {
  const expires = Math.floor(ctx.now.getTime() / 1000) + 60;
  const served = await openSignedAsset({ db: ctx.db, now: ctx.now }, { assetId, expires, signature: signAssetLink(assetId, expires) });
  return served.bytes;
}

const attachInput = z.object({ spaceId: zId, assetId: zId, version: z.number().int().optional() });

/**
 * Sets (or replaces) the drawing of a space. The file was uploaded through @ed/storage with
 * purpose "business.drawing" (PNG/JPG re-encoded, PDF accepted for drawings only — Q9).
 * Replacing the drawing voids the calibration and with it every marking (V7: no markings
 * without a scale).
 */
export async function attachDrawing(ctx: Ctx, input: z.input<typeof attachInput>): Promise<Space & { pdfWithoutPicture: boolean }> {
  const data = attachInput.parse(input);
  const { space, business } = await requireSpaceMember(ctx, data.spaceId, { write: true });
  const asset = await getAsset(ctx, data.assetId);
  if (asset.ownerType !== "business" || asset.ownerId !== business.id) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");

  let displayAssetId: string | null = null;
  let size: { width: number; height: number } | null = null;
  if (asset.kind === "image") {
    displayAssetId = asset.id;
    size = imagePixelSize(await assetBytes(ctx, asset.id));
  } else {
    const png = await (g.__edPdfRasteriser ?? pdftoppmRasteriser)(await assetBytes(ctx, asset.id));
    if (png) {
      const picture = await uploadAsset(systemCtx(ctx.db, { now: ctx.now }), {
        ownerType: "business",
        ownerId: business.id,
        file: { name: `${asset.name.replace(/\.pdf$/i, "")}.png`, bytes: png, mime: "image/png" },
      });
      displayAssetId = picture.id;
      size = imagePixelSize(await assetBytes(ctx, picture.id));
    }
  }
  if (displayAssetId && !size) throw new AppError("VALIDATION", "platform.upload.unreadableImage", { fieldErrors: { file: ["platform.upload.unreadableImage"] } });

  const row = await writeSpace(ctx, space, data.version, {
    drawingAssetId: asset.id,
    displayAssetId,
    pixelWidth: size?.width ?? null,
    pixelHeight: size?.height ?? null,
    calibration: null,
    mmPerPx: null,
    markings: EMPTY,
  });
  await audit(ctx, { action: "space.drawingAttached", objectType: "space", objectId: space.id, after: { assetId: asset.id, kind: asset.kind, picture: displayAssetId !== null } });
  return { ...row, pdfWithoutPicture: asset.kind === "pdf" && displayAssetId === null };
}

/* ── Calibration (V7) ─────────────────────────────────────────────────────────────────── */

const px = z.number("common.validation.invalid").min(0).max(100_000);
const calibrateInput = z.object({
  spaceId: zId,
  ax: px,
  ay: px,
  bx: px,
  by: px,
  /** The real distance between the two points, in millimetres. */
  distanceMm: z.number("common.validation.invalid").int("common.validation.invalid").min(100, "drawings.errors.distanceTooSmall").max(1_000_000, "common.validation.tooBig"),
  version: z.number().int().optional(),
});

function scaleMarkings(m: SpaceMarkings, k: number): SpaceMarkings {
  const p = (pt: { x: number; y: number }) => ({ x: Math.round(pt.x * k), y: Math.round(pt.y * k) });
  return {
    // real sizes of tables and fixtures are STATED — only positions follow the scale
    tableTypes: m.tableTypes,
    areas: m.areas.map((a) => ({ ...a, points: a.points.map(p) })),
    fixtures: m.fixtures.map((f) => ({ ...f, ...p(f) })),
    pois: m.pois.map((o) => ({ ...o, ...p(o) })),
    parkingAreas: m.parkingAreas.map((a) => ({ ...a, points: a.points.map(p) })),
  };
}

/**
 * V7: two points on the drawing (in picture pixels) and the real distance between them give
 * the scale. Until this is done the drawing is only a picture. Re-calibrating keeps the
 * markings where they are on the picture and recomputes their real positions.
 */
export async function calibrateSpace(ctx: Ctx, input: z.input<typeof calibrateInput>): Promise<Space> {
  const data = calibrateInput.parse(input);
  const { space } = await requireSpaceMember(ctx, data.spaceId, { write: true });
  if (!space.displayAssetId || !space.pixelWidth || !space.pixelHeight) throw new AppError("CONFLICT", "drawings.errors.noPicture");
  const inside = (x: number, y: number) => x <= space.pixelWidth! && y <= space.pixelHeight!;
  if (!inside(data.ax, data.ay) || !inside(data.bx, data.by)) throw new AppError("VALIDATION", "drawings.errors.pointOutside");
  const calibration: Calibration = { ax: data.ax, ay: data.ay, bx: data.bx, by: data.by, distanceMm: data.distanceMm };
  const mmPerPx = calibrationScale(calibration);
  if (mmPerPx === null) throw new AppError("VALIDATION", "drawings.errors.pointsTooClose");
  const markings = space.mmPerPx ? scaleMarkings(space.markings, mmPerPx / space.mmPerPx) : space.markings;
  const row = await writeSpace(ctx, space, data.version, { calibration, mmPerPx, markings });
  await audit(ctx, { action: "space.calibrated", objectType: "space", objectId: space.id, after: { mmPerPx } });
  return row;
}

/* ── Markings (V2, V8, V11) ───────────────────────────────────────────────────────────── */

/** V7 in one place: a drawing without a scale can carry no markings. */
export function assertCalibrated(space: Pick<Space, "mmPerPx">): void {
  if (space.mmPerPx === null || space.mmPerPx === undefined) throw new AppError("CONFLICT", "drawings.errors.notCalibrated");
}

const markingsInput = z.object({ spaceId: zId, markings: zSpaceMarkings, version: z.number().int().optional() });

/** Replaces the markings of the working copy (areas, table inventory, fixtures, POIs, parking areas). */
export async function saveMarkings(ctx: Ctx, input: z.input<typeof markingsInput>): Promise<Space> {
  const data = markingsInput.parse(input);
  const { space } = await requireSpaceMember(ctx, data.spaceId, { write: true });
  assertCalibrated(space);
  for (const t of data.markings.tableTypes) {
    // a size is stated whole or not at all: a round table by its diameter, a rectangular one by both sides
    if (shapeUsesDiameter(t.shape)) {
      t.widthMm = null;
      t.lengthMm = null;
    } else {
      t.diameterMm = null;
      if ((t.widthMm === null) !== (t.lengthMm === null)) throw new AppError("VALIDATION", "drawings.errors.bothSides");
    }
  }
  for (const f of data.markings.fixtures) {
    if ((f.widthMm === null) !== (f.lengthMm === null)) throw new AppError("VALIDATION", "drawings.errors.bothSides");
  }
  const ids = [...data.markings.areas, ...data.markings.tableTypes, ...data.markings.fixtures, ...data.markings.pois, ...data.markings.parkingAreas].map((m) => m.id);
  if (new Set(ids).size !== ids.length) throw new AppError("VALIDATION", "common.validation.invalid");
  return writeSpace(ctx, space, data.version, { markings: data.markings });
}

/* ── Moderation (V3) ──────────────────────────────────────────────────────────────────── */

export function spaceSnapshot(space: Space): DrawingSnapshot {
  return {
    name: space.name,
    widthMm: space.widthMm,
    lengthMm: space.lengthMm,
    drawingAssetId: space.drawingAssetId,
    displayAssetId: space.displayAssetId,
    pixelWidth: space.pixelWidth,
    pixelHeight: space.pixelHeight,
    calibration: space.calibration,
    mmPerPx: space.mmPerPx,
    markings: space.mmPerPx === null ? EMPTY : space.markings,
  };
}

async function liveVersion(ctx: Pick<Ctx, "db">, space: Pick<Space, "liveVersionId">): Promise<DrawingVersion | null> {
  if (!space.liveVersionId) return null;
  const [row] = await ctx.db.select().from(drawingVersions).where(eq(drawingVersions.id, space.liveVersionId));
  return row ?? null;
}

/** Queues the working copy for a moderator. The live version (if any) stays up meanwhile. */
export async function submitSpace(ctx: Ctx, input: { spaceId: string }): Promise<ModerationRevision> {
  const { space, listing, business } = await requireSpaceMember(ctx, input.spaceId, { write: true });
  if (listing.status === "retired") throw new AppError("CONFLICT", "drawings.errors.listingRetired");
  if (!space.drawingAssetId && space.widthMm === null && space.lengthMm === null) throw new AppError("VALIDATION", "drawings.errors.nothingToSubmit");
  const live = await liveVersion(ctx, space);
  return inTx(ctx, async (tx) => {
    const rev = await submitForModeration(tx, {
      kind: DRAWING_KIND,
      subjectId: space.id,
      payload: spaceSnapshot(space),
      basePayload: live?.snapshot,
      listingId: listing.id,
      businessId: business.id,
    });
    await tx.db
      .update(spaces)
      .set({ dirty: false, status: space.status === "draft" ? "pending" : space.status })
      .where(eq(spaces.id, space.id));
    return rev;
  });
}

export type DrawingPublishedHook = (txCtx: Ctx, version: DrawingVersion, previous: DrawingVersion | null) => Promise<void>;
const publishedHooks: DrawingPublishedHook[] = (g.__edDrawingPublished ??= []);

/** Runs inside the approving transaction, after the new version is live (seating → What-if proposals, V4). */
export function onDrawingVersionPublished(fn: DrawingPublishedHook): void {
  if (!publishedHooks.includes(fn)) publishedHooks.push(fn);
}

const yesNo = (v: boolean | null) => (v === null ? null : v ? "da" : "nu");
const metres = (mm: number | null) => (mm === null ? null : `${mmToMetresText(mm)} m`);

/** The before → after lines a moderator (and the business) reads. Plain facts, Romanian units. */
export function describeSnapshot(after: DrawingSnapshot, before: DrawingSnapshot | null): ModerationField[] {
  const line = (s: DrawingSnapshot | null): Record<string, string | null> => {
    if (!s) return {};
    const m = s.markings;
    return {
      name: s.name,
      width: metres(s.widthMm),
      length: metres(s.lengthMm),
      drawing: s.drawingAssetId ? (s.displayAssetId ? "imagine" : "PDF") : null,
      calibrated: s.mmPerPx === null ? "nu" : `da (${(s.mmPerPx / 10).toFixed(2)} cm/px)`,
      areas: m.areas.length ? String(m.areas.length) : null,
      tables:
        m.tableTypes
          .map((t) => `${t.name}: ${shapeUsesDiameter(t.shape) ? (t.diameterMm === null ? "?" : `⌀ ${mmToMetresText(t.diameterMm)} m`) : t.widthMm === null ? "?" : `${mmToMetresText(t.widthMm)} × ${mmToMetresText(t.lengthMm!)} m`}, ${t.seats ?? "?"} loc., ${t.count ?? "?"} buc.`)
          .join("; ") || null,
      fixtures: m.fixtures.map((f) => `${f.name}${f.widthMm === null ? " (?)" : ` (${mmToMetresText(f.widthMm)} × ${mmToMetresText(f.lengthMm!)} m)`}`).join("; ") || null,
      pois: m.pois.map((p) => p.name ?? p.kind).join("; ") || null,
      parkingAreas: m.parkingAreas.map((p) => `${p.name ?? "P"}: ${p.spaces ?? "?"}`).join("; ") || null,
    };
  };
  const a = line(after);
  const b = line(before);
  return Object.keys(a).map((key) => ({ key, labelKey: `drawings.moderation.fields.${key}`, before: b[key] ?? null, after: a[key] ?? null }));
}

function describeParking(f: ParkingFacts | null): Record<string, string | null> {
  if (!f) return {};
  return {
    onSite: yesNo(f.onSite),
    spaceCount: f.spaceCount === null ? null : String(f.spaceCount),
    onStreet: yesNo(f.onStreet),
    paid: yesNo(f.paid),
    accessibleSpaces: yesNo(f.accessibleSpaces),
    walkingDistanceM: f.walkingDistanceM === null ? null : `${f.walkingDistanceM} m`,
    countConfirmed: f.countConfirmedFor ? `da (${f.countConfirmedFor.stated})` : null,
  };
}

function registerKinds(): void {
  registerModerationKind(DRAWING_KIND, {
    labelKey: "drawings.moderation.kind",
    describe: async (_ctx, rev) => {
      const after = rev.payload as DrawingSnapshot;
      return {
        title: after.name,
        fields: describeSnapshot(after, (rev.basePayload as DrawingSnapshot | null) ?? null),
        imageAssetIds: after.displayAssetId ? [after.displayAssetId] : [],
      };
    },
    apply: async (tx, rev) => {
      const [space] = await tx.db.select().from(spaces).where(eq(spaces.id, rev.subjectId)).for("update");
      if (!space || space.status === "retired") throw new AppError("CONFLICT", "drawings.errors.retired");
      const snapshot = rev.payload as DrawingSnapshot;
      // V7 again at the door: markings without a scale never become live
      if (snapshot.mmPerPx === null && !markingsEmpty(snapshot.markings)) throw new AppError("CONFLICT", "drawings.errors.notCalibrated");
      const previous = await liveVersion(tx, space);
      const [version] = await tx.db
        .insert(drawingVersions)
        .values({ spaceId: space.id, listingId: space.listingId, versionNo: (previous?.versionNo ?? 0) + 1, snapshot, effectiveAt: tx.now, revisionId: rev.id })
        .returning();
      await tx.db.update(spaces).set({ status: "live", liveVersionId: version!.id }).where(eq(spaces.id, space.id));
      for (const hook of publishedHooks) await hook(tx, version!, previous);
    },
    onRejected: async (tx, rev) => {
      await tx.db
        .update(spaces)
        .set({ dirty: true, status: sql`case when ${spaces.liveVersionId} is null then 'draft' else ${spaces.status} end` })
        .where(eq(spaces.id, rev.subjectId));
    },
    onWithdrawn: async (tx, rev) => {
      await tx.db
        .update(spaces)
        .set({ dirty: true, status: sql`case when ${spaces.liveVersionId} is null and ${spaces.status} <> 'retired' then 'draft' else ${spaces.status} end` })
        .where(eq(spaces.id, rev.subjectId));
    },
  });

  registerModerationKind(PARKING_KIND, {
    labelKey: "drawings.moderation.parkingKind",
    describe: async (ctx, rev) => {
      const a = describeParking(rev.payload as ParkingFacts);
      const b = describeParking((rev.basePayload as ParkingFacts | null) ?? null);
      const [listing] = rev.listingId ? await ctx.db.select({ name: listings.name }).from(listings).where(eq(listings.id, rev.listingId)) : [];
      return {
        title: listing?.name ?? rev.subjectId,
        fields: Object.keys(a).map((key) => ({ key, labelKey: `drawings.moderation.parkingFields.${key}`, before: b[key] ?? null, after: a[key] ?? null })),
      };
    },
    apply: async (tx, rev) => {
      if (!rev.listingId || !rev.businessId) throw new AppError("CONFLICT", "common.errors.CONFLICT");
      await tx.db
        .insert(listingParking)
        .values({ listingId: rev.listingId, businessId: rev.businessId, live: rev.payload as ParkingFacts, liveAt: tx.now })
        .onConflictDoUpdate({ target: listingParking.listingId, set: { live: rev.payload as ParkingFacts, liveAt: tx.now } });
    },
  });

  registerUploadPurpose(DRAWING_UPLOAD_PURPOSE, { ownerType: "business", allowPdf: true });
}
registerKinds();

/* ── Parking facts (V10, V11) ─────────────────────────────────────────────────────────── */

const tri = z.boolean().nullable();
const parkingInput = z.object({
  listingId: zId,
  onSite: tri,
  spaceCount: z.number().int().min(0, "common.validation.tooSmall").max(100_000, "common.validation.tooBig").nullable(),
  onStreet: tri,
  paid: tri,
  accessibleSpaces: tri,
  walkingDistanceM: z.number().int().min(0, "common.validation.tooSmall").max(20_000, "common.validation.tooBig").nullable(),
  /** "The stated number is right even though the drawings add up differently" (V11). */
  confirmCount: z.boolean().default(false),
});
export type ParkingInput = z.input<typeof parkingInput>;

/** Places drawn on the listing's parking areas; null when nothing is drawn or a drawn area has no count. */
export function drawnParkingSpaces(snapshots: DrawingSnapshot[]): number | null {
  const areas = snapshots.flatMap((s) => (s.mmPerPx === null ? [] : s.markings.parkingAreas));
  if (areas.length === 0 || areas.some((a) => a.spaces === null)) return null;
  return areas.reduce((n, a) => n + a.spaces!, 0);
}

export type ParkingView = {
  /** true = on site; false = "fără parcare pe loc", stated; null = unknown */
  onSite: boolean | null;
  /** null = unknown — also when the drawings and the stated number disagree and nobody confirmed (V11) */
  spaceCount: number | null;
  /** V11: the stated and the drawn number disagree and the business has not confirmed. */
  countMismatch: { stated: number; drawn: number } | null;
  onStreet: boolean | null;
  paid: boolean | null;
  accessibleSpaces: boolean | null;
  walkingDistanceM: number | null;
};

/** What may be SHOWN: each fact known or unknown; a mismatching count is unknown until confirmed (V11). */
export function parkingView(facts: ParkingFacts | null, drawn: number | null): ParkingView {
  const f = facts ?? UNKNOWN_FACTS;
  let spaceCount = f.onSite === false ? null : f.spaceCount;
  let countMismatch: ParkingView["countMismatch"] = null;
  if (spaceCount !== null && drawn !== null && drawn !== spaceCount) {
    const ok = f.countConfirmedFor && f.countConfirmedFor.stated === spaceCount && f.countConfirmedFor.drawn === drawn;
    if (!ok) {
      countMismatch = { stated: spaceCount, drawn };
      spaceCount = null;
    }
  }
  return { onSite: f.onSite, spaceCount, countMismatch, onStreet: f.onStreet, paid: f.paid, accessibleSpaces: f.accessibleSpaces, walkingDistanceM: f.walkingDistanceM };
}

async function liveSnapshots(ctx: Pick<Ctx, "db">, listingId: string): Promise<Array<{ space: Space; version: DrawingVersion }>> {
  const rows = await ctx.db
    .select({ space: spaces, version: drawingVersions })
    .from(spaces)
    .innerJoin(drawingVersions, eq(drawingVersions.id, spaces.liveVersionId))
    .where(and(eq(spaces.listingId, listingId), eq(spaces.status, "live")))
    .orderBy(asc(spaces.createdAt));
  return rows;
}

/** Queues the listing's parking facts for a moderator; the live facts stay up meanwhile. */
export async function submitParking(ctx: Ctx, input: ParkingInput): Promise<ModerationRevision> {
  const data = parkingInput.parse(input);
  const { listing, business } = await requireListingMember(ctx, data.listingId);
  if (business.status !== "active") throw new AppError("FORBIDDEN", `business.errors.${business.status}`);
  if (listing.status === "retired") throw new AppError("CONFLICT", "drawings.errors.listingRetired");
  const drawn = drawnParkingSpaces((await liveSnapshots(ctx, listing.id)).map((r) => r.version.snapshot));
  const spaceCount = data.onSite === false ? null : data.spaceCount;
  const facts: ParkingFacts = {
    onSite: data.onSite,
    spaceCount,
    onStreet: data.onStreet,
    paid: data.paid,
    accessibleSpaces: data.onSite === false ? null : data.accessibleSpaces,
    walkingDistanceM: data.walkingDistanceM,
    countConfirmedFor: data.confirmCount && spaceCount !== null && drawn !== null && drawn !== spaceCount ? { stated: spaceCount, drawn } : null,
  };
  const [current] = await ctx.db.select().from(listingParking).where(eq(listingParking.listingId, listing.id));
  return submitForModeration(ctx, { kind: PARKING_KIND, subjectId: listing.id, payload: facts, basePayload: current?.live ?? undefined, listingId: listing.id, businessId: business.id });
}

/* ── Business views ───────────────────────────────────────────────────────────────────── */

type PendingInfo = { revisionId: string; submittedAt: Date };
type RejectionInfo = { reason: string | null; decidedAt: Date | null };

async function revisionState(ctx: Ctx, kind: string, subjectIds: string[]): Promise<Map<string, { pending: PendingInfo | null; lastRejection: RejectionInfo | null; pendingPayload: unknown }>> {
  const out = new Map<string, { pending: PendingInfo | null; lastRejection: RejectionInfo | null; pendingPayload: unknown }>();
  if (subjectIds.length === 0) return out;
  const rows = await ctx.db
    .select()
    .from(listingRevisions)
    .where(and(eq(listingRevisions.kind, kind), inArray(listingRevisions.subjectId, subjectIds)))
    .orderBy(desc(listingRevisions.createdAt));
  for (const id of subjectIds) {
    const mine = rows.filter((r) => r.subjectId === id);
    const pending = mine.find((r) => r.state === "pending") ?? null;
    const latestDecided = mine.find((r) => r.state === "approved" || r.state === "rejected") ?? null;
    out.set(id, {
      pending: pending ? { revisionId: pending.id, submittedAt: pending.createdAt } : null,
      pendingPayload: pending?.payload ?? null,
      // shown until the business submits again or a later revision is approved
      lastRejection: !pending && latestDecided?.state === "rejected" ? { reason: latestDecided.decisionReason, decidedAt: latestDecided.decidedAt } : null,
    });
  }
  return out;
}

export type SpaceListItem = {
  id: string;
  name: string;
  status: Space["status"];
  hasDrawing: boolean;
  calibrated: boolean;
  dirty: boolean;
  liveVersionNo: number | null;
  liveEffectiveAt: Date | null;
  pending: PendingInfo | null;
  lastRejection: RejectionInfo | null;
};

export type ListingSpacesEditor = {
  listing: { id: string; name: string; status: string };
  businessId: string;
  role: BusinessRole;
  canEdit: boolean;
  spaces: SpaceListItem[];
  parking: {
    /** What is public now (after V11). */
    live: ParkingView | null;
    liveFacts: ParkingFacts | null;
    pending: (PendingInfo & { facts: ParkingFacts }) | null;
    lastRejection: RejectionInfo | null;
    /** Places drawn on approved drawings; null = none drawn / a count missing. */
    drawn: number | null;
  };
};

/** The business's page of spaces for one listing. Members only. */
export async function getListingSpacesEditor(ctx: Ctx, listingId: string): Promise<ListingSpacesEditor> {
  const { listing, business, role } = await requireListingMember(ctx, listingId);
  const rows = await ctx.db
    .select()
    .from(spaces)
    .where(and(eq(spaces.listingId, listing.id), sql`${spaces.status} <> 'retired'`))
    .orderBy(asc(spaces.createdAt));
  const versions = rows.some((r) => r.liveVersionId)
    ? await ctx.db
        .select()
        .from(drawingVersions)
        .where(inArray(drawingVersions.id, rows.map((r) => r.liveVersionId).filter((v): v is string => !!v)))
    : [];
  const rev = await revisionState(ctx, DRAWING_KIND, rows.map((r) => r.id));
  const parkRev = (await revisionState(ctx, PARKING_KIND, [listing.id])).get(listing.id)!;
  const [park] = await ctx.db.select().from(listingParking).where(eq(listingParking.listingId, listing.id));
  const drawn = drawnParkingSpaces(versions.filter((v) => rows.some((r) => r.status === "live" && r.liveVersionId === v.id)).map((v) => v.snapshot));
  return {
    listing: { id: listing.id, name: listing.name, status: listing.status },
    businessId: business.id,
    role,
    canEdit: business.status === "active" && listing.status !== "retired",
    spaces: rows.map((r) => {
      const v = versions.find((x) => x.id === r.liveVersionId) ?? null;
      return {
        id: r.id,
        name: r.name,
        status: r.status,
        hasDrawing: !!r.drawingAssetId,
        calibrated: r.mmPerPx !== null,
        dirty: r.dirty,
        liveVersionNo: v?.versionNo ?? null,
        liveEffectiveAt: v?.effectiveAt ?? null,
        pending: rev.get(r.id)?.pending ?? null,
        lastRejection: rev.get(r.id)?.lastRejection ?? null,
      };
    }),
    parking: {
      live: park?.live ? parkingView(park.live, drawn) : null,
      liveFacts: park?.live ?? null,
      pending: parkRev.pending ? { ...parkRev.pending, facts: parkRev.pendingPayload as ParkingFacts } : null,
      lastRejection: parkRev.lastRejection,
      drawn,
    },
  };
}

/** A short-lived link to a drawing picture. NO access check: call only after one. */
export async function signDrawingPicture(ctx: Pick<Ctx, "db" | "now">, assetId: string | null, ttlSeconds = 3600): Promise<string | null> {
  if (!assetId) return null;
  try {
    return await getAssetUrl(systemCtx(ctx.db, { now: ctx.now }), assetId, { ttlSeconds });
  } catch (e) {
    if (e instanceof AppError) return null; // a removed file simply does not show
    throw e;
  }
}

export type SpaceEditor = {
  space: Space;
  listing: { id: string; name: string; status: string };
  businessId: string;
  role: BusinessRole;
  canEdit: boolean;
  /** Link to the picture behind the plan; null = no drawing, or a PDF that could not be turned into a picture. */
  pictureUrl: string | null;
  /** The drawing is a PDF we could not rasterise: stored, but it cannot be calibrated. */
  pdfWithoutPicture: boolean;
  /** The working copy as a plan. */
  model: PlanModel;
  live: { versionNo: number; effectiveAt: Date; fields: ModerationField[] } | null;
  pending: (PendingInfo & { fields: ModerationField[] }) | null;
  lastRejection: RejectionInfo | null;
};

/** Everything the space editor shows. Members only. */
export async function getSpaceEditor(ctx: Ctx, spaceId: string): Promise<SpaceEditor> {
  const { space, listing, business, role } = await requireSpaceMember(ctx, spaceId);
  const live = await liveVersion(ctx, space);
  const rev = (await revisionState(ctx, DRAWING_KIND, [space.id])).get(space.id)!;
  return {
    space,
    listing: { id: listing.id, name: listing.name, status: listing.status },
    businessId: business.id,
    role,
    canEdit: business.status === "active" && listing.status !== "retired" && space.status !== "retired",
    pictureUrl: await signDrawingPicture(ctx, space.displayAssetId),
    pdfWithoutPicture: !!space.drawingAssetId && !space.displayAssetId,
    model: modelFromSnapshot(spaceSnapshot(space), { source: "drawing" }),
    live: live ? { versionNo: live.versionNo, effectiveAt: live.effectiveAt, fields: describeSnapshot(live.snapshot, null) } : null,
    pending: rev.pending ? { ...rev.pending, fields: describeSnapshot(rev.pendingPayload as DrawingSnapshot, live?.snapshot ?? null) } : null,
    lastRejection: rev.lastRejection,
  };
}

/* ── Public read (V3) ─────────────────────────────────────────────────────────────────── */

export type PublicSpace = {
  spaceId: string;
  versionId: string;
  versionNo: number;
  effectiveAt: Date;
  name: string;
  widthMm: number | null;
  lengthMm: number | null;
  /** false = stored but not calibrated: a picture only, no plan, cannot become a space model (V7). */
  calibrated: boolean;
  pictureUrl: string | null;
  model: PlanModel;
};

export type ListingSpaces = { spaces: PublicSpace[]; parking: ParkingView | null };

const publiclyVisible = sql`${listings.status} = 'live' and exists (select 1 from businesses b where b.id = ${listings.businessId} and b.status <> 'suspended')`;

async function toPublicSpace(ctx: Pick<Ctx, "db" | "now">, version: DrawingVersion): Promise<PublicSpace> {
  const s = version.snapshot;
  return {
    spaceId: version.spaceId,
    versionId: version.id,
    versionNo: version.versionNo,
    effectiveAt: version.effectiveAt,
    name: s.name,
    widthMm: s.widthMm,
    lengthMm: s.lengthMm,
    calibrated: s.mmPerPx !== null,
    pictureUrl: await signDrawingPicture(ctx, s.displayAssetId),
    model: modelFromSnapshot(s, { source: "venue", versionNo: version.versionNo, effectiveAt: version.effectiveAt }),
  };
}

/**
 * The approved spaces of a listing, for anyone who can see the listing (V3): the listing is
 * live and its business not suspended. Returns nothing otherwise — never a draft, never a
 * version waiting for a moderator.
 */
export async function getListingSpaces(ctx: Ctx, listingId: string): Promise<ListingSpaces> {
  const id = zId.safeParse(listingId);
  if (!id.success) return { spaces: [], parking: null };
  const [listing] = await ctx.db
    .select({ id: listings.id })
    .from(listings)
    .where(and(eq(listings.id, id.data), eq(listings.claimed, true), publiclyVisible));
  if (!listing) return { spaces: [], parking: null };
  const rows = await liveSnapshots(ctx, listing.id);
  const [park] = await ctx.db.select().from(listingParking).where(eq(listingParking.listingId, listing.id));
  const out: PublicSpace[] = [];
  for (const r of rows) out.push(await toPublicSpace(ctx, r.version));
  return {
    spaces: out,
    parking: park?.live ? parkingView(park.live, drawnParkingSpaces(rows.map((r) => r.version.snapshot))) : null,
  };
}

/** Internal: the live parking view of a listing, whatever its status. NO access check. */
export async function readListingParking(ctx: Pick<Ctx, "db">, listingId: string): Promise<ParkingView | null> {
  const [park] = await ctx.db.select().from(listingParking).where(eq(listingParking.listingId, listingId));
  if (!park?.live) return null;
  const rows = await liveSnapshots(ctx, listingId);
  return parkingView(park.live, drawnParkingSpaces(rows.map((r) => r.version.snapshot)));
}

/** Internal: one approved version. NO access check. */
export async function readDrawingVersion(ctx: Pick<Ctx, "db">, versionId: string): Promise<DrawingVersion | null> {
  const [row] = await ctx.db.select().from(drawingVersions).where(eq(drawingVersions.id, versionId));
  return row ?? null;
}

/** Internal: the live version of a space, only if the space is live. NO access check. */
export async function readLiveVersionOfSpace(ctx: Pick<Ctx, "db">, spaceId: string): Promise<DrawingVersion | null> {
  const [row] = await ctx.db
    .select({ version: drawingVersions })
    .from(spaces)
    .innerJoin(drawingVersions, eq(drawingVersions.id, spaces.liveVersionId))
    .where(and(eq(spaces.id, spaceId), eq(spaces.status, "live")));
  return row?.version ?? null;
}

