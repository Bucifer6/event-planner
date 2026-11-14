import {
  and,
  asc,
  bookings,
  desc,
  drawingVersions,
  eq,
  guests,
  households,
  inArray,
  mealStages,
  planItems,
  rsvpResponses,
  seatAssignments,
  seatingPlans,
  spaceModels,
  spaces,
  sql,
  stageItemStates,
  suppliers,
  whatifPreviews,
  type DrawingSnapshot,
  type RsvpAttending,
  type SeatKind,
  type TableType,
  type WhatIfDeltaRow,
  type WhatIfText,
} from "@ed/db";
import { translate } from "@ed/i18n";
import { AppError } from "@ed/shared/errors";
import { newId } from "@ed/shared/ids";
import { zId } from "@ed/shared/zod";
import { z } from "zod";
import { isManager, requireMember, type Member } from "./access";
import { audit } from "./audit";
import { systemCtx, type Ctx } from "./context";
import {
  onDrawingVersionPublished,
  readDrawingVersion,
  readListingParking,
  readLiveVersionOfSpace,
  signDrawingPicture,
  type DrawingVersion,
  type ParkingView,
} from "./drawings";
import { registerExport, toCsv } from "./exports";
import { checkFit, type FitResult } from "./fitcheck";
import { bumpGuestRevision, registerGuestSection, requireGuest } from "./invitations";
import { assertOccasionWritable } from "./lifecycle";
import { onOccasionPurge } from "./occasions";
import { getRsvpSummary } from "./rsvp";
import {
  applyStage,
  DEFAULT_AISLE_MM,
  insideAreas,
  itemFootprint,
  itemHasDims,
  mmToMetresText,
  modelBounds,
  modelFromSnapshot,
  ownSpaceAreas,
  polygonArea,
  SPACE_LIMITS,
  TABLE_SHAPE_VALUES,
  zCoordMm,
  zMm,
  zRotation,
  type PlanItem,
  type PlanModel,
  type StageItemState,
} from "./spacemodel";
import { inTx } from "./tx";
import { createPreview, registerWhatIf, type WhatIfPreview } from "./whatif";

// THE OCCASION'S SPACE MODEL, SEATING AND FIT CHECKS (P-06 V4–V6, V9; C-01, C-02, C-08).
//
// Space model (one per occasion)
//   listAttachableSpaces(ctx, occasionId)      venue spaces the occasion may use (see below)
//   attachVenueSpace(ctx, { occasionId, spaceId })   "Folosește planul locației" — freezes the live version
//   createOwnSpace(ctx, { occasionId, name, widthMm?, lengthMm? })   a planner-entered rectangle
//   getSpaceModel(ctx, occasionId)             THE read API (pages, MCP get_space_model)
//   proposeDrawingUpdate(ctx, occasionId)      newer approved version → What-if "space.updateDrawing"
//
// Which venue spaces may be attached (V3 + V4, decided): a space of a listing the occasion has
// a SUPPLIER RECORD for (created by an enquiry or added from the directory) whose booking is
// not cancelled — "a planner who opens a booking with the venue gets the drawing into their
// plan". Only a CALIBRATED approved version can be attached (V7).
//
// Layout (C-01)                                 every action is a plain call → equal tap path (Q8/Q10)
//   addTable / addFixture / moveItem / updateItem / removeItem
//   each item carries `version`: a stale writer gets CONFLICT "seating.errors.conflict"
//
// Meal stages (C-02)
//   listMealStages / addMealStage / renameMealStage / moveMealStage / removeMealStage / addDefaultStages
//   setStageItem(ctx, { stageId, itemId, present, x?, y?, rotation? })
//   getFitChecks(ctx, occasionId)              base layout + one result per stage
//
// Seats (C-01, C-08)
//   getSeatingRoster / assignSeats / unassignSeats / setSeatNumber
//   publishSeating / unpublishSeating          guests see their table only after publish
//   getGuestSeat(ctx)  ·  getGuestSpaceView(ctx)   guest actor only; own household only
//   getSeatingSummary(ctx, occasionId)         counts + fit, for the overview / MCP
//
// What-if kinds: "space.updateDrawing", "space.addCustomTable", "seating.applyLayout".

export type SpaceModelRow = typeof spaceModels.$inferSelect;
export type PlanItemRow = typeof planItems.$inferSelect;
export type MealStage = typeof mealStages.$inferSelect;

const READ_ROLES = ["owner", "pm", "workstream_lead", "contributor"] as const;
const text = (max: number) => z.string().trim().min(1, "common.validation.required").max(max, "common.validation.tooLong");
const optMm = zMm.nullable().optional();

async function readAccess(ctx: Ctx, occasionId: string): Promise<Member> {
  return requireMember(ctx, occasionId, { roles: [...READ_ROLES] });
}

async function writeAccess(ctx: Ctx, occasionId: string): Promise<Member> {
  const member = await requireMember(ctx, occasionId, { manage: true });
  if (ctx.actor.kind === "mcp") throw new AppError("FORBIDDEN", "common.errors.FORBIDDEN"); // MCP proposes, never writes
  await assertOccasionWritable(ctx, occasionId);
  return member;
}

/* ── Loading the model ────────────────────────────────────────────────────────────────── */

function rowToItem(r: PlanItemRow, seated?: number): PlanItem {
  return {
    id: r.id,
    kind: r.kind,
    source: r.source,
    venueRef: r.venueRef,
    name: r.name,
    label: r.label,
    shape: r.shape,
    diameterMm: r.diameterMm,
    widthMm: r.widthMm,
    lengthMm: r.lengthMm,
    seats: r.seats,
    x: r.x,
    y: r.y,
    rotation: r.rotation,
    version: r.version,
    seated,
  };
}

type Loaded = { row: SpaceModelRow; version: DrawingVersion | null; items: PlanItemRow[]; model: PlanModel };

function buildModel(row: SpaceModelRow, snapshot: DrawingSnapshot | null, items: PlanItem[]): PlanModel {
  if (row.source === "venue" && snapshot) {
    const base = modelFromSnapshot(snapshot, { source: "venue", versionNo: row.versionNo, effectiveAt: row.effectiveAt, aisleMm: row.aisleMm });
    // venue fixtures live as plan items (the planner may move them or put them away per stage)
    return { ...base, name: row.name, items };
  }
  return {
    name: row.name,
    source: row.source === "venue" ? "venue" : "own",
    versionNo: row.versionNo,
    effectiveAt: row.effectiveAt ? row.effectiveAt.toISOString() : null,
    widthMm: row.ownWidthMm,
    lengthMm: row.ownLengthMm,
    backdrop: null,
    areas: ownSpaceAreas(row.ownWidthMm, row.ownLengthMm),
    tableTypes: [],
    items,
    pois: [],
    parkingAreas: [],
    aisleMm: row.aisleMm,
  };
}

/** NO access check. `lock` takes the model row FOR UPDATE (serialises layout writers of one occasion). */
async function loadModel(ctx: Pick<Ctx, "db">, occasionId: string, opts: { lock?: boolean } = {}): Promise<Loaded | null> {
  const q = ctx.db.select().from(spaceModels).where(eq(spaceModels.occasionId, occasionId));
  const [row] = opts.lock ? await q.for("update") : await q;
  if (!row) return null;
  const version = row.drawingVersionId ? await readDrawingVersion(ctx, row.drawingVersionId) : null;
  const items = await ctx.db.select().from(planItems).where(eq(planItems.spaceModelId, row.id)).orderBy(asc(planItems.createdAt), asc(planItems.id));
  return { row, version, items, model: buildModel(row, version?.snapshot ?? null, items.map((i) => rowToItem(i))) };
}

async function requireModel(ctx: Pick<Ctx, "db">, occasionId: string, opts: { lock?: boolean } = {}): Promise<Loaded> {
  const loaded = await loadModel(ctx, occasionId, opts);
  if (!loaded) throw new AppError("CONFLICT", "space.errors.noModel");
  return loaded;
}

/* ── Space model (V4) ─────────────────────────────────────────────────────────────────── */

export type AttachableSpace = {
  spaceId: string;
  supplierName: string;
  listingId: string;
  name: string;
  versionNo: number;
  effectiveAt: Date;
  widthMm: number | null;
  lengthMm: number | null;
  /** false = the venue has not calibrated this drawing: it cannot be used (V7). */
  calibrated: boolean;
};

/** Approved venue spaces of the occasion's suppliers that came from the directory (booking not cancelled). */
export async function listAttachableSpaces(ctx: Ctx, occasionId: string): Promise<AttachableSpace[]> {
  await readAccess(ctx, occasionId);
  const rows = await ctx.db
    .select({ supplier: suppliers, space: spaces, version: drawingVersions })
    .from(suppliers)
    .innerJoin(bookings, eq(bookings.supplierId, suppliers.id))
    .innerJoin(spaces, and(eq(spaces.listingId, suppliers.listingId), eq(spaces.status, "live")))
    .innerJoin(drawingVersions, eq(drawingVersions.id, spaces.liveVersionId))
    .where(and(eq(suppliers.occasionId, occasionId), sql`${bookings.state} <> 'cancelled'`))
    .orderBy(asc(suppliers.name), asc(spaces.createdAt));
  return rows.map((r) => ({
    spaceId: r.space.id,
    supplierName: r.supplier.name,
    listingId: r.space.listingId,
    name: r.version.snapshot.name,
    versionNo: r.version.versionNo,
    effectiveAt: r.version.effectiveAt,
    widthMm: r.version.snapshot.widthMm,
    lengthMm: r.version.snapshot.lengthMm,
    calibrated: r.version.snapshot.mmPerPx !== null,
  }));
}

function fixtureItemValues(occasionId: string, modelId: string, snapshot: DrawingSnapshot) {
  return snapshot.markings.fixtures.map((f) => ({
    occasionId,
    spaceModelId: modelId,
    kind: "fixture" as const,
    source: "venue" as const,
    venueRef: f.id,
    name: f.name,
    label: f.name,
    shape: "rect" as const,
    widthMm: f.widthMm,
    lengthMm: f.lengthMm,
    x: f.x,
    y: f.y,
    rotation: f.rotation,
  }));
}

/**
 * "Folosește planul locației": the venue's approved drawing becomes the occasion's space
 * model, frozen at the version that is live now. An uncalibrated drawing is refused (V7).
 */
export async function attachVenueSpace(ctx: Ctx, input: { occasionId: string; spaceId: string }): Promise<SpaceModelRow> {
  const data = z.object({ occasionId: zId, spaceId: zId }).parse(input);
  await writeAccess(ctx, data.occasionId);
  const allowed = (await listAttachableSpaces(ctx, data.occasionId)).find((s) => s.spaceId === data.spaceId);
  if (!allowed) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  return inTx(ctx, async (tx) => {
    const version = await readLiveVersionOfSpace(tx, data.spaceId);
    if (!version) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
    if (version.snapshot.mmPerPx === null) throw new AppError("CONFLICT", "space.errors.notCalibrated");
    const [row] = await tx.db
      .insert(spaceModels)
      .values({
        occasionId: data.occasionId,
        source: "venue",
        spaceId: version.spaceId,
        drawingVersionId: version.id,
        versionNo: version.versionNo,
        effectiveAt: version.effectiveAt,
        name: version.snapshot.name,
      })
      .onConflictDoNothing({ target: spaceModels.occasionId })
      .returning();
    if (!row) throw new AppError("CONFLICT", "space.errors.alreadyHasModel");
    const fixtures = fixtureItemValues(data.occasionId, row.id, version.snapshot);
    if (fixtures.length > 0) await tx.db.insert(planItems).values(fixtures);
    await audit(tx, { action: "space.attached", objectType: "space_model", objectId: row.id, after: { spaceId: version.spaceId, versionNo: version.versionNo } });
    return row;
  });
}

const ownInput = z.object({ occasionId: zId, name: text(120), widthMm: optMm, lengthMm: optMm });

/** A space the planner describes themselves: a rectangle, marked as planner-entered. Unknown sides stay unknown. */
export async function createOwnSpace(ctx: Ctx, input: z.input<typeof ownInput>): Promise<SpaceModelRow> {
  const data = ownInput.parse(input);
  await writeAccess(ctx, data.occasionId);
  return inTx(ctx, async (tx) => {
    const [row] = await tx.db
      .insert(spaceModels)
      .values({ occasionId: data.occasionId, source: "own", name: data.name, ownWidthMm: data.widthMm ?? null, ownLengthMm: data.lengthMm ?? null })
      .onConflictDoNothing({ target: spaceModels.occasionId })
      .returning();
    if (!row) throw new AppError("CONFLICT", "space.errors.alreadyHasModel");
    await audit(tx, { action: "space.ownCreated", objectType: "space_model", objectId: row.id, after: { name: row.name } });
    return row;
  });
}

const settingsInput = z.object({
  occasionId: zId,
  name: text(120).optional(),
  widthMm: optMm,
  lengthMm: optMm,
  aisleMm: z.number().int().min(0, "common.validation.tooSmall").max(5000, "common.validation.tooBig").optional(),
});

/** Name / own dimensions (own spaces only) / minimum aisle. */
export async function updateSpaceModel(ctx: Ctx, input: z.input<typeof settingsInput>): Promise<SpaceModelRow> {
  const data = settingsInput.parse(input);
  await writeAccess(ctx, data.occasionId);
  const { row } = await requireModel(ctx, data.occasionId);
  const set: Partial<typeof spaceModels.$inferInsert> = {};
  if (data.aisleMm !== undefined) set.aisleMm = data.aisleMm;
  if (row.source === "own") {
    if (data.name !== undefined) set.name = data.name;
    if (data.widthMm !== undefined) set.ownWidthMm = data.widthMm;
    if (data.lengthMm !== undefined) set.ownLengthMm = data.lengthMm;
  }
  if (Object.keys(set).length === 0) return row;
  const [updated] = await ctx.db.update(spaceModels).set(set).where(eq(spaceModels.id, row.id)).returning();
  return updated!;
}

/** Removes the space model with everything placed on it (tables, seats, stage variants). */
export async function removeSpaceModel(ctx: Ctx, input: { occasionId: string }): Promise<void> {
  const { occasionId } = z.object({ occasionId: zId }).parse(input);
  await writeAccess(ctx, occasionId);
  await inTx(ctx, async (tx) => {
    const [row] = await tx.db.delete(spaceModels).where(eq(spaceModels.occasionId, occasionId)).returning();
    if (!row) return;
    const [plan] = await tx.db.update(seatingPlans).set({ publishedAt: null }).where(eq(seatingPlans.occasionId, occasionId)).returning();
    if (plan) await bumpGuestRevision(tx, occasionId, "seating.changes.withdrawn");
    await audit(tx, { action: "space.removed", objectType: "space_model", objectId: row.id });
  });
}

export type SpaceModelView = {
  id: string;
  occasionId: string;
  source: "venue" | "own";
  name: string;
  /** Venue spaces: the frozen version and since when it holds (V4). */
  versionNo: number | null;
  effectiveAt: Date | null;
  spaceId: string | null;
  listingId: string | null;
  /** Geometry + stated facts + placed items (with places taken). */
  model: PlanModel;
  pictureUrl: string | null;
  /** The venue has approved a newer drawing than the one in the plan. Nothing changes until accepted. */
  newerVersion: { versionId: string; versionNo: number; effectiveAt: Date; usable: boolean } | null;
  /** A pending "space.updateDrawing" proposal, if any. */
  pendingUpdatePreviewId: string | null;
  parking: ParkingView | null;
  canManage: boolean;
};

/**
 * The occasion's space model, or null when there is none yet. THE read API: geometry in real
 * millimetres, never the raw image (the picture link is separate and short-lived).
 */
export async function getSpaceModel(ctx: Ctx, occasionId: string): Promise<SpaceModelView | null> {
  const member = await readAccess(ctx, occasionId);
  const loaded = await loadModel(ctx, occasionId);
  if (!loaded) return null;
  const { row, version } = loaded;
  const seated = await seatedByTable(ctx, occasionId);
  const model: PlanModel = { ...loaded.model, items: loaded.items.map((i) => rowToItem(i, i.kind === "table" ? (seated.get(i.id) ?? 0) : undefined)) };
  let newerVersion: SpaceModelView["newerVersion"] = null;
  let pendingUpdatePreviewId: string | null = null;
  if (row.source === "venue" && row.spaceId) {
    const live = await readLiveVersionOfSpace(ctx, row.spaceId);
    if (live && live.id !== row.drawingVersionId) {
      newerVersion = { versionId: live.id, versionNo: live.versionNo, effectiveAt: live.effectiveAt, usable: live.snapshot.mmPerPx !== null };
      const [p] = await ctx.db
        .select({ id: whatifPreviews.id, input: whatifPreviews.input })
        .from(whatifPreviews)
        .where(and(eq(whatifPreviews.kind, "space.updateDrawing"), eq(whatifPreviews.subjectId, row.id), eq(whatifPreviews.state, "pending"), sql`${whatifPreviews.expiresAt} > ${ctx.now}`))
        .orderBy(desc(whatifPreviews.createdAt))
        .limit(1);
      if (p && (p.input as { toVersionId?: string } | null)?.toVersionId === live.id) pendingUpdatePreviewId = p.id;
    }
  }
  return {
    id: row.id,
    occasionId,
    source: row.source,
    name: row.name,
    versionNo: row.versionNo,
    effectiveAt: row.effectiveAt,
    spaceId: row.spaceId,
    listingId: version?.listingId ?? null,
    model,
    pictureUrl: version ? await signDrawingPicture(ctx, version.snapshot.displayAssetId) : null,
    newerVersion,
    pendingUpdatePreviewId,
    parking: version ? await readListingParking(ctx, version.listingId) : null,
    canManage: isManager(member),
  };
}

/* ── Items (C-01) ─────────────────────────────────────────────────────────────────────── */

function defaultPosition(model: PlanModel, index: number): { x: number; y: number } {
  const b = modelBounds({ ...model, items: [], pois: [], parkingAreas: [], backdrop: model.areas.length ? null : model.backdrop });
  // a loose row near the top-left of the floor, so new tables do not pile up exactly
  const cols = 6;
  const step = 2600;
  const x = b.minX + 1500 + (index % cols) * step;
  const y = b.minY + 1500 + Math.floor(index / cols) * step;
  return { x: Math.round(Math.min(x, Math.max(b.minX, b.maxX - 1000)) / 100) * 100, y: Math.round(Math.min(y, Math.max(b.minY, b.maxY - 1000)) / 100) * 100 };
}

function nextLabel(items: PlanItemRow[]): string {
  const used = new Set(items.filter((i) => i.kind === "table").map((i) => i.label));
  for (let n = 1; ; n++) if (!used.has(String(n))) return String(n);
}

const customTable = z.object({
  name: text(80),
  shape: z.enum(TABLE_SHAPE_VALUES),
  diameterMm: optMm,
  widthMm: optMm,
  lengthMm: optMm,
  seats: z.number("common.validation.invalid").int().min(0, "common.validation.tooSmall").max(SPACE_LIMITS.maxSeats, "common.validation.tooBig"),
});
export type CustomTableInput = z.input<typeof customTable>;

const addTableInput = z
  .object({
    occasionId: zId,
    /** Client-chosen id: repeating the call adds nothing (Q4). */
    id: zId.optional(),
    /** A table from the venue's inventory … */
    tableTypeId: z.string().min(1).max(40).optional(),
    /** … or the planner's own (V5). */
    custom: customTable.optional(),
    label: z.string().trim().max(24).optional(),
    x: zCoordMm.optional(),
    y: zCoordMm.optional(),
    rotation: zRotation.optional(),
  })
  .refine((d) => !!d.tableTypeId !== !!d.custom, { message: "common.validation.invalid" });
export type AddTableInput = z.input<typeof addTableInput>;

function customDims(c: z.output<typeof customTable>) {
  // a size is whole or unknown: round = diameter, rectangular = both sides
  if (c.shape === "round") return { diameterMm: c.diameterMm ?? null, widthMm: null, lengthMm: null };
  const both = c.widthMm != null && c.lengthMm != null;
  if (!both && (c.widthMm != null || c.lengthMm != null)) throw new AppError("VALIDATION", "seating.errors.bothSides", { fieldErrors: { lengthMm: ["seating.errors.bothSides"] } });
  return { diameterMm: null, widthMm: both ? c.widthMm! : null, lengthMm: both ? c.lengthMm! : null };
}

/** Internal: inserts a table into a locked model. NO access check. */
async function insertTable(tx: Ctx, loaded: Loaded, data: z.output<typeof addTableInput>): Promise<PlanItemRow> {
  if (data.id) {
    const [existing] = await tx.db.select().from(planItems).where(eq(planItems.id, data.id));
    if (existing) {
      if (existing.occasionId !== data.occasionId) throw new AppError("CONFLICT", "common.errors.CONFLICT");
      return existing;
    }
  }
  if (loaded.items.length >= SPACE_LIMITS.planItems) throw new AppError("LIMIT", "seating.errors.tooManyItems", { params: { max: SPACE_LIMITS.planItems } });
  const at = data.x !== undefined && data.y !== undefined ? { x: data.x, y: data.y } : defaultPosition(loaded.model, loaded.items.filter((i) => i.kind === "table").length);
  const label = data.label || nextLabel(loaded.items);
  let values: typeof planItems.$inferInsert;
  if (data.tableTypeId) {
    const type = loaded.model.tableTypes.find((t) => t.id === data.tableTypeId);
    if (!type || loaded.row.source !== "venue") throw new AppError("NOT_FOUND", "seating.errors.unknownTableType");
    const placed = loaded.items.filter((i) => i.kind === "table" && i.source === "venue" && i.venueRef === type.id).length;
    // never more of a type than the venue states it has; an unknown count does not limit
    if (type.count !== null && placed >= type.count) throw new AppError("LIMIT", "seating.errors.inventoryExhausted", { params: { name: type.name, count: type.count } });
    values = {
      occasionId: data.occasionId,
      spaceModelId: loaded.row.id,
      kind: "table",
      source: "venue",
      venueRef: type.id,
      name: type.name,
      label,
      shape: type.shape,
      diameterMm: type.shape === "round" ? type.diameterMm : null,
      widthMm: type.shape === "rect" ? type.widthMm : null,
      lengthMm: type.shape === "rect" ? type.lengthMm : null,
      seats: type.seats,
      ...at,
      rotation: data.rotation ?? 0,
    };
  } else {
    const c = data.custom!;
    values = {
      occasionId: data.occasionId,
      spaceModelId: loaded.row.id,
      kind: "table",
      source: "custom", // V5: never presented as venue-supplied
      name: c.name,
      label,
      shape: c.shape,
      ...customDims(c),
      seats: c.seats,
      ...at,
      rotation: data.rotation ?? 0,
    };
  }
  const [row] = await tx.db
    .insert(planItems)
    .values({ ...values, id: data.id ?? newId() })
    .returning();
  loaded.items.push(row!);
  return row!;
}

/** Places a table: one of the venue's inventory (up to its stated count) or a custom one (V5). */
export async function addTable(ctx: Ctx, input: AddTableInput): Promise<PlanItem> {
  const data = addTableInput.parse(input);
  await writeAccess(ctx, data.occasionId);
  return inTx(ctx, async (tx) => {
    const loaded = await requireModel(tx, data.occasionId, { lock: true });
    return rowToItem(await insertTable(tx, loaded, data), 0);
  });
}

const addFixtureInput = z.object({
  occasionId: zId,
  id: zId.optional(),
  name: text(80),
  widthMm: optMm,
  lengthMm: optMm,
  x: zCoordMm.optional(),
  y: zCoordMm.optional(),
  rotation: zRotation.optional(),
});

/** A fixture of the planner's own (candy bar, photo corner …): drawn dashed like every custom item. */
export async function addFixture(ctx: Ctx, input: z.input<typeof addFixtureInput>): Promise<PlanItem> {
  const data = addFixtureInput.parse(input);
  await writeAccess(ctx, data.occasionId);
  const both = data.widthMm != null && data.lengthMm != null;
  if (!both && (data.widthMm != null || data.lengthMm != null)) throw new AppError("VALIDATION", "seating.errors.bothSides", { fieldErrors: { lengthMm: ["seating.errors.bothSides"] } });
  return inTx(ctx, async (tx) => {
    const loaded = await requireModel(tx, data.occasionId, { lock: true });
    if (data.id) {
      const [existing] = await tx.db.select().from(planItems).where(and(eq(planItems.id, data.id), eq(planItems.occasionId, data.occasionId)));
      if (existing) return rowToItem(existing);
    }
    if (loaded.items.length >= SPACE_LIMITS.planItems) throw new AppError("LIMIT", "seating.errors.tooManyItems", { params: { max: SPACE_LIMITS.planItems } });
    const at = data.x !== undefined && data.y !== undefined ? { x: data.x, y: data.y } : defaultPosition(loaded.model, loaded.items.length);
    const [row] = await tx.db
      .insert(planItems)
      .values({
        id: data.id ?? newId(),
        occasionId: data.occasionId,
        spaceModelId: loaded.row.id,
        kind: "fixture",
        source: "custom",
        name: data.name,
        label: data.name,
        shape: "rect",
        widthMm: both ? data.widthMm! : null,
        lengthMm: both ? data.lengthMm! : null,
        ...at,
        rotation: data.rotation ?? 0,
      })
      .returning();
    return rowToItem(row!);
  });
}

async function loadItem(ctx: Ctx, itemId: string): Promise<PlanItemRow> {
  const id = zId.safeParse(itemId);
  if (!id.success) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  const [row] = await ctx.db.select().from(planItems).where(eq(planItems.id, id.data));
  if (!row) throw new AppError("NOT_FOUND", "seating.errors.itemGone");
  return row;
}

/** The conflict a stale writer gets: says so in words and carries the item as it is now. */
function staleItem(current: PlanItemRow | undefined): AppError {
  return new AppError("CONFLICT", current ? "seating.errors.conflict" : "seating.errors.itemGone", current ? { params: { label: current.label }, current: rowToItem(current) } : undefined);
}

const moveInput = z.object({
  itemId: zId,
  x: zCoordMm,
  y: zCoordMm,
  rotation: zRotation.optional(),
  /** The version the editor last saw. Omit to write regardless (last write wins). */
  version: z.number().int().optional(),
});

/**
 * Moves / rotates an item in the BASE layout. Absolute values → repeating the call changes
 * nothing more (Q4). With `version`, a writer who has not seen the latest change gets
 * CONFLICT instead of silently undoing someone else's move.
 */
export async function moveItem(ctx: Ctx, input: z.input<typeof moveInput>): Promise<PlanItem> {
  const data = moveInput.parse(input);
  const item = await loadItem(ctx, data.itemId);
  await writeAccess(ctx, item.occasionId);
  const same = item.x === data.x && item.y === data.y && (data.rotation === undefined || data.rotation === item.rotation);
  if (same && (data.version === undefined || data.version === item.version)) return rowToItem(item);
  const [row] = await ctx.db
    .update(planItems)
    .set({ x: data.x, y: data.y, ...(data.rotation !== undefined ? { rotation: data.rotation } : {}), version: sql`${planItems.version} + 1` })
    .where(and(eq(planItems.id, item.id), data.version !== undefined ? eq(planItems.version, data.version) : undefined))
    .returning();
  if (!row) {
    const [current] = await ctx.db.select().from(planItems).where(eq(planItems.id, item.id));
    throw staleItem(current);
  }
  return rowToItem(row);
}

const updateItemInput = z.object({
  itemId: zId,
  label: z.string().trim().min(1, "common.validation.required").max(24, "common.validation.tooLong").optional(),
  /** Custom items only: the venue's stated facts cannot be edited by the planner. */
  custom: customTable.partial().optional(),
  version: z.number().int().optional(),
});

export async function updateItem(ctx: Ctx, input: z.input<typeof updateItemInput>): Promise<PlanItem> {
  const data = updateItemInput.parse(input);
  const item = await loadItem(ctx, data.itemId);
  await writeAccess(ctx, item.occasionId);
  const set: Partial<typeof planItems.$inferInsert> = {};
  if (data.label !== undefined) set.label = data.label;
  if (data.custom) {
    if (item.source !== "custom") throw new AppError("FORBIDDEN", "seating.errors.venueFact");
    const c = data.custom;
    if (c.name !== undefined) {
      set.name = c.name;
      if (item.kind === "fixture") set.label = c.name;
    }
    const shape = item.kind === "fixture" ? "rect" : (c.shape ?? item.shape);
    if (c.shape !== undefined || c.diameterMm !== undefined || c.widthMm !== undefined || c.lengthMm !== undefined) {
      const dims = customDims({
        name: item.name,
        seats: 0,
        shape,
        diameterMm: c.diameterMm !== undefined ? c.diameterMm : item.diameterMm,
        widthMm: c.widthMm !== undefined ? c.widthMm : item.widthMm,
        lengthMm: c.lengthMm !== undefined ? c.lengthMm : item.lengthMm,
      });
      Object.assign(set, dims, { shape });
    }
    if (c.seats !== undefined && item.kind === "table") set.seats = c.seats;
  }
  if (Object.keys(set).length === 0) return rowToItem(item);
  const [row] = await ctx.db
    .update(planItems)
    .set({ ...set, version: sql`${planItems.version} + 1` })
    .where(and(eq(planItems.id, item.id), data.version !== undefined ? eq(planItems.version, data.version) : undefined))
    .returning();
  if (!row) {
    const [current] = await ctx.db.select().from(planItems).where(eq(planItems.id, item.id));
    throw staleItem(current);
  }
  return rowToItem(row);
}

/** Takes an item off the plan (its seat assignments go with it). Idempotent. */
export async function removeItem(ctx: Ctx, input: { itemId: string; occasionId: string }): Promise<void> {
  const data = z.object({ itemId: zId, occasionId: zId }).parse(input);
  await writeAccess(ctx, data.occasionId);
  await ctx.db.delete(planItems).where(and(eq(planItems.id, data.itemId), eq(planItems.occasionId, data.occasionId)));
}

/* ── Meal stages (C-02) ───────────────────────────────────────────────────────────────── */

export type MealStageView = { id: string; name: string; position: number; states: StageItemState[] };

/** The stages of the meal / evening in order, each with how its layout differs from the base. */
export async function listMealStages(ctx: Ctx, occasionId: string): Promise<MealStageView[]> {
  await readAccess(ctx, occasionId);
  return readStages(ctx, occasionId);
}

async function readStages(ctx: Pick<Ctx, "db">, occasionId: string): Promise<MealStageView[]> {
  const stages = await ctx.db.select().from(mealStages).where(eq(mealStages.occasionId, occasionId)).orderBy(asc(mealStages.position), asc(mealStages.createdAt));
  if (stages.length === 0) return [];
  const states = await ctx.db.select().from(stageItemStates).where(eq(stageItemStates.occasionId, occasionId));
  return stages.map((s) => ({
    id: s.id,
    name: s.name,
    position: s.position,
    states: states.filter((x) => x.stageId === s.id).map((x) => ({ itemId: x.itemId, present: x.present, x: x.x, y: x.y, rotation: x.rotation })),
  }));
}

export const DEFAULT_STAGE_KEYS = ["welcome", "starter", "main", "dance", "cake"] as const;

export async function addMealStage(ctx: Ctx, input: { occasionId: string; name: string; id?: string }): Promise<MealStage> {
  const data = z.object({ occasionId: zId, name: text(60), id: zId.optional() }).parse(input);
  await writeAccess(ctx, data.occasionId);
  return inTx(ctx, async (tx) => {
    const existing = await tx.db.select().from(mealStages).where(eq(mealStages.occasionId, data.occasionId));
    const dup = data.id ? existing.find((s) => s.id === data.id) : undefined;
    if (dup) return dup;
    if (existing.length >= SPACE_LIMITS.stages) throw new AppError("LIMIT", "seating.errors.tooManyStages", { params: { max: SPACE_LIMITS.stages } });
    const [row] = await tx.db
      .insert(mealStages)
      .values({ id: data.id ?? newId(), occasionId: data.occasionId, name: data.name, position: existing.reduce((m, s) => Math.max(m, s.position), 0) + 1 })
      .returning();
    return row!;
  });
}

/** Primire, aperitiv, felul principal, dans, tort — only when the occasion has no stage yet. */
export async function addDefaultStages(ctx: Ctx, input: { occasionId: string }): Promise<MealStage[]> {
  const { occasionId } = z.object({ occasionId: zId }).parse(input);
  await writeAccess(ctx, occasionId);
  return inTx(ctx, async (tx) => {
    const existing = await tx.db.select().from(mealStages).where(eq(mealStages.occasionId, occasionId)).for("update");
    if (existing.length > 0) return existing;
    return tx.db
      .insert(mealStages)
      .values(DEFAULT_STAGE_KEYS.map((k, i) => ({ occasionId, name: translate(ctx.locale, `seating.stages.defaults.${k}`), position: i + 1 })))
      .returning();
  });
}

export async function renameMealStage(ctx: Ctx, input: { stageId: string; name: string }): Promise<void> {
  const data = z.object({ stageId: zId, name: text(60) }).parse(input);
  const stage = await loadStage(ctx, data.stageId);
  await writeAccess(ctx, stage.occasionId);
  await ctx.db.update(mealStages).set({ name: data.name }).where(eq(mealStages.id, stage.id));
}

export async function moveMealStage(ctx: Ctx, input: { stageId: string; direction: "up" | "down" }): Promise<void> {
  const data = z.object({ stageId: zId, direction: z.enum(["up", "down"]) }).parse(input);
  const stage = await loadStage(ctx, data.stageId);
  await writeAccess(ctx, stage.occasionId);
  await inTx(ctx, async (tx) => {
    const all = await tx.db.select().from(mealStages).where(eq(mealStages.occasionId, stage.occasionId)).orderBy(asc(mealStages.position), asc(mealStages.createdAt)).for("update");
    const i = all.findIndex((s) => s.id === stage.id);
    const j = data.direction === "up" ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= all.length) return;
    [all[i], all[j]] = [all[j]!, all[i]!];
    for (const [pos, s] of all.entries()) await tx.db.update(mealStages).set({ position: pos + 1 }).where(eq(mealStages.id, s.id));
  });
}

export async function removeMealStage(ctx: Ctx, input: { stageId: string; occasionId: string }): Promise<void> {
  const data = z.object({ stageId: zId, occasionId: zId }).parse(input);
  await writeAccess(ctx, data.occasionId);
  await ctx.db.delete(mealStages).where(and(eq(mealStages.id, data.stageId), eq(mealStages.occasionId, data.occasionId)));
}

async function loadStage(ctx: Ctx, stageId: string): Promise<MealStage> {
  const [row] = await ctx.db.select().from(mealStages).where(eq(mealStages.id, stageId));
  if (!row) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  return row;
}

const stageItemInput = z.object({
  stageId: zId,
  itemId: zId,
  /** false = put away during this stage */
  present: z.boolean(),
  /** Alternative position for this stage; omit / null = where the base layout has it. */
  x: zCoordMm.nullable().optional(),
  y: zCoordMm.nullable().optional(),
  rotation: zRotation.nullable().optional(),
});

/** How one item differs during one stage. present + no position = same as base → the row is removed. */
export async function setStageItem(ctx: Ctx, input: z.input<typeof stageItemInput>): Promise<void> {
  const data = stageItemInput.parse(input);
  const stage = await loadStage(ctx, data.stageId);
  await writeAccess(ctx, stage.occasionId);
  const item = await loadItem(ctx, data.itemId);
  if (item.occasionId !== stage.occasionId) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  const x = data.x ?? null;
  const y = data.y ?? null;
  const rotation = data.rotation ?? null;
  const sameAsBase = data.present && (x === null || (x === item.x && y === item.y)) && (rotation === null || rotation === item.rotation);
  if (sameAsBase) {
    await ctx.db.delete(stageItemStates).where(and(eq(stageItemStates.stageId, stage.id), eq(stageItemStates.itemId, item.id)));
    return;
  }
  const values = { present: data.present, x: x !== null && y !== null ? x : null, y: x !== null && y !== null ? y : null, rotation };
  await ctx.db
    .insert(stageItemStates)
    .values({ stageId: stage.id, itemId: item.id, occasionId: stage.occasionId, ...values })
    .onConflictDoUpdate({ target: [stageItemStates.stageId, stageItemStates.itemId], set: values });
}

/* ── Roster and seat assignments (C-01) ───────────────────────────────────────────────── */

export type RosterHousehold = {
  householdId: string;
  name: string;
  attending: RsvpAttending | null;
  /** Named adults. */
  adults: Array<{ guestId: string; name: string; tableItemId: string | null; seatNo: number | null }>;
  /** Adults expected or confirmed beyond the named ones — a count. */
  extra: { count: number; tableItemId: string | null } | null;
  /** Children are a number on the household, never persons (invariant 9). */
  children: { count: number; tableItemId: string | null } | null;
};

async function readRoster(ctx: Pick<Ctx, "db">, occasionId: string): Promise<RosterHousehold[]> {
  const [hs, gs, rs, as] = await Promise.all([
    ctx.db.select().from(households).where(eq(households.occasionId, occasionId)).orderBy(asc(households.name), asc(households.id)),
    ctx.db.select().from(guests).where(eq(guests.occasionId, occasionId)).orderBy(asc(guests.createdAt), asc(guests.id)),
    ctx.db.select().from(rsvpResponses).where(eq(rsvpResponses.occasionId, occasionId)),
    ctx.db.select().from(seatAssignments).where(eq(seatAssignments.occasionId, occasionId)),
  ]);
  return hs.map((h) => {
    const named = gs.filter((g) => g.householdId === h.id);
    const r = rs.find((x) => x.householdId === h.id) ?? null;
    const adultsTotal = r?.attending === "yes" ? r.adultsCount : r?.attending === "no" ? named.length : Math.max(named.length, h.expectedPartySize ?? 0);
    const extraCount = r?.attending === "no" ? 0 : Math.max(0, adultsTotal - named.length);
    const childCount = r && r.attending !== "no" ? r.childrenCount : 0;
    const group = (kind: SeatKind) => as.find((a) => a.householdId === h.id && a.kind === kind) ?? null;
    return {
      householdId: h.id,
      name: h.name,
      attending: r?.attending ?? null,
      adults: named.map((g) => {
        const a = as.find((x) => x.guestId === g.id) ?? null;
        return { guestId: g.id, name: g.fullName, tableItemId: a?.tableItemId ?? null, seatNo: a?.seatNo ?? null };
      }),
      extra: extraCount > 0 ? { count: extraCount, tableItemId: group("extra")?.tableItemId ?? null } : null,
      children: childCount > 0 ? { count: childCount, tableItemId: group("children")?.tableItemId ?? null } : null,
    };
  });
}

/** Places taken per table, from the CURRENT roster (a household's counts follow its RSVP). */
function seatedFromRoster(roster: RosterHousehold[]): Map<string, number> {
  const m = new Map<string, number>();
  const add = (id: string | null, n: number) => {
    if (id) m.set(id, (m.get(id) ?? 0) + n);
  };
  for (const h of roster) {
    for (const a of h.adults) add(a.tableItemId, 1);
    if (h.extra) add(h.extra.tableItemId, h.extra.count);
    if (h.children) add(h.children.tableItemId, h.children.count);
  }
  return m;
}

async function seatedByTable(ctx: Pick<Ctx, "db">, occasionId: string): Promise<Map<string, number>> {
  return seatedFromRoster(await readRoster(ctx, occasionId));
}

/** Who is invited and where each one sits. For members who may read the guest list. */
export async function getSeatingRoster(ctx: Ctx, occasionId: string): Promise<RosterHousehold[]> {
  await readAccess(ctx, occasionId);
  return readRoster(ctx, occasionId);
}

const groupRef = z.object({ householdId: zId, kind: z.enum(["extra", "children"]) });
const assignInput = z.object({
  occasionId: zId,
  tableItemId: zId,
  guestIds: z.array(zId).max(200).default([]),
  /** A household's unnamed adults / its children, as one counted block ("+2 copii"). */
  groups: z.array(groupRef).max(200).default([]),
});
export type AssignSeatsInput = z.input<typeof assignInput>;

/** Internal: seats people at a table inside a transaction. NO access check. Capacity is enforced. */
async function placeAtTable(tx: Ctx, data: z.output<typeof assignInput>): Promise<{ seated: number; seats: number | null }> {
  const [table] = await tx.db.select().from(planItems).where(and(eq(planItems.id, data.tableItemId), eq(planItems.occasionId, data.occasionId))).for("update");
  if (!table || table.kind !== "table") throw new AppError("NOT_FOUND", "seating.errors.itemGone");
  const roster = await readRoster(tx, data.occasionId);
  const adultById = new Map(roster.flatMap((h) => h.adults.map((a) => [a.guestId, { ...a, householdId: h.householdId }] as const)));
  const seated = seatedFromRoster(roster).get(table.id) ?? 0;
  let adding = 0;
  const guestRows: Array<{ guestId: string; householdId: string }> = [];
  for (const id of new Set(data.guestIds)) {
    const a = adultById.get(id);
    if (!a) throw new AppError("NOT_FOUND", "seating.errors.guestGone");
    if (a.tableItemId !== table.id) adding += 1;
    guestRows.push({ guestId: id, householdId: a.householdId });
  }
  const groupRows: Array<{ householdId: string; kind: "extra" | "children"; places: number }> = [];
  const seen = new Set<string>();
  for (const gr of data.groups) {
    const key = `${gr.householdId}:${gr.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const h = roster.find((x) => x.householdId === gr.householdId);
    const block = gr.kind === "extra" ? h?.extra : h?.children;
    if (!h || !block) throw new AppError("NOT_FOUND", "seating.errors.guestGone");
    if (block.tableItemId !== table.id) adding += block.count;
    groupRows.push({ ...gr, places: block.count });
  }
  // capacity: a table never takes more people than it has places (an unknown seat count does not limit)
  if (table.seats !== null && seated + adding > table.seats) {
    throw new AppError("CONFLICT", "seating.errors.tableFull", { params: { label: table.label, free: Math.max(0, table.seats - seated), wanted: adding } });
  }
  for (const g of guestRows) {
    await tx.db
      .insert(seatAssignments)
      .values({ occasionId: data.occasionId, tableItemId: table.id, householdId: g.householdId, kind: "guest", guestId: g.guestId, places: 1 })
      .onConflictDoUpdate({
        target: seatAssignments.guestId,
        targetWhere: sql`${seatAssignments.guestId} is not null`,
        // moving to another table frees the numbered seat
        set: { tableItemId: table.id, seatNo: sql`case when ${seatAssignments.tableItemId} = ${table.id} then ${seatAssignments.seatNo} else null end` },
      });
  }
  for (const gr of groupRows) {
    await tx.db
      .insert(seatAssignments)
      .values({ occasionId: data.occasionId, tableItemId: table.id, householdId: gr.householdId, kind: gr.kind, guestId: null, places: gr.places })
      .onConflictDoUpdate({
        target: [seatAssignments.householdId, seatAssignments.kind],
        targetWhere: sql`${seatAssignments.kind} <> 'guest'`,
        set: { tableItemId: table.id, places: gr.places },
      });
  }
  return { seated: seated + adding, seats: table.seats };
}

/**
 * "Așază la masă": seats named adults and counted blocks (unnamed adults, children) at a
 * table — moving them from wherever they sat. Refused as a whole when the table lacks places.
 * Repeating the call changes nothing (Q4).
 */
export async function assignSeats(ctx: Ctx, input: AssignSeatsInput): Promise<{ seated: number; seats: number | null }> {
  const data = assignInput.parse(input);
  await writeAccess(ctx, data.occasionId);
  if (data.guestIds.length + data.groups.length === 0) throw new AppError("VALIDATION", "seating.errors.pickSomeone");
  return inTx(ctx, (tx) => placeAtTable(tx, data));
}

const unassignInput = z.object({ occasionId: zId, guestIds: z.array(zId).max(400).default([]), groups: z.array(groupRef).max(400).default([]) });

/** Takes people off their table (back to the unseated list). Idempotent. */
export async function unassignSeats(ctx: Ctx, input: z.input<typeof unassignInput>): Promise<void> {
  const data = unassignInput.parse(input);
  await writeAccess(ctx, data.occasionId);
  await inTx(ctx, async (tx) => {
    if (data.guestIds.length > 0) await tx.db.delete(seatAssignments).where(and(eq(seatAssignments.occasionId, data.occasionId), inArray(seatAssignments.guestId, data.guestIds)));
    for (const gr of data.groups) {
      await tx.db.delete(seatAssignments).where(and(eq(seatAssignments.occasionId, data.occasionId), eq(seatAssignments.householdId, gr.householdId), eq(seatAssignments.kind, gr.kind)));
    }
  });
}

const seatNoInput = z.object({ occasionId: zId, guestId: zId, seatNo: z.number().int().min(1).max(SPACE_LIMITS.maxSeats).nullable() });

/** Optional numbered seat of a named adult at their table. Two people never share a number. */
export async function setSeatNumber(ctx: Ctx, input: z.input<typeof seatNoInput>): Promise<void> {
  const data = seatNoInput.parse(input);
  await writeAccess(ctx, data.occasionId);
  await inTx(ctx, async (tx) => {
    const [a] = await tx.db.select().from(seatAssignments).where(and(eq(seatAssignments.occasionId, data.occasionId), eq(seatAssignments.guestId, data.guestId))).for("update");
    if (!a) throw new AppError("NOT_FOUND", "seating.errors.guestGone");
    if (data.seatNo !== null) {
      const [table] = await tx.db.select().from(planItems).where(eq(planItems.id, a.tableItemId));
      if (table?.seats !== null && table?.seats !== undefined && data.seatNo > table.seats) {
        throw new AppError("VALIDATION", "seating.errors.seatOutOfRange", { params: { seats: table.seats }, fieldErrors: { seatNo: ["seating.errors.seatOutOfRange"] } });
      }
      const [taken] = await tx.db
        .select({ id: seatAssignments.id })
        .from(seatAssignments)
        .where(and(eq(seatAssignments.tableItemId, a.tableItemId), eq(seatAssignments.seatNo, data.seatNo), sql`${seatAssignments.id} <> ${a.id}`));
      if (taken) throw new AppError("CONFLICT", "seating.errors.seatTaken", { params: { seatNo: data.seatNo }, fieldErrors: { seatNo: ["seating.errors.seatTaken"] } });
    }
    await tx.db.update(seatAssignments).set({ seatNo: data.seatNo }).where(eq(seatAssignments.id, a.id));
  });
}

/* ── Fit checks (C-02) ────────────────────────────────────────────────────────────────── */

export type FitChecks = {
  /** People who said yes (adults + children). */
  attending: number;
  /** Everyone invited, when known. */
  invited: number | null;
  base: FitResult;
  stages: Array<{ stageId: string; name: string; result: FitResult }>;
};

function fitFor(model: PlanModel, stages: MealStageView[], attending: number, invited: number | null): FitChecks {
  return {
    attending,
    invited,
    base: checkFit(model, { needed: attending }),
    stages: stages.map((s) => ({ stageId: s.id, name: s.name, result: checkFit(applyStage(model, s.states), { needed: attending }) })),
  };
}

/** The fit of the base layout and of every meal stage (between courses included). null = no space model. */
export async function getFitChecks(ctx: Ctx, occasionId: string): Promise<FitChecks | null> {
  await readAccess(ctx, occasionId);
  const loaded = await loadModel(ctx, occasionId);
  if (!loaded) return null;
  const [summary, stages] = await Promise.all([getRsvpSummary(ctx, occasionId), readStages(ctx, occasionId)]);
  return fitFor(loaded.model, stages, summary.attending.total, summary.invited);
}

/* ── Publishing (C-08) ────────────────────────────────────────────────────────────────── */

export async function getSeatingPublication(ctx: Pick<Ctx, "db">, occasionId: string): Promise<{ publishedAt: Date | null }> {
  const [row] = await ctx.db.select().from(seatingPlans).where(eq(seatingPlans.occasionId, occasionId));
  return { publishedAt: row?.publishedAt ?? null };
}

/** From now on each guest sees their own table on their link. Tells guests something changed (INF5). */
export async function publishSeating(ctx: Ctx, input: { occasionId: string }): Promise<{ publishedAt: Date }> {
  const { occasionId } = z.object({ occasionId: zId }).parse(input);
  const member = await writeAccess(ctx, occasionId);
  await requireModel(ctx, occasionId);
  return inTx(ctx, async (tx) => {
    const [before] = await tx.db.select().from(seatingPlans).where(eq(seatingPlans.occasionId, occasionId)).for("update");
    if (before?.publishedAt) return { publishedAt: before.publishedAt };
    await tx.db
      .insert(seatingPlans)
      .values({ occasionId, publishedAt: tx.now, publishedByAccountId: member.accountId })
      .onConflictDoUpdate({ target: seatingPlans.occasionId, set: { publishedAt: tx.now, publishedByAccountId: member.accountId } });
    await bumpGuestRevision(tx, occasionId, "seating.changes.published");
    await audit(tx, { action: "seating.published", objectType: "occasion", objectId: occasionId });
    return { publishedAt: tx.now };
  });
}

/** Hides the seats from guests again. */
export async function unpublishSeating(ctx: Ctx, input: { occasionId: string }): Promise<void> {
  const { occasionId } = z.object({ occasionId: zId }).parse(input);
  await writeAccess(ctx, occasionId);
  await inTx(ctx, async (tx) => {
    const rows = await tx.db
      .update(seatingPlans)
      .set({ publishedAt: null })
      .where(and(eq(seatingPlans.occasionId, occasionId), sql`${seatingPlans.publishedAt} is not null`))
      .returning();
    if (rows.length === 0) return;
    await bumpGuestRevision(tx, occasionId, "seating.changes.withdrawn");
    await audit(tx, { action: "seating.unpublished", objectType: "occasion", objectId: occasionId });
  });
}

/* ── Editor + summary reads ───────────────────────────────────────────────────────────── */

export type SeatingEditor = {
  space: SpaceModelView;
  stages: MealStageView[];
  roster: RosterHousehold[];
  fit: FitChecks;
  publishedAt: Date | null;
  canManage: boolean;
};

/** Everything the seating page shows, in one read. null = the occasion has no space model yet. */
export async function getSeatingEditor(ctx: Ctx, occasionId: string): Promise<SeatingEditor | null> {
  const space = await getSpaceModel(ctx, occasionId);
  if (!space) return null;
  const [stages, roster, summary, pub] = await Promise.all([readStages(ctx, occasionId), readRoster(ctx, occasionId), getRsvpSummary(ctx, occasionId), getSeatingPublication(ctx, occasionId)]);
  return { space, stages, roster, fit: fitFor(space.model, stages, summary.attending.total, summary.invited), publishedAt: pub.publishedAt, canManage: space.canManage };
}

export type SeatingSummary = {
  hasSpace: boolean;
  space: { name: string; source: "venue" | "own"; versionNo: number | null; effectiveAt: Date | null } | null;
  publishedAt: Date | null;
  tables: Array<{ id: string; label: string; name: string; source: "venue" | "custom"; seats: number | null; seated: number; sizeKnown: boolean }>;
  seats: { total: number; taken: number };
  /** People not seated yet (households that declined are left out). */
  unseated: { adults: number; children: number };
  fit: FitChecks | null;
};

/** Counts only — no names — for the overview, the print pack and the MCP tools. */
export async function getSeatingSummary(ctx: Ctx, occasionId: string): Promise<SeatingSummary> {
  await readAccess(ctx, occasionId);
  const loaded = await loadModel(ctx, occasionId);
  const pub = await getSeatingPublication(ctx, occasionId);
  const roster = await readRoster(ctx, occasionId);
  const seated = seatedFromRoster(roster);
  const coming = roster.filter((h) => h.attending !== "no");
  const unseated = {
    adults: coming.reduce((n, h) => n + h.adults.filter((a) => !a.tableItemId).length + (h.extra && !h.extra.tableItemId ? h.extra.count : 0), 0),
    children: coming.reduce((n, h) => n + (h.children && !h.children.tableItemId ? h.children.count : 0), 0),
  };
  if (!loaded) return { hasSpace: false, space: null, publishedAt: pub.publishedAt, tables: [], seats: { total: 0, taken: 0 }, unseated, fit: null };
  const tables = loaded.items
    .filter((i) => i.kind === "table")
    .map((i) => ({ id: i.id, label: i.label, name: i.name, source: i.source, seats: i.seats, seated: seated.get(i.id) ?? 0, sizeKnown: itemHasDims(i) }));
  const [summary, stages] = await Promise.all([getRsvpSummary(ctx, occasionId), readStages(ctx, occasionId)]);
  return {
    hasSpace: true,
    space: { name: loaded.row.name, source: loaded.row.source, versionNo: loaded.row.versionNo, effectiveAt: loaded.row.effectiveAt },
    publishedAt: pub.publishedAt,
    tables,
    seats: { total: tables.reduce((n, t) => n + (t.seats ?? 0), 0), taken: tables.reduce((n, t) => n + t.seated, 0) },
    unseated,
    fit: fitFor(loaded.model, stages, summary.attending.total, summary.invited),
  };
}

/* ── Guest side (C-08, V9, V10) ───────────────────────────────────────────────────────── */

export type GuestSeat = {
  publishedAt: string;
  /** One line per person / counted block of THIS household. Never anyone else. */
  places: Array<{
    tableLabel: string;
    tableItemId: string;
    who: { kind: "guest"; name: string } | { kind: "extra"; count: number } | { kind: "children"; count: number };
    seatNo: number | null;
  }>;
  /** The room with this household's table(s) only — no other table, no other guest. null = nothing to draw. */
  plan: PlanModel | null;
};

function guestPlan(loaded: Loaded, onlyTableIds: string[]): PlanModel {
  const keep = new Set(onlyTableIds);
  return {
    ...loaded.model,
    tableTypes: [],
    parkingAreas: [],
    backdrop: loaded.model.areas.length > 0 ? null : loaded.model.backdrop,
    items: loaded.model.items.filter((i) => i.kind === "fixture" || keep.has(i.id)).map((i) => ({ ...i, seated: undefined, version: undefined })),
  };
}

/**
 * The guest's own table (and seat number, if given) — ONLY once the planner has published
 * the seating plan; before that, and for a household with no seat yet, null. Guest actor only.
 */
export async function getGuestSeat(ctx: Ctx): Promise<GuestSeat | null> {
  const actor = requireGuest(ctx);
  const pub = await getSeatingPublication(ctx, actor.occasionId);
  if (!pub.publishedAt) return null; // unpublished seating is never visible to guests
  const rows = await ctx.db
    .select({ a: seatAssignments, table: planItems, guest: guests })
    .from(seatAssignments)
    .innerJoin(planItems, eq(planItems.id, seatAssignments.tableItemId))
    .leftJoin(guests, eq(guests.id, seatAssignments.guestId))
    .where(and(eq(seatAssignments.occasionId, actor.occasionId), eq(seatAssignments.householdId, actor.householdId)))
    .orderBy(asc(seatAssignments.kind), asc(seatAssignments.createdAt));
  if (rows.length === 0) return null;
  const roster = (await readRoster(ctx, actor.occasionId)).find((h) => h.householdId === actor.householdId);
  const places: GuestSeat["places"] = [];
  for (const r of rows) {
    if (r.a.kind === "guest") {
      if (r.guest) places.push({ tableLabel: r.table.label, tableItemId: r.table.id, who: { kind: "guest", name: r.guest.fullName }, seatNo: r.a.seatNo });
    } else {
      const count = r.a.kind === "extra" ? roster?.extra?.count : roster?.children?.count;
      if (count) places.push({ tableLabel: r.table.label, tableItemId: r.table.id, who: { kind: r.a.kind, count }, seatNo: null });
    }
  }
  if (places.length === 0) return null;
  // named adults first (by name), then the counted blocks
  const rank = (p: GuestSeat["places"][number]) => (p.who.kind === "guest" ? 0 : p.who.kind === "extra" ? 1 : 2);
  places.sort((a, b) => rank(a) - rank(b) || (a.who.kind === "guest" && b.who.kind === "guest" ? a.who.name.localeCompare(b.who.name, "ro") : 0));
  const loaded = await loadModel(ctx, actor.occasionId);
  const plan = loaded && loaded.model.areas.length > 0 ? guestPlan(loaded, places.map((p) => p.tableItemId)) : null;
  return { publishedAt: pub.publishedAt.toISOString(), places, plan };
}

export type GuestSpaceView = {
  name: string;
  /** Floor outline, fixtures and points of interest. No tables, no people, nothing editable (V9). */
  plan: PlanModel | null;
  pois: Array<{ index: number; kind: string; name: string | null }>;
  /** V10: each fact known or unknown; null = the venue stated nothing. */
  parking: ParkingView | null;
};

/**
 * "Planul sălii" for a guest: where the toilets, cloakroom, bar and exits are, plus the
 * venue's parking facts — from the same space model. null when there is nothing to show.
 */
export async function getGuestSpaceView(ctx: Ctx): Promise<GuestSpaceView | null> {
  const actor = requireGuest(ctx);
  const loaded = await loadModel(ctx, actor.occasionId);
  if (!loaded) return null;
  const parking = loaded.version ? await readListingParking(ctx, loaded.version.listingId) : null;
  const pois = loaded.model.pois.map((p, i) => ({ index: i + 1, kind: p.kind, name: p.name }));
  if (pois.length === 0 && !parking) return null;
  return { name: loaded.row.name, plan: pois.length > 0 ? guestPlan(loaded, []) : null, pois, parking };
}

/* ── What-if: the venue updated its drawing (V4) ──────────────────────────────────────── */

const tx_ = (key: string, params?: Record<string, string | number>): { key: string; params?: Record<string, string | number> } => (params ? { key, params } : { key });
const m = (mm: number | null) => (mm === null ? null : `${mmToMetresText(mm)} m`);
const typeSize = (t: TableType) => (t.shape === "round" ? (t.diameterMm === null ? null : `⌀ ${mmToMetresText(t.diameterMm)} m`) : t.widthMm === null || t.lengthMm === null ? null : `${mmToMetresText(t.widthMm)} × ${mmToMetresText(t.lengthMm)} m`);

type DrawingUpdatePlan = {
  delta: WhatIfDeltaRow[];
  /** venue table → becomes custom (its type is gone, or the venue now has fewer) */
  toCustom: string[];
  /** venue table whose stated size / seats changed */
  resize: Array<{ id: string; type: TableType }>;
  fixtureUpdates: Array<{ id: string; widthMm: number | null; lengthMm: number | null; name: string; x?: number; y?: number; rotation?: number }>;
  fixtureRemovals: string[];
  fixtureAdds: DrawingSnapshot["markings"]["fixtures"];
};

/** What accepting `next` would change — and which placed items it touches. Pure. */
export function planDrawingUpdate(prev: DrawingSnapshot | null, next: DrawingSnapshot, items: PlanItem[]): DrawingUpdatePlan {
  const delta: WhatIfDeltaRow[] = [];
  const out: DrawingUpdatePlan = { delta, toCustom: [], resize: [], fixtureUpdates: [], fixtureRemovals: [], fixtureAdds: [] };
  const P = prev?.markings ?? { areas: [], tableTypes: [], fixtures: [], pois: [], parkingAreas: [] };
  const N = next.markings;
  const row = (key: string, what: WhatIfText, before: WhatIfText | null | undefined, after: WhatIfText | null | undefined, noteKey?: string, noteParams?: Record<string, string | number>) => {
    if (before !== undefined && after !== undefined && JSON.stringify(before) === JSON.stringify(after)) return;
    delta.push({ key, what, before, after, ...(noteKey ? { noteKey, noteParams } : {}) });
  };
  if (prev) {
    row("name", tx_("space.whatif.name"), prev.name, next.name);
    row("width", tx_("space.whatif.width"), m(prev.widthMm), m(next.widthMm));
    row("length", tx_("space.whatif.length"), m(prev.lengthMm), m(next.lengthMm));
    const area = (s: DrawingSnapshot["markings"]) => (s.areas.length ? `${(Math.round(s.areas.reduce((a, x) => a + polygonArea(x.points), 0) / 100_000) / 10).toString().replace(".", ",")} m²` : null);
    row("areas", tx_("space.whatif.usableArea"), area(P), area(N));
  }
  // table inventory
  for (const t of N.tableTypes) {
    const old = P.tableTypes.find((o) => o.id === t.id);
    const describe = (x: TableType): WhatIfText => tx_("space.whatif.tableFacts", { size: typeSize(x) ?? "?", seats: x.seats ?? "?", count: x.count ?? "?" });
    if (!old) row(`type:${t.id}`, tx_("space.whatif.tableType", { name: t.name }), null, describe(t), "space.whatif.added");
    else row(`type:${t.id}`, tx_("space.whatif.tableType", { name: t.name }), describe(old), describe(t));
    const placed = items.filter((i) => i.kind === "table" && i.source === "venue" && i.venueRef === t.id);
    if (old && (typeSize(old) !== typeSize(t) || old.seats !== t.seats)) for (const p of placed) out.resize.push({ id: p.id, type: t });
    if (t.count !== null && placed.length > t.count) {
      for (const p of placed.slice(t.count)) {
        out.toCustom.push(p.id);
        row(`item:${p.id}`, tx_("space.whatif.placedTable", { label: p.label }), tx_("space.whatif.venueTable"), tx_("space.whatif.becomesCustom"), "space.whatif.overCount", { name: t.name, count: t.count });
      }
    }
  }
  for (const old of P.tableTypes) {
    if (N.tableTypes.some((t) => t.id === old.id)) continue;
    row(`type:${old.id}`, tx_("space.whatif.tableType", { name: old.name }), tx_("space.whatif.tableFacts", { size: typeSize(old) ?? "?", seats: old.seats ?? "?", count: old.count ?? "?" }), tx_("space.whatif.removed"));
    for (const p of items.filter((i) => i.kind === "table" && i.source === "venue" && i.venueRef === old.id)) {
      out.toCustom.push(p.id);
      row(`item:${p.id}`, tx_("space.whatif.placedTable", { label: p.label }), tx_("space.whatif.venueTable"), tx_("space.whatif.becomesCustom"), "space.whatif.typeGone");
    }
  }
  // fixtures
  const fixtureSize = (f: { widthMm: number | null; lengthMm: number | null }) => (f.widthMm === null || f.lengthMm === null ? null : `${mmToMetresText(f.widthMm)} × ${mmToMetresText(f.lengthMm)} m`);
  for (const f of N.fixtures) {
    const old = P.fixtures.find((o) => o.id === f.id);
    const placed = items.find((i) => i.kind === "fixture" && i.source === "venue" && i.venueRef === f.id);
    if (!old) {
      row(`fixture:${f.id}`, tx_("space.whatif.fixture", { name: f.name }), null, fixtureSize(f), "space.whatif.added");
      if (!placed) out.fixtureAdds.push(f);
      continue;
    }
    row(`fixture:${f.id}`, tx_("space.whatif.fixture", { name: f.name }), fixtureSize(old), fixtureSize(f));
    if (placed) {
      // a fixture the planner has not moved follows the venue's new position
      const unmoved = placed.x === old.x && placed.y === old.y && placed.rotation === old.rotation;
      out.fixtureUpdates.push({ id: placed.id, widthMm: f.widthMm, lengthMm: f.lengthMm, name: f.name, ...(unmoved ? { x: f.x, y: f.y, rotation: f.rotation } : {}) });
    }
  }
  for (const old of P.fixtures) {
    if (N.fixtures.some((f) => f.id === old.id)) continue;
    row(`fixture:${old.id}`, tx_("space.whatif.fixture", { name: old.name }), fixtureSize(old), tx_("space.whatif.removed"));
    for (const p of items.filter((i) => i.kind === "fixture" && i.source === "venue" && i.venueRef === old.id)) out.fixtureRemovals.push(p.id);
  }
  // which placed items would no longer be on usable floor
  if (N.areas.length > 0) {
    const gone = new Set([...out.fixtureRemovals]);
    for (const it of items) {
      if (gone.has(it.id)) continue;
      const resized = out.resize.find((r) => r.id === it.id);
      const shaped: PlanItem = resized ? { ...it, diameterMm: resized.type.diameterMm, widthMm: resized.type.widthMm, lengthMm: resized.type.lengthMm } : it;
      const f = itemFootprint(shaped);
      if (!f) continue;
      const before = P.areas.length > 0 ? insideAreas(itemFootprint(it) ?? f, P.areas) : true;
      if (before && !insideAreas(f, N.areas)) {
        row(`fit:${it.id}`, tx_(it.kind === "table" ? "space.whatif.placedTable" : "space.whatif.placedFixture", { label: it.label }), tx_("space.whatif.fitsNow"), tx_("space.whatif.noLongerFits"));
      }
    }
  }
  return out;
}

const updateDrawingInput = z.object({ toVersionId: zId });

async function modelBySubject(ctx: Pick<Ctx, "db">, subjectId: string): Promise<SpaceModelRow> {
  const [row] = await ctx.db.select().from(spaceModels).where(eq(spaceModels.id, subjectId));
  if (!row) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  return row;
}

/** Shared by the three kinds: the system and planning members may propose/read; only managers decide. */
async function authorizeSeating(ctx: Ctx, occasionId: string | null, action: "create" | "read" | "confirm" | "discard"): Promise<void> {
  if (!occasionId) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  if (ctx.actor.kind === "system" && action === "create") return;
  if (action === "create" || action === "read") await readAccess(ctx, occasionId);
  else await requireMember(ctx, occasionId, { manage: true });
}

function registerWhatIfKinds(): void {
  registerWhatIf<z.output<typeof updateDrawingInput>>("space.updateDrawing", {
    input: updateDrawingInput,
    authorize: async (ctx, subject, action) => {
      const row = await modelBySubject(ctx, subject.subjectId);
      if (row.occasionId !== subject.occasionId) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
      await authorizeSeating(ctx, row.occasionId, action);
    },
    compute: async (ctx, input, subject) => {
      const row = await modelBySubject(ctx, subject.subjectId);
      const next = await readDrawingVersion(ctx, input.toVersionId);
      if (!next || next.spaceId !== row.spaceId) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
      if (next.snapshot.mmPerPx === null) throw new AppError("CONFLICT", "space.errors.notCalibrated");
      const loaded = await requireModel(ctx, row.occasionId);
      const plan = planDrawingUpdate(loaded.version?.snapshot ?? null, next.snapshot, loaded.model.items);
      const versionRow: WhatIfDeltaRow = {
        key: "version",
        what: tx_("space.whatif.version"),
        before: row.versionNo === null ? null : tx_("space.whatif.versionNo", { n: row.versionNo }),
        after: tx_("space.whatif.versionNo", { n: next.versionNo }),
      };
      return { title: tx_("space.whatif.updateTitle", { name: next.snapshot.name }), delta: [versionRow, ...plan.delta] };
    },
    apply: async (tx, preview) => {
      const loaded = await requireModel(tx, preview.occasionId!, { lock: true });
      const { row } = loaded;
      if (row.id !== preview.subjectId) throw new AppError("CONFLICT", "space.errors.stale");
      const next = await readDrawingVersion(tx, preview.input.toVersionId);
      if (!next || next.spaceId !== row.spaceId) throw new AppError("CONFLICT", "space.errors.stale");
      if (next.snapshot.mmPerPx === null) throw new AppError("CONFLICT", "space.errors.notCalibrated");
      if (row.drawingVersionId === next.id) return;
      if (row.versionNo !== null && next.versionNo < row.versionNo) throw new AppError("CONFLICT", "space.errors.stale");
      const plan = planDrawingUpdate(loaded.version?.snapshot ?? null, next.snapshot, loaded.model.items);
      await tx.db
        .update(spaceModels)
        .set({ drawingVersionId: next.id, versionNo: next.versionNo, effectiveAt: next.effectiveAt, name: next.snapshot.name })
        .where(eq(spaceModels.id, row.id));
      const bump = { version: sql`${planItems.version} + 1` };
      for (const r of plan.resize) {
        if (plan.toCustom.includes(r.id)) continue;
        await tx.db
          .update(planItems)
          .set({ name: r.type.name, shape: r.type.shape, diameterMm: r.type.shape === "round" ? r.type.diameterMm : null, widthMm: r.type.shape === "rect" ? r.type.widthMm : null, lengthMm: r.type.shape === "rect" ? r.type.lengthMm : null, seats: r.type.seats, ...bump })
          .where(eq(planItems.id, r.id));
      }
      if (plan.toCustom.length > 0) await tx.db.update(planItems).set({ source: "custom", venueRef: null, ...bump }).where(inArray(planItems.id, plan.toCustom));
      for (const f of plan.fixtureUpdates) {
        await tx.db
          .update(planItems)
          .set({ name: f.name, label: f.name, widthMm: f.widthMm, lengthMm: f.lengthMm, ...(f.x !== undefined ? { x: f.x, y: f.y, rotation: f.rotation } : {}), ...bump })
          .where(eq(planItems.id, f.id));
      }
      if (plan.fixtureRemovals.length > 0) await tx.db.delete(planItems).where(inArray(planItems.id, plan.fixtureRemovals));
      if (plan.fixtureAdds.length > 0) {
        await tx.db.insert(planItems).values(fixtureItemValues(row.occasionId, row.id, { ...next.snapshot, markings: { ...next.snapshot.markings, fixtures: plan.fixtureAdds } }));
      }
      await audit(tx, { action: "space.drawingUpdated", objectType: "space_model", objectId: row.id, before: { versionNo: row.versionNo }, after: { versionNo: next.versionNo } });
    },
  });

  registerWhatIf<z.output<typeof addCustomTableInput>>("space.addCustomTable", {
    input: addCustomTableInput,
    authorize: (ctx, subject, action) => authorizeSeating(ctx, subject.occasionId, action),
    compute: async (ctx, input, subject) => {
      await requireModel(ctx, subject.occasionId!);
      const size = input.shape === "round" ? (input.diameterMm ? `⌀ ${mmToMetresText(input.diameterMm)} m` : null) : input.widthMm && input.lengthMm ? `${mmToMetresText(input.widthMm)} × ${mmToMetresText(input.lengthMm)} m` : null;
      return {
        title: tx_("space.whatif.customTitle", { name: input.name }),
        delta: [
          { key: "table", what: tx_("space.whatif.customTable", { name: input.name, count: input.count }), before: undefined, after: size, noteKey: "space.whatif.customNote" },
          { key: "seats", what: tx_("space.whatif.customSeats"), before: undefined, after: String(input.seats * input.count) },
        ],
      };
    },
    apply: async (tx, preview) => {
      const { count, x, y, ...custom } = preview.input;
      const loaded = await requireModel(tx, preview.occasionId!, { lock: true });
      for (let i = 0; i < count; i++) {
        const at = x !== undefined && y !== undefined ? { x: x + i * 2600, y } : {};
        await insertTable(tx, loaded, { occasionId: preview.occasionId!, id: undefined, custom, tableTypeId: undefined, label: undefined, rotation: 0, x: undefined, y: undefined, ...at });
      }
    },
  });

  registerWhatIf<z.output<typeof applyLayoutInput>>("seating.applyLayout", {
    input: applyLayoutInput,
    authorize: (ctx, subject, action) => authorizeSeating(ctx, subject.occasionId, action),
    compute: async (ctx, input, subject) => {
      const occasionId = subject.occasionId!;
      const loaded = await requireModel(ctx, occasionId);
      const [summary, roster] = await Promise.all([getRsvpSummaryUnchecked(ctx, occasionId), readRoster(ctx, occasionId)]);
      const sim = simulateLayout(loaded, input);
      const seatedNow = seatedFromRoster(roster);
      const delta: WhatIfDeltaRow[] = [];
      for (const t of sim.tables) {
        const people = t.spec.guestIds.length + t.spec.groups.length;
        delta.push({
          key: `table:${t.item.id}`,
          what: tx_("seating.whatif.table", { label: t.item.label }),
          before: t.existing ? tx_("seating.whatif.at", { x: mmToMetresText(t.existing.x), y: mmToMetresText(t.existing.y) }) : undefined,
          after: tx_("seating.whatif.at", { x: mmToMetresText(t.item.x), y: mmToMetresText(t.item.y) }),
          ...(t.existing ? {} : { noteKey: t.item.source === "custom" ? "seating.whatif.newCustom" : "seating.whatif.newVenue" }),
        });
        if (people > 0) delta.push({ key: `seat:${t.item.id}`, what: tx_("seating.whatif.seatAt", { label: t.item.label }), before: String(t.existing ? (seatedNow.get(t.existing.id) ?? 0) : 0), after: tx_("seating.whatif.people", { count: people }) });
      }
      for (const r of sim.removed) delta.push({ key: `remove:${r.id}`, what: tx_("seating.whatif.table", { label: r.label }), before: tx_("seating.whatif.onPlan"), after: tx_("seating.whatif.removed") });
      const fit = checkFit(sim.model, { needed: summary });
      delta.push({
        key: "fit",
        what: tx_("seating.whatif.fit"),
        before: undefined,
        after: fit.status === "fits" ? tx_("seating.fit.fits") : fit.status === "unknown" ? tx_("seating.fit.unknownShort") : fit.seats.missing > 0 ? tx_("seating.fit.missingSeats", { count: fit.seats.missing }) : tx_("seating.fit.problems", { count: fit.issues.length }),
        ...(fit.excluded.length > 0 ? { noteKey: "seating.whatif.excluded", noteParams: { count: fit.excluded.length } } : {}),
      });
      return { title: tx_("seating.whatif.title", { count: sim.tables.length }), delta };
    },
    apply: async (tx, preview) => {
      const occasionId = preview.occasionId!;
      const loaded = await requireModel(tx, occasionId, { lock: true });
      const input = preview.input;
      const mentioned = new Set<string>();
      for (const spec of input.tables) {
        let itemId: string;
        if (spec.itemId) {
          const [upd] = await tx.db
            .update(planItems)
            .set({ x: spec.x, y: spec.y, rotation: spec.rotation, ...(spec.label ? { label: spec.label } : {}), version: sql`${planItems.version} + 1` })
            .where(and(eq(planItems.id, spec.itemId), eq(planItems.occasionId, occasionId), eq(planItems.kind, "table")))
            .returning();
          if (!upd) throw new AppError("CONFLICT", "seating.errors.itemGone");
          itemId = upd.id;
        } else {
          const row = await insertTable(tx, loaded, { occasionId, id: undefined, tableTypeId: spec.tableTypeId, custom: spec.custom, label: spec.label, x: spec.x, y: spec.y, rotation: spec.rotation });
          itemId = row.id;
        }
        mentioned.add(itemId);
        if (spec.guestIds.length + spec.groups.length > 0) await placeAtTable(tx, { occasionId, tableItemId: itemId, guestIds: spec.guestIds, groups: spec.groups });
      }
      if (input.mode === "replace") {
        const drop = loaded.items.filter((i) => i.kind === "table" && !mentioned.has(i.id)).map((i) => i.id);
        if (drop.length > 0) await tx.db.delete(planItems).where(inArray(planItems.id, drop));
      }
      await audit(tx, { action: "seating.layoutApplied", objectType: "occasion", objectId: occasionId, meta: { tables: input.tables.length, mode: input.mode } });
    },
  });
}

const addCustomTableInput = customTable.extend({
  /** How many of them. */
  count: z.number().int().min(1).max(60).default(1),
  x: zCoordMm.optional(),
  y: zCoordMm.optional(),
});
export type AddCustomTableProposal = z.input<typeof addCustomTableInput>;

const applyLayoutInput = z.object({
  /** merge = touch only the listed tables; replace = tables not listed are removed (fixtures always stay). */
  mode: z.enum(["merge", "replace"]).default("merge"),
  tables: z
    .array(
      z
        .object({
          /** An existing table to move … */
          itemId: zId.optional(),
          /** … or a new one from the venue's inventory … */
          tableTypeId: z.string().min(1).max(40).optional(),
          /** … or a new custom one (V5). */
          custom: customTable.optional(),
          label: z.string().trim().min(1).max(24).optional(),
          x: zCoordMm,
          y: zCoordMm,
          rotation: zRotation.default(0),
          /** Named adults to seat here. */
          guestIds: z.array(zId).max(SPACE_LIMITS.maxSeats).default([]),
          /** Counted blocks to seat here: a household's unnamed adults or its children. */
          groups: z.array(groupRef).max(SPACE_LIMITS.maxSeats).default([]),
        })
        .refine((t) => [t.itemId, t.tableTypeId, t.custom].filter(Boolean).length === 1, { message: "common.validation.invalid" }),
    )
    .min(1)
    .max(200),
});
export type ApplyLayoutProposal = z.input<typeof applyLayoutInput>;

/** needed = people attending; reads without an access check (callers have authorised). */
async function getRsvpSummaryUnchecked(ctx: Pick<Ctx, "db">, occasionId: string): Promise<number> {
  const rows = await ctx.db.select().from(rsvpResponses).where(and(eq(rsvpResponses.occasionId, occasionId), eq(rsvpResponses.attending, "yes")));
  return rows.reduce((n, r) => n + r.adultsCount + r.childrenCount, 0);
}

type SimTable = { item: PlanItem; existing: PlanItemRow | null; spec: z.output<typeof applyLayoutInput>["tables"][number] };

/** The layout a proposal would produce — nothing is written. Unknown ids throw NOT_FOUND. */
function simulateLayout(loaded: Loaded, input: z.output<typeof applyLayoutInput>): { model: PlanModel; tables: SimTable[]; removed: PlanItemRow[] } {
  const tables: SimTable[] = [];
  const touched = new Set<string>();
  const labels = [...loaded.items];
  for (const [i, spec] of input.tables.entries()) {
    if (spec.itemId) {
      const existing = loaded.items.find((it) => it.id === spec.itemId && it.kind === "table");
      if (!existing) throw new AppError("NOT_FOUND", "seating.errors.itemGone");
      touched.add(existing.id);
      tables.push({ existing, spec, item: { ...rowToItem(existing), x: spec.x, y: spec.y, rotation: spec.rotation, label: spec.label ?? existing.label } });
      continue;
    }
    const label = spec.label ?? nextLabel(labels);
    let item: PlanItem;
    if (spec.tableTypeId) {
      const type = loaded.model.tableTypes.find((t) => t.id === spec.tableTypeId);
      if (!type) throw new AppError("NOT_FOUND", "seating.errors.unknownTableType");
      item = { id: `new-${i}`, kind: "table", source: "venue", venueRef: type.id, name: type.name, label, shape: type.shape, diameterMm: type.diameterMm, widthMm: type.widthMm, lengthMm: type.lengthMm, seats: type.seats, x: spec.x, y: spec.y, rotation: spec.rotation };
    } else {
      const c = spec.custom!;
      item = { id: `new-${i}`, kind: "table", source: "custom", name: c.name, label, shape: c.shape, ...customDims(c), seats: c.seats, x: spec.x, y: spec.y, rotation: spec.rotation };
    }
    labels.push({ kind: "table", label } as PlanItemRow);
    tables.push({ existing: null, spec, item });
  }
  const removed = input.mode === "replace" ? loaded.items.filter((it) => it.kind === "table" && !touched.has(it.id)) : [];
  const kept = loaded.model.items.filter((it) => !touched.has(it.id) && !removed.some((r) => r.id === it.id));
  return { model: { ...loaded.model, items: [...kept, ...tables.map((t) => t.item)] }, tables, removed };
}

registerWhatIfKinds();

/**
 * Asks the planner whether to take the venue's newer approved drawing. Creates (or returns)
 * the pending "space.updateDrawing" preview; nothing changes until it is confirmed (V4).
 */
export async function proposeDrawingUpdate(ctx: Ctx, occasionId: string): Promise<WhatIfPreview | null> {
  await readAccess(ctx, occasionId);
  const view = await getSpaceModel(ctx, occasionId);
  if (!view || !view.newerVersion || !view.newerVersion.usable) return null;
  if (view.pendingUpdatePreviewId) {
    const [p] = await ctx.db.select().from(whatifPreviews).where(eq(whatifPreviews.id, view.pendingUpdatePreviewId));
    if (p) return p;
  }
  return createPreview(ctx, { kind: "space.updateDrawing", occasionId, subjectType: "space_model", subjectId: view.id, input: { toVersionId: view.newerVersion.versionId } });
}

// V4: when a moderator approves a newer drawing, every plan built on that space gets a
// proposal — as the system, inside the approving transaction. The plans themselves stay on
// their version until a planner confirms.
onDrawingVersionPublished(async (tx, version) => {
  if (version.snapshot.mmPerPx === null) return; // V7: an uncalibrated drawing is never offered to a plan
  const models = await tx.db.select().from(spaceModels).where(and(eq(spaceModels.spaceId, version.spaceId), eq(spaceModels.source, "venue")));
  const sys = systemCtx(tx.db, { now: tx.now });
  for (const model of models) {
    if (model.drawingVersionId === version.id) continue;
    await createPreview(sys, { kind: "space.updateDrawing", occasionId: model.occasionId, subjectType: "space_model", subjectId: model.id, input: { toVersionId: version.id } });
  }
});

/* ── Guest sections, export, purge ────────────────────────────────────────────────────── */

registerGuestSection<GuestSeat>({ key: "seat", order: 30, load: (ctx) => getGuestSeat(ctx) });
registerGuestSection<GuestSpaceView>({ key: "spaceView", order: 60, load: (ctx) => getGuestSpaceView(ctx) });

registerExport({
  key: "seating",
  titleKey: "seating.export.title",
  descriptionKey: "seating.export.description",
  manageOnly: true,
  run: async (ctx, occasionId) => {
    await requireMember(ctx, occasionId, { manage: true });
    const [loaded, roster] = await Promise.all([loadModel(ctx, occasionId), readRoster(ctx, occasionId)]);
    const label = new Map((loaded?.items ?? []).map((i) => [i.id, i.label]));
    const rows: Array<Array<string | number | null>> = [];
    for (const h of roster) {
      for (const a of h.adults) rows.push([a.tableItemId ? (label.get(a.tableItemId) ?? "") : "", a.seatNo, h.name, a.name, 1, h.attending ?? ""]);
      if (h.extra) rows.push([h.extra.tableItemId ? (label.get(h.extra.tableItemId) ?? "") : "", null, h.name, `+${h.extra.count} adults`, h.extra.count, h.attending ?? ""]);
      if (h.children) rows.push([h.children.tableItemId ? (label.get(h.children.tableItemId) ?? "") : "", null, h.name, `+${h.children.count} children`, h.children.count, h.attending ?? ""]);
    }
    rows.sort((a, b) => String(a[0]).localeCompare(String(b[0]), "ro", { numeric: true }) || String(a[2]).localeCompare(String(b[2]), "ro"));
    return { filename: "seating.csv", mime: "text/csv; charset=utf-8", content: toCsv(["table", "seat", "household", "guest", "places", "rsvp"], rows) };
  },
});

onOccasionPurge(async (tx, occasionId) => {
  // stage variants, seat assignments and items cascade from these
  await tx.db.delete(mealStages).where(eq(mealStages.occasionId, occasionId));
  await tx.db.delete(spaceModels).where(eq(spaceModels.occasionId, occasionId));
  await tx.db.delete(seatingPlans).where(eq(seatingPlans.occasionId, occasionId));
});

export { DEFAULT_AISLE_MM };
