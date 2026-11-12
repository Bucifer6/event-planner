import { describe, expect, it } from 'vitest';
import { prisma } from '@eventdesk/db';
import { formatInZone } from '@eventdesk/shared';
import {
  addItineraryLeg,
  addLedgerEntry,
  addPackingItem,
  addTransportLeg,
  assignRoom,
  confirmItineraryImport,
  createOccasion,
  createRoom,
  createSubgroup,
  addActivity,
  listItinerary,
  listSubgroupView,
  proposeItineraryImport,
  settlementByCurrency,
  togglePacking,
} from '../src/index';

async function makeAccount(email?: string) {
  return prisma.account.create({
    data: {
      kind: 'email',
      email: email ?? `d-${Math.random().toString(36).slice(2)}@example.com`,
      emailVerifiedAt: new Date(),
    },
  });
}

async function setup() {
  const owner = await makeAccount();
  const occasion = await createOccasion({
    ownerId: owner.id,
    title: 'Voiaj Japonia',
    kind: 'voiaj_grup',
    dateMode: 'range',
    dateStart: new Date('2027-04-01T00:00:00Z'),
    dateEnd: new Date('2027-04-10T00:00:00Z'),
  });
  const h1 = await prisma.household.create({
    data: { occasionId: occasion.id, name: 'Familia Pop', leadEmail: 'pop@example.com' },
  });
  const h2 = await prisma.household.create({
    data: { occasionId: occasion.id, name: 'Familia Ionescu' },
  });
  return { owner, occasion, h1, h2 };
}

describe('D-01: itinerary across time zones (UTC storage, INF8) + What-if booking import', () => {
  it('stores UTC, displays in Bucharest and the trip zone correctly across DST', async () => {
    const { owner, occasion } = await setup();
    // 2027-03-28T23:30Z is the EU DST switch; Tokyo is UTC+9 year-round
    const leg = await addItineraryLeg(occasion.id, owner.id, {
      title: 'Zbor OTP-TYO',
      kind: 'flight',
      startsAtUtc: new Date('2027-03-28T23:30:00Z'),
      zone: 'Asia/Tokyo',
    });
    expect(leg.startsAtUtc.toISOString()).toBe('2027-03-28T23:30:00.000Z'); // stored UTC
    expect(formatInZone(leg.startsAtUtc, 'Asia/Tokyo', 'en')).toContain('08:30'); // +9h next day
    expect(formatInZone(leg.startsAtUtc, 'Europe/Bucharest', 'en')).toContain('02:30'); // +3h (CEST, post-switch)

    // booking import: preview only, nothing applied until confirm
    const before = await prisma.itineraryLeg.count({ where: { occasionId: occasion.id } });
    const preview = await proposeItineraryImport(occasion.id, owner.id, [
      {
        title: 'Hotel Shibuya',
        kind: 'stay',
        startsAtUtc: '2027-03-29T06:00:00Z',
        zone: 'Asia/Tokyo',
      },
    ]);
    expect(await prisma.itineraryLeg.count({ where: { occasionId: occasion.id } })).toBe(before);
    expect(preview.state).toBe('pending');
    await confirmItineraryImport(preview.id, owner.id);
    const legs = await listItinerary(occasion.id, owner.id);
    expect(legs.length).toBe(before + 1);
    expect(legs.find((l) => l.title === 'Hotel Shibuya')?.zone).toBe('Asia/Tokyo');
  });
});

describe('D-02: subgroups with grant-respecting scoped views + optional activities', () => {
  it('only members (or managers) see a subgroup view (D2)', async () => {
    const { owner, occasion, h1, h2 } = await setup();
    const sg = await createSubgroup(occasion.id, owner.id, 'Familia', [h1.id]);
    await addActivity(occasion.id, owner.id, {
      title: 'Vizită templu',
      startsAtUtc: new Date('2027-04-02T01:00:00Z'),
      subgroupId: sg.id,
    });

    const outsider = await makeAccount('outsider@example.com');
    await prisma.occasionMember.create({
      data: {
        occasionId: occasion.id,
        accountId: outsider.id,
        role: 'contributor',
        finance: false,
      },
    });
    await expect(listSubgroupView(occasion.id, sg.id, outsider.id)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });

    const memberAccount = await makeAccount('pop@example.com'); // leadEmail of h1
    await prisma.occasionMember.create({
      data: {
        occasionId: occasion.id,
        accountId: memberAccount.id,
        role: 'contributor',
        finance: false,
      },
    });
    const view = await listSubgroupView(occasion.id, sg.id, memberAccount.id);
    expect(view.activities.length).toBe(1);
    void h2;
  });
});

describe('D-03/D-04: packing lists, transport legs, atomic room allocation', () => {
  it('packing toggles, and room assignment is atomic against capacity (A8)', async () => {
    const { owner, occasion, h1, h2 } = await setup();
    const item = await addPackingItem(occasion.id, owner.id, { label: 'Adaptoare' });
    const toggled = await togglePacking(occasion.id, owner.id, item.id, true);
    expect(toggled.packed).toBe(true);

    await addTransportLeg(occasion.id, owner.id, {
      label: 'Shinkansen',
      fromPlace: 'Tokyo',
      toPlace: 'Kyoto',
      departsAtUtc: new Date('2027-04-03T01:00:00Z'),
      seats: 4,
      zone: 'Asia/Tokyo',
    });

    const room = await createRoom(occasion.id, owner.id, 'Cameră dublă', 1);
    await assignRoom(occasion.id, owner.id, room.id, h1.id);
    // capacity 1 exhausted — second assignment refused atomically
    await expect(assignRoom(occasion.id, owner.id, room.id, h2.id)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    const reloaded = await prisma.room.findUniqueOrThrow({ where: { id: room.id } });
    expect(reloaded.occupants).toBe(1);
  });
});

describe('D-05: settlement per currency from the one ledger (B3)', () => {
  it('groups the single ledger by currency', async () => {
    const { owner, occasion } = await setup();
    const member = await prisma.occasionMember.findUniqueOrThrow({
      where: { occasionId_accountId: { occasionId: occasion.id, accountId: owner.id } },
    });
    await addLedgerEntry(occasion.id, owner.id, {
      payerMemberId: member.id,
      amountBani: 100_00,
      currency: 'RON',
      note: 'cazare',
      splits: [{ memberId: member.id, shareBani: 100_00 }],
    });
    await addLedgerEntry(occasion.id, owner.id, {
      payerMemberId: member.id,
      amountBani: 50_00,
      currency: 'EUR',
      note: 'bilet avion',
      splits: [{ memberId: member.id, shareBani: 50_00 }],
    });
    const res = await settlementByCurrency(occasion.id, owner.id);
    const eur = res.byCurrency.find((c) => c.currency === 'EUR');
    const ron = res.byCurrency.find((c) => c.currency === 'RON');
    expect(eur?.paidBani).toBe(50_00);
    expect(ron?.paidBani).toBe(100_00);
  });
});
