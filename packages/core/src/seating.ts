import { prisma } from '@eventdesk/db';
import { AppError, now } from '@eventdesk/shared';
import { audit } from './audit';
import { requireMember, requireRole } from './access';
import { fitCheck, getSpaceModel } from './drawings';

// C-01/C-02/C-08: seating on the occasion's space model. Every arrangement action has
// a tap path (the API takes plain assignments — drag is only a UI affordance, Q10);
// fit checks exclude unknown dims (V6); unpublished seating is never visible to
// guests (C-08); publishing shows each guest their own table/seat on their link.

export async function getOrCreatePlan(occasionId: string, accountId: string) {
  await requireRole(occasionId, accountId, ['owner', 'project_manager', 'workstream_lead']);
  const existing = await prisma.seatingPlan.findFirst({
    where: { occasionId },
    orderBy: { version: 'desc' },
    include: { assignments: true },
  });
  if (existing) return existing;
  return prisma.seatingPlan.create({ data: { occasionId, createdById: accountId } });
}

export async function saveAssignments(
  occasionId: string,
  accountId: string,
  assignments: { householdId: string; tableRef: string; seat?: string }[]
) {
  await requireRole(occasionId, accountId, ['owner', 'project_manager', 'workstream_lead']);
  let plan = await prisma.seatingPlan.findFirst({
    where: { occasionId },
    orderBy: { version: 'desc' },
  });
  if (!plan) {
    plan = await prisma.seatingPlan.create({ data: { occasionId, createdById: accountId } });
  }
  // validate households belong to the occasion
  const households = await prisma.household.findMany({
    where: { id: { in: assignments.map((a) => a.householdId) } },
    select: { id: true, occasionId: true },
  });
  for (const h of households) {
    if (h.occasionId !== occasionId)
      throw new AppError('FORBIDDEN', 'Household not on this occasion.');
  }
  if (households.length !== new Set(assignments.map((a) => a.householdId)).size) {
    throw new AppError('INVALID_INPUT', 'Unknown household.');
  }
  await prisma.$transaction(async (tx) => {
    await tx.seatAssignment.deleteMany({ where: { planId: plan!.id } });
    for (const a of assignments) {
      await tx.seatAssignment.create({
        data: {
          planId: plan!.id,
          householdId: a.householdId,
          tableRef: a.tableRef,
          seat: a.seat ?? null,
        },
      });
    }
    await tx.seatingPlan.update({
      where: { id: plan!.id },
      data: { version: { increment: 1 }, published: false, publishedAt: null },
    });
    await tx.auditLog.create({
      data: {
        actorId: accountId,
        actorKind: 'account',
        action: 'seating_saved',
        objectType: 'SeatingPlan',
        objectId: plan!.id,
        after: { count: assignments.length },
      },
    });
  });
  return prisma.seatingPlan.findUniqueOrThrow({
    where: { id: plan.id },
    include: { assignments: true },
  });
}

// C-02: fit check of the plan against the space model — unknown dims excluded (V6).
export async function fitCheckSeating(occasionId: string, accountId: string) {
  const model = await getSpaceModel(occasionId, accountId);
  if (!model) throw new AppError('NOT_FOUND', 'No space model on this occasion.');
  const tables = [
    ...model.drawing.tables.map((t) => ({ widthM: t.widthM, heightM: t.heightM })),
    ...model.customTables.map((t) => ({ widthM: t.widthM, heightM: t.heightM })),
  ];
  return fitCheck({ tables });
}

// C-02: record a meal-stage fit check (incl. between courses).
export async function checkMealStage(
  occasionId: string,
  accountId: string,
  input: { label: string; guestCount: number }
) {
  await requireMember(occasionId, accountId);
  const fit = await fitCheckSeating(occasionId, accountId);
  const stage = await prisma.mealStage.create({
    data: {
      occasionId,
      label: input.label,
      guestCount: input.guestCount,
      result: fit as unknown as object,
      checkedAt: now(),
    },
  });
  await audit({
    actorId: accountId,
    actorKind: 'account',
    action: 'meal_stage_fit_checked',
    objectType: 'MealStage',
    objectId: stage.id,
    after: { label: input.label, ...fit },
  });
  return stage;
}

// C-08: publish — only then do guests see their seat on their own link.
export async function publishSeating(occasionId: string, accountId: string) {
  await requireRole(occasionId, accountId, ['owner', 'project_manager']);
  const plan = await prisma.seatingPlan.findFirstOrThrow({
    where: { occasionId },
    orderBy: { version: 'desc' },
  });
  const updated = await prisma.seatingPlan.update({
    where: { id: plan.id },
    data: { published: true, publishedAt: now() },
  });
  await audit({
    actorId: accountId,
    actorKind: 'account',
    action: 'seating_published',
    objectType: 'SeatingPlan',
    objectId: plan.id,
    after: { version: plan.version },
  });
  return updated;
}

// C-08: guest-side seat lookup — returns null unless the plan is published.
export async function getGuestSeat(occasionId: string, householdId: string) {
  const plan = await prisma.seatingPlan.findFirst({
    where: { occasionId, published: true },
    orderBy: { version: 'desc' },
    include: { assignments: { where: { householdId } } },
  });
  if (!plan || plan.assignments.length === 0) return null;
  const a = plan.assignments[0]!;
  return { tableRef: a.tableRef, seat: a.seat, planVersion: plan.version };
}
