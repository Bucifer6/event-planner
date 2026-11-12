import { describe, expect, it } from 'vitest';
import { prisma } from '@eventdesk/db';
import {
  addProgrammeItem,
  checkInByQr,
  createInvitation,
  createOccasion,
  createTask,
  guestFlowEstimates,
  listArrivals,
  listSustainability,
  queueOfflineItem,
  recordMeasurement,
  reconcileOfflineQueue,
  setSustainabilityGoal,
  simulateDay,
  updateTask,
} from '../src/index';

async function makeAccount(email?: string) {
  return prisma.account.create({
    data: {
      kind: 'email',
      email: email ?? `e-${Math.random().toString(36).slice(2)}@example.com`,
      emailVerifiedAt: new Date(),
    },
  });
}

async function setup() {
  const owner = await makeAccount();
  const occasion = await createOccasion({
    ownerId: owner.id,
    title: 'Nunta mare',
    kind: 'nunta',
    dateMode: 'date',
    dateStart: new Date('2027-06-15T15:00:00Z'),
    dateEnd: new Date('2027-06-16T02:00:00Z'),
  });
  const h1 = await prisma.household.create({
    data: { occasionId: occasion.id, name: 'Familia Pop', leadEmail: 'pop@example.com' },
  });
  const h2 = await prisma.household.create({
    data: { occasionId: occasion.id, name: 'Familia Ionescu' },
  });
  const g1 = await prisma.guest.create({ data: { householdId: h1.id, name: 'Ana Pop' } });
  const g2 = await prisma.guest.create({ data: { householdId: h1.id, name: 'Ion Pop' } });
  await prisma.guest.create({ data: { householdId: h2.id, name: 'Maria Ionescu' } });
  return { owner, occasion, h1, h2, g1, g2 };
}

async function rsvpAttending(occasionId: string, householdId: string, guestIds: string[]) {
  const response = await prisma.rsvpResponse.create({
    data: {
      invitationId: (await prisma.invitation.findFirstOrThrow({ where: { householdId } })).id,
      householdId,
    },
  });
  for (const guestId of guestIds) {
    await prisma.rsvpPersonAttendance.create({
      data: { responseId: response.id, guestId, attending: true },
    });
  }
  void occasionId;
}

describe('E-01: rehearsal simulation is read-only and flags conflicts (principle 3)', () => {
  it('merges the day into one timeline, flags overlaps and tasks due inside blocks, persists nothing', async () => {
    const { owner, occasion } = await setup();
    await addProgrammeItem(occasion.id, owner.id, {
      title: 'Cununie',
      startsAt: new Date('2027-06-15T15:00:00Z'),
      durationMin: 60,
    });
    await addProgrammeItem(occasion.id, owner.id, {
      title: 'Masa (overlap)',
      startsAt: new Date('2027-06-15T15:30:00Z'),
      durationMin: 90,
    });
    const task = await createTask(occasion.id, owner.id, {
      title: 'Aranjare masini',
      dueAt: new Date('2027-06-15T15:45:00Z'), // inside both programme blocks
    });
    const auditsBefore = await prisma.auditLog.count();
    const sim = await simulateDay(occasion.id, owner.id);
    expect(sim.steps.length).toBeGreaterThanOrEqual(3);
    expect(sim.conflicts.some((c) => c.type === 'overlap')).toBe(true);
    expect(
      sim.conflicts.some((c) => c.type === 'task_due_during' && c.refs.includes(task.id))
    ).toBe(true);
    // read-only: nothing persisted by the simulation itself
    expect(await prisma.auditLog.count()).toBe(auditsBefore);
    expect(await prisma.checkIn.count({ where: { occasionId: occasion.id } })).toBe(0);

    // an outsider member cannot run the simulation
    const outsider = await makeAccount();
    await expect(simulateDay(occasion.id, outsider.id)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});

describe('E-02: QR check-in via audited correction (principle 4) + aggregate flow estimates (Q5)', () => {
  it('marks arrival with Correction + AuditLog, is idempotent, and aggregates flow', async () => {
    const { owner, occasion, h1, h2, g1, g2 } = await setup();
    const inv1 = await createInvitation(occasion.id, owner.id, h1.id);
    const inv2 = await createInvitation(occasion.id, owner.id, h2.id);
    await rsvpAttending(occasion.id, h1.id, [g1.id, g2.id]);
    await rsvpAttending(occasion.id, h2.id, []);

    // non-member cannot check in
    const outsider = await makeAccount();
    await expect(checkInByQr(inv1.invitation.qrId, outsider.id)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });

    const r1 = await checkInByQr(inv1.invitation.qrId, owner.id);
    expect(r1.alreadyCheckedIn).toBe(false);
    const correction = await prisma.correction.findUniqueOrThrow({
      where: { id: r1.checkIn.correctionId! },
    });
    expect(correction.field).toBe('arrival');
    expect(await prisma.auditLog.count({ where: { action: 'guest_checked_in' } })).toBe(1);

    // double scan is idempotent (Q4): same row, no second correction
    const r1again = await checkInByQr(inv1.invitation.qrId, owner.id);
    expect(r1again.alreadyCheckedIn).toBe(true);
    expect(r1again.checkIn.id).toBe(r1.checkIn.id);
    expect(await prisma.checkIn.count({ where: { occasionId: occasion.id } })).toBe(1);

    await checkInByQr(inv2.invitation.qrId, owner.id);
    const arrivals = await listArrivals(occasion.id, owner.id);
    expect(arrivals.length).toBe(2);

    const flow = await guestFlowEstimates(occasion.id, owner.id);
    expect(flow.expectedAttending).toBe(2); // only h1's two guests attending
    expect(flow.checkedIn).toBe(2);
    expect(flow.notArrived).toBe(0);
    expect(flow.buckets.length).toBeGreaterThan(0);
    expect(flow.buckets.reduce((s, b) => s + b.count, 0)).toBe(2);
  });
});

describe('E-03: offline capture reconciled once on reconnect (Q4), conflicts surfaced', () => {
  it('queues idempotently by clientKey, applies arrivals and own ticks once, surfaces conflicts', async () => {
    const { owner, occasion, h1 } = await setup();
    const member = await prisma.occasionMember.findUniqueOrThrow({
      where: { occasionId_accountId: { occasionId: occasion.id, accountId: owner.id } },
    });
    const inv = await createInvitation(occasion.id, owner.id, h1.id);
    const task = await createTask(occasion.id, owner.id, {
      title: 'Confirmare meniu',
      checkItems: ['Trimis meniul'],
    });
    await prisma.task.update({ where: { id: task.id }, data: { ownerMemberId: member.id } });
    const checkItem = await prisma.taskCheckItem.findUniqueOrThrow({
      where: {
        id: (await prisma.taskCheckItem.findFirstOrThrow({ where: { taskId: task.id } })).id,
      },
    });

    // queue an arrival + a tick; replaying the same clientKey is idempotent (Q4)
    const q1 = await queueOfflineItem(occasion.id, owner.id, {
      clientKey: 'dev1-arrival-1',
      kind: 'arrival',
      payload: { qrId: inv.invitation.qrId },
    });
    const q1again = await queueOfflineItem(occasion.id, owner.id, {
      clientKey: 'dev1-arrival-1',
      kind: 'arrival',
      payload: { qrId: inv.invitation.qrId },
    });
    expect(q1again.id).toBe(q1.id);
    expect(await prisma.offlineSyncItem.count({ where: { occasionId: occasion.id } })).toBe(1);

    const q2 = await queueOfflineItem(occasion.id, owner.id, {
      clientKey: 'dev1-tick-1',
      kind: 'checklist_tick',
      payload: { checkItemId: checkItem.id, done: true },
    });
    expect(q2.state).toBe('pending');

    // another account cannot queue a tick on this task (own ticks only)
    const other = await makeAccount();
    await prisma.occasionMember.create({
      data: { occasionId: occasion.id, accountId: other.id, role: 'contributor' },
    });
    await expect(
      queueOfflineItem(occasion.id, other.id, {
        clientKey: 'dev2-tick-1',
        kind: 'checklist_tick',
        payload: { checkItemId: checkItem.id, done: true },
      })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    // reconcile once: both items applied
    const res = await reconcileOfflineQueue(occasion.id, owner.id);
    expect(res.applied.length).toBe(2);
    expect(res.conflicts).toEqual([]);
    const checkIn = await prisma.checkIn.findUniqueOrThrow({
      where: { occasionId_householdId: { occasionId: occasion.id, householdId: h1.id } },
    });
    expect(checkIn.via).toBe('offline_reconciled');
    expect(checkIn.correctionId).toBeTruthy();
    expect(
      (await prisma.taskCheckItem.findUniqueOrThrow({ where: { id: checkItem.id } })).done
    ).toBe(true);

    // second reconcile is a no-op (Q4): nothing pending
    const res2 = await reconcileOfflineQueue(occasion.id, owner.id);
    expect(res2.applied).toEqual([]);
    expect(await prisma.checkIn.count({ where: { occasionId: occasion.id } })).toBe(1);

    // conflict surfaced, never silently merged: tick captured offline, task changed
    // server-side afterwards -> reconcile marks conflict and does not overwrite
    const q3 = await queueOfflineItem(occasion.id, owner.id, {
      clientKey: 'dev1-tick-2',
      kind: 'checklist_tick',
      payload: { checkItemId: checkItem.id, done: false },
    });
    // simulate the capture having happened before the server-side change
    await prisma.offlineSyncItem.update({
      where: { id: q3.id },
      data: { createdAtUtc: new Date(Date.now() - 3_600_000) },
    });
    await updateTask(occasion.id, owner.id, task.id, { description: 'changed on server' });
    const res3 = await reconcileOfflineQueue(occasion.id, owner.id);
    expect(res3.applied).toEqual([]);
    expect(res3.conflicts.length).toBe(1);
    expect(res3.conflicts[0]!.reason).toBe('changed_since_capture');
    expect(
      (await prisma.taskCheckItem.findUniqueOrThrow({ where: { id: checkItem.id } })).done
    ).toBe(true); // server value kept, not silently merged
    const conflictRow = await prisma.offlineSyncItem.findUniqueOrThrow({ where: { id: q3.id } });
    expect(conflictRow.state).toBe('conflict');
    expect(conflictRow.result).toMatchObject({ reason: 'changed_since_capture' });
  });
});

describe('E-04: sustainability goals vs measured quantities; unknown stays unknown (principle 5)', () => {
  it('tracks goals against measurements and never treats unknown as fitting', async () => {
    const { owner, occasion } = await setup();
    await setSustainabilityGoal(occasion.id, owner.id, {
      metric: 'food_waste_kg',
      unit: 'kg',
      target: 10,
    });
    await setSustainabilityGoal(occasion.id, owner.id, { metric: 'transport_km', unit: 'km' }); // no target

    let list = await listSustainability(occasion.id, owner.id);
    expect(list.find((g) => g.metric === 'food_waste_kg')?.status).toBe('unknown');

    await recordMeasurement(occasion.id, owner.id, { metric: 'food_waste_kg', value: 8 });
    await recordMeasurement(occasion.id, owner.id, { metric: 'transport_km', value: null }); // unknown
    list = await listSustainability(occasion.id, owner.id);
    expect(list.find((g) => g.metric === 'food_waste_kg')?.status).toBe('on_track');
    expect(list.find((g) => g.metric === 'transport_km')?.status).toBe('unknown'); // null target + null measured

    await recordMeasurement(occasion.id, owner.id, { metric: 'food_waste_kg', value: 12 });
    list = await listSustainability(occasion.id, owner.id);
    expect(list.find((g) => g.metric === 'food_waste_kg')?.status).toBe('behind');

    await recordMeasurement(occasion.id, owner.id, { metric: 'transport_km', value: 120 });
    list = await listSustainability(occasion.id, owner.id);
    expect(list.find((g) => g.metric === 'transport_km')?.status).toBe('measured'); // measured, no target

    // recording against an unknown metric fails loudly
    await expect(
      recordMeasurement(occasion.id, owner.id, { metric: 'water_l', value: 50 })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
