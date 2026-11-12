import { describe, expect, it } from 'vitest';
import { prisma } from '@eventdesk/db';
import { AppError } from '@eventdesk/shared';
import {
  addLedgerEntry,
  approveRequest,
  createApprovalRequest,
  createCategory,
  createDelivery,
  createExpense,
  createOccasion,
  finalizeSnapshot,
  addOrderDelta,
  getMonetizationSwitch,
  listCategories,
  recordReadinessDecision,
  recordReceivedCorrection,
  requestMonetizationEnable,
  runCloseout,
  settlementView,
  setExpenseApproval,
  setExpensePayment,
  updateCategoryStates,
  applyMonetizationEnable,
} from '../src/index';

async function setup() {
  const owner = await prisma.account.create({
    data: {
      kind: 'email',
      email: `b-owner-${Math.random().toString(36).slice(2)}@example.com`,
      emailVerifiedAt: new Date(),
    },
  });
  const occasion = await createOccasion({
    ownerId: owner.id,
    title: 'Nuntă test',
    kind: 'nunta',
    dateMode: 'date',
    dateStart: new Date('2027-06-15T12:00:00Z'),
  });
  const contributor = await prisma.account.create({
    data: {
      kind: 'email',
      email: `b-contrib-${Math.random().toString(36).slice(2)}@example.com`,
      emailVerifiedAt: new Date(),
    },
  });
  const contributorMember = await prisma.occasionMember.create({
    data: {
      occasionId: occasion.id,
      accountId: contributor.id,
      role: 'contributor',
      finance: false,
    },
  });
  const ownerMember = await prisma.occasionMember.findUniqueOrThrow({
    where: { occasionId_accountId: { occasionId: occasion.id, accountId: owner.id } },
  });
  return { owner, occasion, contributor, contributorMember, ownerMember };
}

describe('B1/B2: budget states and expense independence (D2)', () => {
  it('stores five money states separately; finance-less member gets 403 server-side', async () => {
    const { owner, occasion, contributor } = await setup();
    const cat = await createCategory(occasion.id, owner.id, {
      name: 'Catering',
      estimateBani: 500_00,
    });
    await updateCategoryStates(occasion.id, owner.id, cat.id, {
      committedBani: 400_00,
      invoicedBani: 400_00,
      paidBani: 100_00,
      forecastBani: 450_00,
    });
    const reloaded = await prisma.budgetCategory.findUniqueOrThrow({ where: { id: cat.id } });
    expect([
      reloaded.estimateBani,
      reloaded.committedBani,
      reloaded.invoicedBani,
      reloaded.paidBani,
      reloaded.forecastBani,
    ]).toEqual([500_00, 400_00, 400_00, 100_00, 450_00]);
    await expect(listCategories(occasion.id, contributor.id)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('approval and payment are separate states', async () => {
    const { owner, occasion } = await setup();
    const cat = await createCategory(occasion.id, owner.id, { name: 'Flori' });
    const exp = await createExpense(occasion.id, owner.id, {
      categoryId: cat.id,
      title: 'Buchet',
      amountBani: 150_00,
    });
    expect(exp.approvalState).toBe('pending');
    expect(exp.paymentState).toBe('unpaid');
    await setExpenseApproval(occasion.id, owner.id, exp.id, 'approved');
    let re = await prisma.expense.findUniqueOrThrow({ where: { id: exp.id } });
    expect(re.approvalState).toBe('approved');
    expect(re.paymentState).toBe('unpaid'); // approving does not pay
    await setExpensePayment(occasion.id, owner.id, exp.id, true);
    re = await prisma.expense.findUniqueOrThrow({ where: { id: exp.id } });
    expect(re.paymentState).toBe('paid');
    expect(re.approvalState).toBe('approved'); // paying does not change approval
  });
});

describe('B3: ledger balances to zero; settlement view', () => {
  it('any balanced split yields zero-sum balances and a settlement', async () => {
    const { owner, occasion, ownerMember, contributorMember } = await setup();
    await addLedgerEntry(occasion.id, owner.id, {
      payerMemberId: ownerMember.id,
      amountBani: 300_00,
      splits: [
        { memberId: ownerMember.id, shareBani: 150_00 },
        { memberId: contributorMember.id, shareBani: 150_00 },
      ],
    });
    const view = await settlementView(occasion.id, owner.id);
    const balances = view.balances;
    const sum = Object.values(balances).reduce((s, cur) => s + (cur['RON'] ?? 0), 0);
    expect(sum).toBe(0); // the ledger always balances to zero
    expect(view.settlements).toHaveLength(1);
    expect(view.settlements[0]!.amountBani).toBe(150_00);
    expect(view.settlements[0]!.from).toBe(contributorMember.id);
    expect(view.settlements[0]!.to).toBe(ownerMember.id);
    // unbalanced splits are rejected
    await expect(
      addLedgerEntry(occasion.id, owner.id, {
        payerMemberId: ownerMember.id,
        amountBani: 100_00,
        splits: [{ memberId: ownerMember.id, shareBani: 50_00 }],
      })
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
});

describe('B6/principle 4: received quantities change only via Correction (DB-enforced)', () => {
  it('direct UPDATE of receivedQty is rejected by the trigger; correction flow works and audits', async () => {
    const { owner, occasion } = await setup();
    const d = await createDelivery(occasion.id, owner.id, {
      title: 'Sticle apă',
      kind: 'delivery',
      expectedQty: 10,
      unitLabel: 'buc',
    });
    // direct overwrite impossible at DB level
    await expect(
      prisma.$executeRaw`UPDATE "Delivery" SET "receivedQty" = 5 WHERE id = ${d.id}`
    ).rejects.toThrow();
    await expect(
      prisma.delivery.update({ where: { id: d.id }, data: { receivedQty: 5 } })
    ).rejects.toThrow();
    // correction flow
    const corrected = await recordReceivedCorrection(
      occasion.id,
      owner.id,
      d.id,
      5,
      '5 sticle primite la recepție'
    );
    expect(corrected.receivedQty).toBe(5);
    const corr = await prisma.correction.findFirstOrThrow({ where: { targetId: d.id } });
    expect((corr.before as { receivedQty: number }).receivedQty).toBe(0);
    expect((corr.after as { receivedQty: number }).receivedQty).toBe(5);
    const auditRow = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'correction_applied', objectId: d.id },
    });
    expect(auditRow.actorId).toBe(owner.id);
    // out-of-range correction rejected
    await expect(
      recordReceivedCorrection(occasion.id, owner.id, d.id, 99, 'x')
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
});

describe('B5: snapshots immutable; later changes are deltas', () => {
  it('finalized snapshot cannot be edited; delta rows link to it', async () => {
    const { owner, occasion } = await setup();
    const supplier = await prisma.supplier.create({
      data: { occasionId: occasion.id, name: 'Catering SRL', createdById: owner.id },
    });
    const booking = await prisma.booking.create({
      data: {
        supplierId: supplier.id,
        occasionId: occasion.id,
        title: 'Meniu',
        createdById: owner.id,
      },
    });
    const snap = await finalizeSnapshot(occasion.id, owner.id, booking.id, [
      { title: 'meniu', qty: 80 },
    ]);
    await addOrderDelta(
      booking.id,
      { title: 'meniu', qty: 82, reason: '2 invitați în plus' },
      'rsvp_change'
    );
    const snapReloaded = await prisma.orderSnapshot.findUniqueOrThrow({ where: { id: snap.id } });
    expect(snapReloaded.items).toEqual([{ title: 'meniu', qty: 80 }]); // immutable
    const deltas = await prisma.orderDelta.findMany({ where: { snapshotId: snap.id } });
    expect(deltas).toHaveLength(1);
    expect(deltas[0]!.source).toBe('rsvp_change');
  });
});

describe('B8: readiness decisions require evidence', () => {
  it('rejects a decision without evidence; records with actor and time', async () => {
    const { owner, occasion } = await setup();
    await expect(
      recordReadinessDecision(occasion.id, owner.id, { decision: 'proceed', evidence: [] })
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    const d = await recordReadinessDecision(occasion.id, owner.id, {
      decision: 'proceed_with_conditions',
      evidence: ['contract semnat.pdf', 'asigurare valabilă'],
    });
    expect(d.decision).toBe('proceed_with_conditions');
    expect(d.actorId).toBe(owner.id);
  });
});

describe('B10: closeout', () => {
  it('produces the unpaid/returns list and closes the occasion', async () => {
    const { owner, occasion } = await setup();
    await createDelivery(occasion.id, owner.id, {
      title: 'Scaune',
      kind: 'return',
      expectedQty: 50,
    });
    const c = await runCloseout(occasion.id, owner.id, 'Data viitoare: rezervați mai devreme');
    expect(c.lessons).toContain('rezervați');
    const occ = await prisma.occasion.findUniqueOrThrow({ where: { id: occasion.id } });
    expect(occ.status).toBe('closed');
  });
});

describe('W6/MON2 + W9: monetization switch needs a second person', () => {
  it('stays OFF; enabling queues until approved by a different staff member', async () => {
    const { owner } = await setup();
    // deterministic single-operator mode regardless of other suites' staff rows
    await prisma.staffMember.deleteMany({});
    await prisma.totpSecret.deleteMany({});
    // make owner a staff member with confirmed TOTP
    await prisma.staffMember.create({ data: { accountId: owner.id, roles: ['platform_admin'] } });
    await prisma.totpSecret.create({
      data: { accountId: owner.id, secret: 'JBSWY3DPEHPK3PXP', confirmedAt: new Date() },
    });

    const before = await getMonetizationSwitch();
    expect(before.state).toBe('OFF');

    const req = await requestMonetizationEnable(owner.id);
    expect(req.queued).toBe(true); // single-operator mode: queued, no effect
    expect((await getMonetizationSwitch()).state).toBe('OFF');

    // requester cannot approve their own action
    await expect(approveRequest(req.id, owner.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });

    // second staff member approves
    const second = await prisma.account.create({
      data: {
        kind: 'email',
        email: `staff2-${Math.random().toString(36).slice(2)}@example.com`,
        emailVerifiedAt: new Date(),
      },
    });
    await prisma.staffMember.create({ data: { accountId: second.id, roles: ['platform_admin'] } });
    await applyMonetizationEnable(req.id, second.id);
    expect((await getMonetizationSwitch()).state).toBe('ON');
  });
});
