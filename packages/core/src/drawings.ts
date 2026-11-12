import { prisma } from '@eventdesk/db';
import { AppError, now } from '@eventdesk/shared';
import { audit } from './audit';
import { requireBusinessMember } from './business';
import { requireMember, requireRole } from './access';
import { createPreview, confirmPreview, getPreview } from './whatif';

// V1-V11: venue drawings and the occasion space model. A drawing must be
// calibrated (V7: two points of known real distance derive the scale) before its
// markings are accepted; uncalibrated drawings are stored but cannot be used for
// space models or fit checks. Booking a venue pulls the drawing into the plan as
// the space model with a visible version + effective date; later drawing updates
// arrive as a What-if proposal the planner accepts — never a silent overwrite (V4).

export async function addDrawing(
  listingId: string,
  accountId: string,
  input: { assetId: string; spaceName: string; realWidthM?: number; realHeightM?: number }
) {
  const listing = await prisma.listing.findUniqueOrThrow({ where: { id: listingId } });
  if (!listing.businessId || !listing.claimed)
    throw new AppError('FORBIDDEN', 'Only claimed listings can upload assets (P29).');
  await requireBusinessMember(listing.businessId, accountId, ['owner', 'admin']);
  return prisma.drawing.create({
    data: {
      listingId,
      assetId: input.assetId,
      spaceName: input.spaceName.trim() || 'Spațiu',
      realWidthM: input.realWidthM ?? null,
      realHeightM: input.realHeightM ?? null,
    },
  });
}

// V7: two-point calibration derives pixelsPerMeter. Without it the drawing is
// stored but unusable for space models or fit checks.
export async function calibrateDrawing(
  drawingId: string,
  accountId: string,
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  realDistanceM: number
) {
  const drawing = await prisma.drawing.findUniqueOrThrow({ where: { id: drawingId } });
  const listing = await prisma.listing.findUniqueOrThrow({ where: { id: drawing.listingId } });
  if (listing.businessId)
    await requireBusinessMember(listing.businessId, accountId, ['owner', 'admin']);
  if (realDistanceM <= 0) throw new AppError('INVALID_INPUT', 'Real distance must be positive.');
  const pixelDistance = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  if (pixelDistance <= 0) throw new AppError('INVALID_INPUT', 'The two points must differ.');
  return prisma.drawing.update({
    where: { id: drawingId },
    data: {
      calibrationP1: p1 as unknown as object,
      calibrationP2: p2 as unknown as object,
      pixelsPerMeter: pixelDistance / realDistanceM,
    },
  });
}

export async function addTableInventory(
  drawingId: string,
  accountId: string,
  input: { tableType: string; widthM?: number; heightM?: number; count: number }
) {
  const drawing = await prisma.drawing.findUniqueOrThrow({ where: { id: drawingId } });
  const listing = await prisma.listing.findUniqueOrThrow({ where: { id: drawing.listingId } });
  if (listing.businessId)
    await requireBusinessMember(listing.businessId, accountId, ['owner', 'admin']);
  return prisma.tableInventory.create({
    data: {
      drawingId,
      tableType: input.tableType,
      widthM: input.widthM ?? null,
      heightM: input.heightM ?? null,
      count: input.count,
    },
  });
}

export async function addFixture(
  drawingId: string,
  accountId: string,
  input: { kind: string; widthM?: number; heightM?: number }
) {
  const drawing = await prisma.drawing.findUniqueOrThrow({ where: { id: drawingId } });
  const listing = await prisma.listing.findUniqueOrThrow({ where: { id: drawing.listingId } });
  if (listing.businessId)
    await requireBusinessMember(listing.businessId, accountId, ['owner', 'admin']);
  return prisma.fixture.create({
    data: {
      drawingId,
      kind: input.kind,
      widthM: input.widthM ?? null,
      heightM: input.heightM ?? null,
    },
  });
}

export async function addPOI(drawingId: string, accountId: string, kind: string, label?: string) {
  const drawing = await prisma.drawing.findUniqueOrThrow({ where: { id: drawingId } });
  const listing = await prisma.listing.findUniqueOrThrow({ where: { id: drawing.listingId } });
  if (listing.businessId)
    await requireBusinessMember(listing.businessId, accountId, ['owner', 'admin']);
  return prisma.pointOfInterest.create({ data: { drawingId, kind, label: label ?? null } });
}

// V10/V11: parking facts, each known or unknown; a drawing/statement count
// mismatch flags the count as unknown until the business confirms.
export async function setParkingFacts(
  drawingId: string,
  accountId: string,
  input: {
    onSite?: boolean | null;
    spaceCount?: number | null;
    onStreet?: boolean | null;
    paid?: boolean | null;
    accessibleSpaces?: boolean | null;
    walkingDistanceM?: number | null;
    drawingSpaceCount?: number | null;
  }
) {
  const drawing = await prisma.drawing.findUniqueOrThrow({ where: { id: drawingId } });
  const listing = await prisma.listing.findUniqueOrThrow({ where: { id: drawing.listingId } });
  if (listing.businessId)
    await requireBusinessMember(listing.businessId, accountId, ['owner', 'admin']);
  let spaceCount = input.spaceCount ?? null;
  if (
    input.drawingSpaceCount != null &&
    spaceCount != null &&
    input.drawingSpaceCount !== spaceCount
  ) {
    spaceCount = null; // V11: mismatch -> unknown until the business confirms
  }
  return prisma.parkingFacts.upsert({
    where: { drawingId },
    update: { ...input, spaceCount, drawingSpaceCount: input.drawingSpaceCount ?? null },
    create: { drawingId, ...input, spaceCount, drawingSpaceCount: input.drawingSpaceCount ?? null },
  });
}

// V4: booking a venue pulls the calibrated drawing into the plan as the occasion's
// space model, with a visible version and effective date. V7 gate: uncalibrated
// drawings cannot be attached.
export async function attachSpaceModel(
  occasionId: string,
  accountId: string,
  drawingId: string,
  idempotencyKey?: string
) {
  await requireRole(occasionId, accountId, ['owner', 'project_manager', 'workstream_lead']);
  const drawing = await prisma.drawing.findUniqueOrThrow({ where: { id: drawingId } });
  if (!drawing.pixelsPerMeter) {
    throw new AppError(
      'INVALID_INPUT',
      'The drawing is not calibrated — two-point calibration is required before it can drive a space model or fit checks (V7).'
    );
  }
  const last = await prisma.spaceModelVersion.findFirst({
    where: { occasionId },
    orderBy: { version: 'desc' },
  });
  const version = (last?.version ?? 0) + 1;
  const { recordAssetUsage } = await import('./bizdashboard');
  await recordAssetUsage('drawing', drawingId, drawing.listingId); // P21 daily total, no visitor id
  return prisma.spaceModelVersion.create({
    data: {
      occasionId,
      drawingId,
      version,
      effectiveAt: now(),
      acceptedById: accountId,
    },
  });
  void idempotencyKey;
}

// V4: when the venue publishes a newer drawing version, the planner gets a
// What-if proposal — the plan is never silently overwritten.
export async function proposeDrawingUpdate(occasionId: string, newDrawingId: string) {
  const current = await prisma.spaceModelVersion.findFirst({
    where: { occasionId },
    orderBy: { version: 'desc' },
  });
  if (!current) throw new AppError('NOT_FOUND', 'No space model on this occasion.');
  const drawing = await prisma.drawing.findUniqueOrThrow({ where: { id: newDrawingId } });
  return createPreview({
    occasionId,
    subject: 'space_model_update',
    delta: {
      fromDrawingId: current.drawingId,
      fromVersion: current.version,
      toDrawingId: drawing.id,
      effectiveAt: now().toISOString(),
    },
  });
}

export async function confirmSpaceModelUpdate(previewId: string, accountId: string) {
  const preview = await getPreview(previewId);
  const delta = preview.delta as { toDrawingId: string };
  return confirmPreview(previewId, accountId, async () => {
    const current = await prisma.spaceModelVersion.findFirstOrThrow({
      where: { occasionId: preview.occasionId as string },
      orderBy: { version: 'desc' },
    });
    await prisma.spaceModelVersion.create({
      data: {
        occasionId: preview.occasionId as string,
        drawingId: delta.toDrawingId,
        version: current.version + 1,
        effectiveAt: now(),
        acceptedById: accountId,
      },
    });
  });
}

// V5: custom tables on the space model, marked custom, never venue-supplied.
export async function addCustomTable(
  occasionId: string,
  accountId: string,
  input: { name: string; widthM?: number; heightM?: number }
) {
  await requireRole(occasionId, accountId, ['owner', 'project_manager', 'workstream_lead']);
  const model = await prisma.spaceModelVersion.findFirstOrThrow({
    where: { occasionId },
    orderBy: { version: 'desc' },
  });
  return prisma.customTable.create({
    data: {
      spaceModelId: model.id,
      name: input.name,
      widthM: input.widthM ?? null,
      heightM: input.heightM ?? null,
    },
  });
}

// V6: unknown dimensions are shown as unknown and excluded from fit checks.
export function fitCheck(model: { tables: { widthM: number | null; heightM: number | null }[] }): {
  checked: number;
  excludedUnknown: number;
} {
  const checked = model.tables.filter((t) => t.widthM != null && t.heightM != null).length;
  return { checked, excludedUnknown: model.tables.length - checked };
}

export async function getSpaceModel(occasionId: string, accountId: string) {
  await requireMember(occasionId, accountId);
  const model = await prisma.spaceModelVersion.findFirst({
    where: { occasionId },
    orderBy: { version: 'desc' },
    include: {
      drawing: {
        include: {
          tables: true,
          fixtures: true,
          pois: true,
          parking: true,
          listing: { include: { categories: { include: { category: true } } } },
        },
      },
      customTables: true,
    },
  });
  return model;
}
