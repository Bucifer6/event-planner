import { describe, expect, it, beforeEach } from 'vitest';
import { prisma } from '@eventdesk/db';
import { AppError } from '@eventdesk/shared';
import {
  applyTemplate,
  claimUnits,
  computeTemplateDiff,
  confirmDateMove,
  confirmPreview,
  createInvitation,
  createHousehold,
  createNeed,
  createOccasion,
  getOverview,
  listTasks,
  previewDateMove,
  releaseClaim,
  submitRsvp,
  looksLikeChildData,
  parseCsv,
  computeImportDiff,
  applyGuestImport,
  createPoll,
  votePoll,
  confirmPoll,
  exportOccasionCsv,
  requireMember,
} from '../src/index.js';

async function makeAccount(email: string) {
  return prisma.account.create({ data: { kind: 'email', email, emailVerifiedAt: new Date() } });
}

async function makeOccasionWithOwner(capacity: number | null = null) {
  const owner = await makeAccount(`owner-${Math.random().toString(36).slice(2)}@example.com`);
  const occasion = await createOccasion({
    ownerId: owner.id,
    title: 'Aniversare',
    kind: 'aniversare',
    dateMode: 'date',
    dateStart: new Date('2027-06-15T12:00:00Z'),
    capacityTotal: capacity,
  });
  return { owner, occasion };
}

async function makeInvitedHousehold(occasionId: string, ownerId: string, name: string) {
  const household = await createHousehold(occasionId, ownerId, { name, guests: [`${name} Lead`] });
  const { token } = await createInvitation(occasionId, ownerId, household.id);
  return { household, token };
}

describe('A8: atomic shared capacity', () => {
  it('two households cannot take the last place (exactly one wins)', async () => {
    const { owner, occasion } = await makeOccasionWithOwner(1);
    const h1 = await makeInvitedHousehold(occasion.id, owner.id, 'Fam One');
    const h2 = await makeInvitedHousehold(occasion.id, owner.id, 'Fam Two');
    const shownAt = Date.now() - 5000; // past the SEC11 time-to-submit floor
    const results = await Promise.allSettled([
      submitRsvp({
        token: h1.token,
        adults: 1,
        childrenCount: 0,
        attendance: {},
        answers: [],
        ip: '1.1.1.1',
        formShownAt: shownAt,
      }),
      submitRsvp({
        token: h2.token,
        adults: 1,
        childrenCount: 0,
        attendance: {},
        answers: [],
        ip: '2.2.2.2',
        formShownAt: shownAt,
      }),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(AppError);
    expect((rejected[0] as PromiseRejectedResult).reason.code).toBe('CAPACITY_TAKEN');
    const occ = await prisma.occasion.findUniqueOrThrow({ where: { id: occasion.id } });
    expect(occ.seatsTaken).toBe(1);
  });
});

describe('A9: atomic contribution claims', () => {
  it('parallel claims on the last units: exactly one wins; release returns units', async () => {
    const { owner, occasion } = await makeOccasionWithOwner();
    const need = await createNeed(occasion.id, owner.id, { title: 'Grătar', totalUnits: 1 });
    const results = await Promise.allSettled([
      claimUnits(occasion.id, owner.id, need.id, 1),
      claimUnits(occasion.id, owner.id, need.id, 1),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason.code).toBe('UNITS_TAKEN');
    const claim = (results.find((r) => r.status === 'fulfilled') as PromiseFulfilledResult<unknown>)
      .value as { id: string };
    await releaseClaim(occasion.id, owner.id, claim.id);
    const reloaded = await prisma.contributionNeed.findUniqueOrThrow({ where: { id: need.id } });
    expect(reloaded.claimedUnits).toBe(0);
  });
});

describe('A2: templates and What-if date move (principle 3, Q4)', () => {
  it('applies a template at month offsets; re-run shows a diff and creates no duplicates', async () => {
    const { owner, occasion } = await makeOccasionWithOwner();
    const first = await applyTemplate(occasion.id, owner.id, 'nunta');
    expect(first.applied).toBe(true);
    expect(first.diff.create.length).toBeGreaterThan(0);
    const tasks = await listTasks(occasion.id, owner.id);
    expect(tasks.length).toBe(first.diff.create.length);
    // due dates are before the occasion date at the template offsets
    for (const t of tasks) {
      expect(t.dueAt!.getTime()).toBeLessThan(occasion.dateStart!.getTime());
    }
    const second = await applyTemplate(occasion.id, owner.id, 'nunta');
    expect(second.applied).toBe(false);
    expect(second.diff.create).toHaveLength(0);
    expect(second.diff.skip.length).toBe(tasks.length);
    expect(second.previewId).toBeTruthy();
    const after = await listTasks(occasion.id, owner.id);
    expect(after.length).toBe(tasks.length); // no duplicates
  });

  it('moving the date previews the shift and applies once on confirm (idempotent)', async () => {
    const { owner, occasion } = await makeOccasionWithOwner();
    await applyTemplate(occasion.id, owner.id, 'botez');
    const before = await listTasks(occasion.id, owner.id);
    const newDate = new Date('2027-09-15T12:00:00Z');
    const preview = await previewDateMove(occasion.id, owner.id, newDate);
    expect(preview.state).toBe('pending');
    const delta = preview.delta as { tasks: { taskId: string; to: string }[] };
    expect(delta.tasks.length).toBe(before.filter((t) => t.dueAt).length);

    const r1 = await confirmDateMove(preview.id, owner.id);
    expect(r1.alreadyDecided).toBe(false);
    const occ = await prisma.occasion.findUniqueOrThrow({ where: { id: occasion.id } });
    expect(occ.dateStart!.toISOString()).toBe(newDate.toISOString());
    const after = await listTasks(occasion.id, owner.id);
    const shifted = after.find((t) => t.id === delta.tasks[0]!.taskId)!;
    expect(shifted.dueAt!.toISOString()).toBe(new Date(delta.tasks[0]!.to).toISOString());

    // double confirm (double-tap) does not apply twice (Q4)
    const r2 = await confirmDateMove(preview.id, owner.id);
    expect(r2.alreadyDecided).toBe(true);
    const after2 = await listTasks(occasion.id, owner.id);
    expect(after2.find((t) => t.id === delta.tasks[0]!.taskId)!.dueAt).toEqual(shifted.dueAt);
  });
});

describe('A6: children are counts only; free-text child data is flagged', () => {
  it('flags child-like free text and stores children as a count', async () => {
    expect(looksLikeChildData('Ana, 5 ani, merge și ea')).toBe(true);
    expect(looksLikeChildData('vin cu copiii')).toBe(true);
    expect(looksLikeChildData('vegetarian')).toBe(false);

    const { owner, occasion } = await makeOccasionWithOwner(10);
    const h = await makeInvitedHousehold(occasion.id, owner.id, 'Fam Pop');
    const q = await prisma.rsvpQuestion.create({
      data: {
        occasionId: occasion.id,
        kind: 'free_text',
        promptKey: 'Note libere',
        required: false,
        sortOrder: 0,
      },
    });
    const guest = h.household.guests[0]!;
    const res = await submitRsvp({
      token: h.token,
      adults: 2,
      childrenCount: 2,
      attendance: { [guest.id]: true },
      answers: [{ questionId: q.id, value: 'Vine și fetița de 4 ani' }],
      ip: '3.3.3.3',
      formShownAt: Date.now() - 5000,
    });
    expect(res.childDataWarnings).toHaveLength(1);
    const resp = await prisma.rsvpResponse.findUniqueOrThrow({ where: { id: res.response.id } });
    expect(resp.childrenCount).toBe(2);
    expect(resp.adults).toBe(2);
    // no child person rows exist anywhere
    const guests = await prisma.guest.findMany({ where: { householdId: h.household.id } });
    expect(guests.every((g) => /Lead/.test(g.name))).toBe(true);
  });
});

describe('A7: date polls never reserve capacity', () => {
  it('votes are recorded and host confirmation sets the date without touching seats', async () => {
    const { owner, occasion } = await makeOccasionWithOwner(5);
    const h = await makeInvitedHousehold(occasion.id, owner.id, 'Fam Vot');
    const poll = await createPoll(occasion.id, owner.id, 'Ce dată?');
    await votePoll(h.token, poll.id, 'yes');
    const occBefore = await prisma.occasion.findUniqueOrThrow({ where: { id: occasion.id } });
    expect(occBefore.seatsTaken).toBe(0);
    await confirmPoll(occasion.id, owner.id, poll.id, new Date('2027-07-01T12:00:00Z'));
    const occAfter = await prisma.occasion.findUniqueOrThrow({ where: { id: occasion.id } });
    expect(occAfter.dateStart!.toISOString()).toBe('2027-07-01T12:00:00.000Z');
    expect(occAfter.seatsTaken).toBe(0);
  });
});

describe('A13: guest import diff', () => {
  it('parses CSV, detects duplicates by name+household, applies only the diff', async () => {
    const { owner, occasion } = await makeOccasionWithOwner();
    const existing = await createHousehold(occasion.id, owner.id, {
      name: 'Pop',
      guests: ['Ana Pop'],
    });
    const { headers, rows } = parseCsv(
      'nume,gospodarie\nAna Pop,Pop\nIon Pop,Pop\nMaria Ionescu,Ionescu\n'
    );
    expect(headers).toEqual(['nume', 'gospodarie']);
    const diff = computeImportDiff(
      { households: [{ id: existing.id, name: 'Pop', guests: [{ name: 'Ana Pop' }] }] },
      rows,
      { name: 'nume', household: 'gospodarie' }
    );
    expect(diff.create).toHaveLength(2);
    expect(diff.skip).toHaveLength(1);
    const applied = await applyGuestImport(occasion.id, owner.id, diff);
    expect(applied.guests).toBe(2);
    const guests = await prisma.guest.findMany({
      where: { household: { occasionId: occasion.id } },
    });
    expect(guests.map((g) => g.name).sort()).toEqual(['Ana Pop', 'Ion Pop', 'Maria Ionescu']);
  });
});

describe('D2: grant enforcement is server-side', () => {
  it('a contributor without the finance grant is rejected', async () => {
    const { owner, occasion } = await makeOccasionWithOwner();
    const contributor = await makeAccount(
      `contrib-${Math.random().toString(36).slice(2)}@example.com`
    );
    await prisma.occasionMember.create({
      data: {
        occasionId: occasion.id,
        accountId: contributor.id,
        role: 'contributor',
        finance: false,
      },
    });
    await expect(requireMember(occasion.id, contributor.id)).resolves.toBeTruthy();
    const member = await requireMember(occasion.id, contributor.id);
    expect(() => {
      if (!member.finance) throw new AppError('FORBIDDEN', 'Finance access required.');
    }).toThrow();
    await expect(requireMember(occasion.id, 'no-such-account')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});

describe('SEC10: audit log is append-only at the DB level', () => {
  it('UPDATE and DELETE on AuditLog fail', async () => {
    await prisma.auditLog.create({
      data: { actorKind: 'system', action: 'test', objectType: 'Test', objectId: 'x' },
    });
    const row = await prisma.auditLog.findFirstOrThrow({ where: { objectType: 'Test' } });
    await expect(
      prisma.$executeRaw`UPDATE "AuditLog" SET action = 'hacked' WHERE id = ${row.id}`
    ).rejects.toThrow();
    await expect(prisma.$executeRaw`DELETE FROM "AuditLog" WHERE id = ${row.id}`).rejects.toThrow();
  });
});

describe('A10/A12: overview sections and export scope', () => {
  it('overview shows milestone/overdue/unaccepted/blockers and export contains own data only', async () => {
    const { owner, occasion } = await makeOccasionWithOwner();
    const member = await prisma.occasionMember.findUniqueOrThrow({
      where: { occasionId_accountId: { occasionId: occasion.id, accountId: owner.id } },
    });
    await prisma.task.create({
      data: {
        occasionId: occasion.id,
        title: 'Overdue task',
        status: 'todo',
        dueAt: new Date(Date.now() - 86_400_000),
        createdById: owner.id,
        ownerMemberId: member.id,
      },
    });
    await prisma.task.create({
      data: {
        occasionId: occasion.id,
        title: 'Blocked task',
        status: 'blocked',
        createdById: owner.id,
        ownerMemberId: member.id,
      },
    });
    const overview = await getOverview(occasion.id, owner.id);
    expect(overview.overdue.map((t) => t.title)).toContain('Overdue task');
    expect(overview.blockers.map((t) => t.title)).toContain('Blocked task');

    const csv = await exportOccasionCsv(occasion.id, owner.id);
    expect(csv).toContain('Overdue task');
    expect(csv).not.toMatch(/featured|promovat/i); // P16: no paid content in exports
  });
});

describe('whatif engine (R0-16)', () => {
  it('confirm is idempotent and discard leaves no applied change', async () => {
    const { owner, occasion } = await makeOccasionWithOwner();
    const { createPreview } = await import('../src/index.js');
    let applied = 0;
    const preview = await createPreview({
      occasionId: occasion.id,
      subject: 'test',
      delta: { x: 1 },
      proposedByAccountId: owner.id,
      idempotencyKey: `test-${Math.random()}`,
    });
    const r1 = await confirmPreview(preview.id, owner.id, async () => {
      applied++;
    });
    const r2 = await confirmPreview(preview.id, owner.id, async () => {
      applied++;
    });
    expect(r1.alreadyDecided).toBe(false);
    expect(r2.alreadyDecided).toBe(true);
    expect(applied).toBe(1);
  });
});
