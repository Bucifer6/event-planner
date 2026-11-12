import { prisma } from '@eventdesk/db';
import { AppError, now } from '@eventdesk/shared';
import { audit } from './audit';
import { requireMember, requireRole, canManage } from './access';
import { createPreview, confirmPreview, getPreview } from './whatif';
import { settlementView } from './ledger';

// Release D (solo or group holiday):
// D-01 itinerary across time zones — stored UTC (INF8), displayed in Europe/Bucharest
// and the trip zone; booking imports arrive as What-if previews, applied only on
// confirm (principle 3). D-02 subgroups + optional activities with grant-respecting
// scoped views (D2). D-03 packing lists. D-04 transport legs + room allocation atomic
// like capacity (A8). D-05 settlement per currency from the one ledger (B3).

// ---------- D-01 itinerary ----------

export async function addItineraryLeg(
  occasionId: string,
  accountId: string,
  input: {
    title: string;
    kind: string;
    startsAtUtc: Date;
    endsAtUtc?: Date;
    zone?: string;
    details?: unknown;
  }
) {
  await requireMember(occasionId, accountId);
  if (!input.title.trim()) throw new AppError('INVALID_INPUT', 'Title required.');
  if (!/^[A-Za-z]+\/[A-Za-z_/-]+$/.test(input.zone ?? 'Europe/Bucharest')) {
    throw new AppError('INVALID_INPUT', 'Zone must be an IANA name (e.g. Europe/Bucharest).');
  }
  const leg = await prisma.itineraryLeg.create({
    data: {
      occasionId,
      title: input.title.trim(),
      kind: input.kind,
      startsAtUtc: input.startsAtUtc, // stored UTC (INF8)
      endsAtUtc: input.endsAtUtc ?? null,
      zone: input.zone ?? 'Europe/Bucharest',
      details: input.details === undefined ? undefined : (input.details as object),
    },
  });
  await audit({
    actorId: accountId,
    actorKind: 'account',
    action: 'itinerary_leg_added',
    objectType: 'ItineraryLeg',
    objectId: leg.id,
    after: { zone: leg.zone, startsAtUtc: leg.startsAtUtc.toISOString() },
  });
  return leg;
}

// D-01: a booking import (e.g. from a confirmation email) enters as a What-if
// preview; nothing is applied until the planner confirms.
export async function proposeItineraryImport(
  occasionId: string,
  accountId: string,
  legs: { title: string; kind: string; startsAtUtc: string; endsAtUtc?: string; zone?: string }[]
) {
  await requireMember(occasionId, accountId);
  return createPreview({
    occasionId,
    subject: 'itinerary_import',
    delta: { legs },
    proposedByAccountId: accountId,
  });
}

export async function confirmItineraryImport(previewId: string, accountId: string) {
  const preview = await getPreview(previewId);
  if (preview.subject !== 'itinerary_import')
    throw new AppError('CONFLICT', 'Not an import preview.');
  const delta = preview.delta as {
    legs: { title: string; kind: string; startsAtUtc: string; endsAtUtc?: string; zone?: string }[];
  };
  return confirmPreview(previewId, accountId, async () => {
    for (const l of delta.legs) {
      await prisma.itineraryLeg.create({
        data: {
          occasionId: preview.occasionId as string,
          title: l.title,
          kind: l.kind,
          startsAtUtc: new Date(l.startsAtUtc),
          endsAtUtc: l.endsAtUtc ? new Date(l.endsAtUtc) : null,
          zone: l.zone ?? 'Europe/Bucharest',
        },
      });
    }
  });
}

export async function listItinerary(occasionId: string, accountId: string) {
  await requireMember(occasionId, accountId);
  return prisma.itineraryLeg.findMany({
    where: { occasionId },
    orderBy: { startsAtUtc: 'asc' },
  });
}

// ---------- D-02 subgroups + optional activities ----------

export async function createSubgroup(
  occasionId: string,
  accountId: string,
  name: string,
  householdIds: string[]
) {
  await requireMember(occasionId, accountId);
  if (!name.trim()) throw new AppError('INVALID_INPUT', 'Name required.');
  const sg = await prisma.subgroup.create({ data: { occasionId, name: name.trim() } });
  for (const householdId of householdIds) {
    const h = await prisma.household.findUnique({ where: { id: householdId } });
    if (!h || h.occasionId !== occasionId)
      throw new AppError('FORBIDDEN', 'Household not on this occasion.');
    await prisma.subgroupMember.create({ data: { subgroupId: sg.id, householdId } });
  }
  await audit({
    actorId: accountId,
    actorKind: 'account',
    action: 'subgroup_created',
    objectType: 'Subgroup',
    objectId: sg.id,
  });
  return prisma.subgroup.findUniqueOrThrow({ where: { id: sg.id }, include: { members: true } });
}

export async function addActivity(
  occasionId: string,
  accountId: string,
  input: {
    title: string;
    startsAtUtc: Date;
    zone?: string;
    subgroupId?: string;
    optional?: boolean;
  }
) {
  await requireMember(occasionId, accountId);
  if (input.subgroupId) {
    const sg = await prisma.subgroup.findUniqueOrThrow({ where: { id: input.subgroupId } });
    if (sg.occasionId !== occasionId)
      throw new AppError('FORBIDDEN', 'Subgroup not on this occasion.');
  }
  return prisma.activity.create({
    data: {
      occasionId,
      subgroupId: input.subgroupId ?? null,
      title: input.title.trim(),
      startsAtUtc: input.startsAtUtc,
      zone: input.zone ?? 'Europe/Bucharest',
      optional: input.optional ?? true,
    },
  });
}

// D-02: subgroup-scoped view respects grants (D2) — occasion managers, or the
// account whose email is the lead contact of a member household, see the subgroup.
export async function listSubgroupView(occasionId: string, subgroupId: string, accountId: string) {
  const member = await requireMember(occasionId, accountId);
  const sg = await prisma.subgroup.findUniqueOrThrow({
    where: { id: subgroupId },
    include: { members: true },
  });
  if (sg.occasionId !== occasionId) throw new AppError('FORBIDDEN', 'Not on this occasion.');
  if (!canManage(member)) {
    const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    const memberHouseholdIds = sg.members.map((m) => m.householdId);
    const mine = await prisma.household.findFirst({
      where: {
        id: { in: memberHouseholdIds },
        leadEmail: account.email ?? undefined,
      },
    });
    if (!mine) throw new AppError('FORBIDDEN', 'Subgroup-scoped view requires membership (D2).');
  }
  const [activities, packing] = await Promise.all([
    prisma.activity.findMany({ where: { occasionId, subgroupId } }),
    prisma.packingItem.findMany({ where: { occasionId, subgroupId } }),
  ]);
  return { subgroup: sg, activities, packing };
}

// ---------- D-03 packing ----------

export async function addPackingItem(
  occasionId: string,
  accountId: string,
  input: { label: string; subgroupId?: string }
) {
  await requireMember(occasionId, accountId);
  if (!input.label.trim()) throw new AppError('INVALID_INPUT', 'Label required.');
  return prisma.packingItem.create({
    data: { occasionId, subgroupId: input.subgroupId ?? null, label: input.label.trim() },
  });
}

export async function togglePacking(
  occasionId: string,
  accountId: string,
  itemId: string,
  packed: boolean
) {
  await requireMember(occasionId, accountId);
  const item = await prisma.packingItem.findUniqueOrThrow({ where: { id: itemId } });
  if (item.occasionId !== occasionId) throw new AppError('FORBIDDEN', 'Not on this occasion.');
  return prisma.packingItem.update({
    where: { id: itemId },
    data: { packed, packedAt: packed ? now() : null },
  });
}

// ---------- D-04 transport legs + atomic room allocation ----------

export async function addTransportLeg(
  occasionId: string,
  accountId: string,
  input: {
    label: string;
    fromPlace: string;
    toPlace: string;
    departsAtUtc: Date;
    seats: number;
    zone?: string;
  }
) {
  await requireMember(occasionId, accountId);
  return prisma.transportLeg.create({
    data: {
      occasionId,
      label: input.label.trim(),
      fromPlace: input.fromPlace.trim(),
      toPlace: input.toPlace.trim(),
      departsAtUtc: input.departsAtUtc,
      seats: input.seats,
      zone: input.zone ?? 'Europe/Bucharest',
    },
  });
}

export async function createRoom(
  occasionId: string,
  accountId: string,
  name: string,
  capacity: number
) {
  await requireRole(occasionId, accountId, ['owner', 'project_manager', 'workstream_lead']);
  if (capacity < 1) throw new AppError('INVALID_INPUT', 'Capacity must be positive.');
  return prisma.room.create({ data: { occasionId, name: name.trim(), capacity } });
}

// D-04/A8: atomic room assignment — conditional UPDATE on occupants; rowCount decides.
export async function assignRoom(
  occasionId: string,
  accountId: string,
  roomId: string,
  householdId: string
) {
  await requireRole(occasionId, accountId, ['owner', 'project_manager', 'workstream_lead']);
  const room = await prisma.room.findUniqueOrThrow({ where: { id: roomId } });
  if (room.occasionId !== occasionId) throw new AppError('FORBIDDEN', 'Not on this occasion.');
  const h = await prisma.household.findUniqueOrThrow({ where: { id: householdId } });
  if (h.occasionId !== occasionId)
    throw new AppError('FORBIDDEN', 'Household not on this occasion.');
  const claimed = await prisma.$executeRaw`
    UPDATE "Room"
    SET "occupants" = "occupants" + 1
    WHERE id = ${roomId} AND "occupants" + 1 <= "capacity"
  `;
  if (claimed !== 1) {
    throw new AppError('CONFLICT', 'Room is full — assignment refused atomically (A8).');
  }
  try {
    const assignment = await prisma.roomAssignment.create({
      data: { roomId, householdId },
    });
    await audit({
      actorId: accountId,
      actorKind: 'account',
      action: 'room_assigned',
      objectType: 'RoomAssignment',
      objectId: assignment.id,
      after: { roomId, householdId },
    });
    return assignment;
  } catch {
    // roll back the counter if the assignment row failed
    await prisma.$executeRaw`UPDATE "Room" SET "occupants" = "occupants" - 1 WHERE id = ${roomId}`;
    throw new AppError('CONFLICT', 'Household already assigned to this room.');
  }
}

export async function listRooms(occasionId: string, accountId: string) {
  await requireMember(occasionId, accountId);
  return prisma.room.findMany({
    where: { occasionId },
    include: { assignments: true },
  });
}

// ---------- D-05 settlement per currency from the one ledger (B3) ----------

export async function settlementByCurrency(occasionId: string, accountId: string) {
  const view = await settlementView(occasionId, accountId); // finance grant enforced there
  // group ledger entries by currency
  const entries = await prisma.ledgerEntry.findMany({ where: { occasionId } });
  const groups = new Map<string, { paidBani: number; owedBani: number; count: number }>();
  for (const e of entries) {
    const g = groups.get(e.currency) ?? { paidBani: 0, owedBani: 0, count: 0 };
    g.count++;
    if (e.amountBani > 0) g.paidBani += e.amountBani;
    else g.owedBani += -e.amountBani;
    groups.set(e.currency, g);
  }
  return {
    base: view,
    byCurrency: [...groups.entries()].map(([currency, g]) => ({ currency, ...g })),
  };
}
