import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { prisma } from '@eventdesk/db';
import { startOfUtcDay, now } from '@eventdesk/shared';
import {
  addDrawing,
  attachSpaceModel,
  calibrateDrawing,
  claimListing,
  computeListingStats,
  confirmSpaceModelUpdate,
  createBusiness,
  createDraft,
  createEnquiry,
  answerEnquiry,
  createListing,
  createOccasion,
  getBusinessForAccount,
  decideRevision,
  approveDraft,
  getListingPublic,
  proposeDrawingUpdate,
  searchDirectory,
  submitListingRevision,
  verifyClaimCode,
  type StaffRole,
} from '../src/index';

async function makeAccount(withEmail = true) {
  if (withEmail) {
    return prisma.account.create({
      data: {
        kind: 'email',
        email: `p-${Math.random().toString(36).slice(2)}@example.com`,
        emailVerifiedAt: new Date(),
      },
    });
  }
  return prisma.account.create({
    data: {
      kind: 'anonymous',
      username: `anon-${Math.random().toString(36).slice(2)}`,
      passwordHash: 'x',
    },
  });
}

async function makeStaff(accountId: string, roles: StaffRole[]) {
  await prisma.staffMember.create({ data: { accountId, roles } });
  await prisma.totpSecret.create({
    data: { accountId, secret: 'JBSWY3DPEHPK3PXP', confirmedAt: new Date() },
  });
}

async function picklists() {
  const category = await prisma.category.findUniqueOrThrow({ where: { slug: 'floristi' } });
  const county = await prisma.county.findUniqueOrThrow({ where: { code: 'B' } });
  const locality = await prisma.locality.findFirstOrThrow({ where: { countyId: county.id } });
  const otherCounty = await prisma.county.findUniqueOrThrow({ where: { code: 'CJ' } });
  const otherLocality = await prisma.locality.findFirstOrThrow({
    where: { countyId: otherCounty.id },
  });
  const cats = await prisma.category.findMany({ take: 6 });
  return { category, county, locality, otherLocality, cats };
}

async function makeLiveListing(ownerId: string, name: string, moderatorId: string) {
  const business =
    (await getBusinessForAccount(ownerId)) ??
    (await createBusiness(ownerId, { name: `${name} SRL` }));
  const { category, county, locality } = await picklists();
  const listing = await createListing(business.id, ownerId, {
    name,
    categoryIds: [category.id],
    countyIds: [county.id],
    localityIds: [locality.id],
  });
  const revision = await prisma.listingRevision.findFirstOrThrow({
    where: { listingId: listing.id, state: 'pending' },
  });
  await decideRevision(revision.id, moderatorId, 'approved');
  return {
    business,
    listing: await prisma.listing.findUniqueOrThrow({ where: { id: listing.id } }),
  };
}

describe('P1: business account + fixed picklists', () => {
  it('requires an email account and validates category/county/locality picklists', async () => {
    const anon = await makeAccount(false);
    await expect(createBusiness(anon.id, { name: 'Anon' })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });

    const owner = await makeAccount();
    const business = await createBusiness(owner.id, { name: '  Gradina Viselor  ' });
    expect(business.name).toBe('Gradina Viselor');
    await expect(createBusiness(owner.id, { name: 'Al doilea' })).rejects.toMatchObject({
      code: 'CONFLICT',
    });

    const { category, county, locality, otherLocality, cats } = await picklists();
    await expect(
      createListing(business.id, owner.id, {
        name: 'X',
        categoryIds: [],
        countyIds: [county.id],
        localityIds: [locality.id],
      })
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(
      createListing(business.id, owner.id, {
        name: 'X',
        categoryIds: cats.map((c) => c.id),
        countyIds: [county.id],
        localityIds: [locality.id],
      })
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(
      createListing(business.id, owner.id, {
        name: 'X',
        categoryIds: ['nope'],
        countyIds: [county.id],
        localityIds: [locality.id],
      })
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(
      createListing(business.id, owner.id, {
        name: 'X',
        categoryIds: [category.id],
        countyIds: [county.id],
        localityIds: [otherLocality.id],
      })
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });

    const listing = await createListing(business.id, owner.id, {
      name: 'Sala principala',
      categoryIds: [category.id],
      countyIds: [county.id],
      localityIds: [locality.id],
    });
    expect(listing.status).toBe('pending'); // P3: nothing live without moderation
    expect(listing.claimed).toBe(true);
  });

  it('caps listings at five per business (P1)', async () => {
    const owner = await makeAccount();
    const business = await createBusiness(owner.id, { name: 'Cinci SRL' });
    const { category, county, locality } = await picklists();
    for (let i = 0; i < 5; i++) {
      await createListing(business.id, owner.id, {
        name: `Sala ${i}`,
        categoryIds: [category.id],
        countyIds: [county.id],
        localityIds: [locality.id],
      });
    }
    await expect(
      createListing(business.id, owner.id, {
        name: 'Sala 6',
        categoryIds: [category.id],
        countyIds: [county.id],
        localityIds: [locality.id],
      })
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
});

describe('P3/W2: moderation queue, second-person, live-stays-up', () => {
  it('keeps the live version up until an independent moderator approves', async () => {
    const owner = await makeAccount();
    const memberStaff = await makeAccount();
    const moderator = await makeAccount();
    await makeStaff(moderator.id, ['listing_moderator']);

    const business = await createBusiness(owner.id, { name: 'Moderata SRL' });
    await prisma.businessMember.create({
      data: { businessId: business.id, accountId: memberStaff.id, role: 'staff' },
    });
    await makeStaff(memberStaff.id, ['listing_moderator']);

    const { category, county, locality } = await picklists();
    const listing = await createListing(business.id, owner.id, {
      name: 'Nume vechi',
      categoryIds: [category.id],
      countyIds: [county.id],
      localityIds: [locality.id],
    });
    const rev = await prisma.listingRevision.findFirstOrThrow({
      where: { listingId: listing.id, state: 'pending' },
    });

    // a business member cannot moderate their own business (P3)
    await expect(decideRevision(rev.id, memberStaff.id, 'approved')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });

    await decideRevision(rev.id, moderator.id, 'approved');
    let live = await prisma.listing.findUniqueOrThrow({ where: { id: listing.id } });
    expect(live.status).toBe('live');
    expect(live.name).toBe('Nume vechi');

    // edit a live listing: revision pending, live row unchanged (live-stays-up)
    await submitListingRevision(listing.id, owner.id, {
      name: 'Nume nou',
      categoryIds: [category.id],
      countyIds: [county.id],
      localityIds: [locality.id],
    });
    live = await prisma.listing.findUniqueOrThrow({ where: { id: listing.id } });
    expect(live.name).toBe('Nume vechi');
    const rev2 = await prisma.listingRevision.findFirstOrThrow({
      where: { listingId: listing.id, state: 'pending' },
      orderBy: { createdAt: 'desc' },
    });
    await decideRevision(rev2.id, moderator.id, 'approved');
    live = await prisma.listing.findUniqueOrThrow({ where: { id: listing.id } });
    expect(live.name).toBe('Nume nou');

    // already-decided revisions are immutable
    await expect(decideRevision(rev2.id, moderator.id, 'rejected')).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });
});

describe('BD/P29/P30: discovery draft, unclaimed listing, claim via emailed code', () => {
  it('approves to a live unclaimed listing that rejects enquiries until claimed with the emailed code', async () => {
    const moderator = await makeAccount();
    await makeStaff(moderator.id, ['listing_moderator']);
    const source = await prisma.discoverySource.create({
      data: { name: `src-${Math.random().toString(36).slice(2)}`, kind: 'website' },
    });
    const draft = await createDraft({
      sourceId: source.id,
      name: `Venue Descoperit ${Math.random().toString(36).slice(2)}`,
      categoryGuess: 'sali-evenimente',
      countyCode: 'B',
      publicContactRoute: 'contact@venue-descoperit.example',
      sourceUrl: 'https://venue-descoperit.example',
    });
    expect(draft.state).toBe('pending');

    await approveDraft(draft.id, moderator.id);
    const decided = await prisma.discoveryDraft.findUniqueOrThrow({ where: { id: draft.id } });
    expect(decided.state).toBe('approved');
    const listing = await prisma.listing.findUniqueOrThrow({ where: { id: decided.listingId! } });
    expect(listing.status).toBe('live');
    expect(listing.claimed).toBe(false);

    // P29: unclaimed listing carries no platform-mediated contact
    const planner = await makeAccount();
    await expect(
      createEnquiry(planner.id, {
        listingId: listing.id,
        occasionKind: 'nunta',
        message: 'Buna ziua',
      })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    // BD5: exactly one claim invitation, emailed to the published address with a code
    const mail = await prisma.emailOutbox.findFirstOrThrow({
      where: { template: 'claim-invitation', to: 'contact@venue-descoperit.example' },
    });
    const code = mail.bodyText.match(/code: (\d{6})/)?.[1];
    expect(code).toBeTruthy();
    expect(await verifyClaimCode(listing.id, '000000')).toBe(code === '000000');
    expect(await verifyClaimCode(listing.id, code!)).toBe(true);

    const claimant = await makeAccount();
    await expect(claimListing(listing.id, claimant.id, '999999')).rejects.toMatchObject({
      code: 'INVALID_CODE',
    });
    await claimListing(listing.id, claimant.id, code!);
    const claimed = await prisma.listing.findUniqueOrThrow({ where: { id: listing.id } });
    expect(claimed.claimed).toBe(true);
    expect(claimed.businessId).toBeTruthy();

    // after claiming, enquiries are accepted (P29 lifted)
    const e = await createEnquiry(planner.id, {
      listingId: listing.id,
      occasionKind: 'nunta',
      message: 'Aveti disponibil?',
    });
    expect(e.state).toBe('sent');
  });

  it('queues suspected duplicates for humans instead of auto-merging (BD3)', async () => {
    const source = await prisma.discoverySource.create({
      data: { name: `src-dup-${Math.random().toString(36).slice(2)}`, kind: 'onrc' },
    });
    const name = `Dublura ${Math.random().toString(36).slice(2)}`;
    const d1 = await createDraft({ sourceId: source.id, name, sourceUrl: 'https://a.example' });
    const d2 = await createDraft({ sourceId: source.id, name, sourceUrl: 'https://b.example' });
    expect(d1.state).toBe('pending');
    expect(d2.state).toBe('duplicate_queued');
  });
});

describe('P11: enquiry limits are enforced server-side', () => {
  it('refuses the 11th enquiry per occasion', async () => {
    const owner = await makeAccount();
    const moderator = await makeAccount();
    await makeStaff(moderator.id, ['listing_moderator']);
    const { listing } = await makeLiveListing(
      owner.id,
      `Limita ${Math.random().toString(36).slice(2)}`,
      moderator.id
    );

    const planner = await makeAccount();
    const occasion = await createOccasion({
      ownerId: planner.id,
      title: 'Nunta limita',
      kind: 'nunta',
      dateMode: 'date',
      dateStart: new Date('2027-07-04T12:00:00Z'),
    });
    for (let i = 0; i < 10; i++) {
      await createEnquiry(planner.id, {
        occasionId: occasion.id,
        listingId: listing.id,
        occasionKind: 'nunta',
        message: `Cerere ${i}`,
      });
    }
    await expect(
      createEnquiry(planner.id, {
        occasionId: occasion.id,
        listingId: listing.id,
        occasionKind: 'nunta',
        message: '11',
      })
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    // P10: each enquiry created/linked a supplier + booking in the plan
    const bookings = await prisma.booking.count({ where: { occasionId: occasion.id } });
    expect(bookings).toBe(10);
  });
});

describe('P5/P6/MON5: organic directory order is daily-rotating and payment-independent', () => {
  it('orders by sha256(day|listing|category|county), unaffected by subscriptions; Featured excluded while MON ON', async () => {
    const owner = await makeAccount();
    const moderator = await makeAccount();
    await makeStaff(moderator.id, ['listing_moderator']);
    const nameA = `Organic A ${Math.random().toString(36).slice(2)}`;
    const nameB = `Organic B ${Math.random().toString(36).slice(2)}`;
    const a = await makeLiveListing(owner.id, nameA, moderator.id);
    const b = await makeLiveListing(owner.id, nameB, moderator.id);

    // a paid subscription must not change organic order (payment-independence)
    await prisma.subscription.create({
      data: { businessId: a.business.id, kind: 'featured', state: 'active', priceBani: 0 },
    });

    const day = startOfUtcDay(now()).toISOString().slice(0, 10);
    const rank = (id: string) =>
      createHash('sha256').update(`${day}|${id}|floristi|B`).digest('hex');
    const expected = [a.listing.id, b.listing.id].sort((x, y) => rank(x).localeCompare(rank(y)));

    const res1 = await searchDirectory({ categorySlug: 'floristi', countyCode: 'B' });
    const res2 = await searchDirectory({ categorySlug: 'floristi', countyCode: 'B' });
    const got1 = res1
      .filter((r) => [a.listing.id, b.listing.id].includes(r.listing.id))
      .map((r) => r.listing.id);
    const got2 = res2
      .filter((r) => [a.listing.id, b.listing.id].includes(r.listing.id))
      .map((r) => r.listing.id);
    expect(got1).toEqual(expected); // deterministic within the day
    expect(got2).toEqual(got1); // stable across calls

    // MON5: with the switch ON, an active Featured slot renders above, never in organic order
    const prevMon = (await prisma.monetizationSwitch.findUniqueOrThrow({ where: { id: 'main' } }))
      .state;
    await prisma.monetizationSwitch.update({ where: { id: 'main' }, data: { state: 'ON' } });
    try {
      const category = await prisma.category.findUniqueOrThrow({ where: { slug: 'floristi' } });
      await prisma.featuredSlot.create({
        data: { listingId: a.listing.id, categoryId: category.id, active: true },
      });
      const res3 = await searchDirectory({ categorySlug: 'floristi', countyCode: 'B' });
      const got3 = res3
        .filter((r) => [a.listing.id, b.listing.id].includes(r.listing.id))
        .map((r) => r.listing.id);
      expect(got3).toEqual([b.listing.id]); // featured one excluded from organic
    } finally {
      await prisma.monetizationSwitch.update({ where: { id: 'main' }, data: { state: prevMon } });
    }
  });
});

describe('P31: listing stats appear only at >=10 answered enquiries and can be hidden', () => {
  it('computes stats above the threshold only; hideStats suppresses them publicly', async () => {
    const owner = await makeAccount();
    const moderator = await makeAccount();
    await makeStaff(moderator.id, ['listing_moderator']);
    const l10 = await makeLiveListing(
      owner.id,
      `Stats 10 ${Math.random().toString(36).slice(2)}`,
      moderator.id
    );
    const l9 = await makeLiveListing(
      owner.id,
      `Stats 9 ${Math.random().toString(36).slice(2)}`,
      moderator.id
    );
    const planner = await makeAccount();

    for (let i = 0; i < 10; i++) {
      const e = await createEnquiry(planner.id, {
        listingId: l10.listing.id,
        occasionKind: 'nunta',
        message: `m${i}`,
      });
      await answerEnquiry(e.id, owner.id, `raspuns ${i}`);
    }
    for (let i = 0; i < 9; i++) {
      const e = await createEnquiry(planner.id, {
        listingId: l9.listing.id,
        occasionKind: 'nunta',
        message: `m${i}`,
      });
      await answerEnquiry(e.id, owner.id, `raspuns ${i}`);
    }

    await computeListingStats();
    const s10 = await prisma.listingStats.findUnique({ where: { listingId: l10.listing.id } });
    const s9 = await prisma.listingStats.findUnique({ where: { listingId: l9.listing.id } });
    expect(s10?.enquiriesAnswered).toBe(10);
    expect(s10?.enquiriesSent).toBe(10);
    expect(s9).toBeNull(); // below threshold: nothing published

    const pub10 = await getListingPublic(l10.listing.id);
    expect(pub10.stats?.shareAnswered).toBe(1);

    await prisma.listing.update({ where: { id: l10.listing.id }, data: { hideStats: true } });
    const pubHidden = await getListingPublic(l10.listing.id);
    expect(pubHidden.stats).toBeUndefined();
  });
});

describe('V4/V7: drawings need calibration; updates arrive as What-if previews', () => {
  it('blocks uncalibrated drawings, attaches calibrated ones, and never silently overwrites', async () => {
    const owner = await makeAccount();
    const moderator = await makeAccount();
    await makeStaff(moderator.id, ['listing_moderator']);
    const { listing } = await makeLiveListing(
      owner.id,
      `Sala V ${Math.random().toString(36).slice(2)}`,
      moderator.id
    );
    const planner = await makeAccount();
    const occasion = await createOccasion({
      ownerId: planner.id,
      title: 'Nunta cu sala',
      kind: 'nunta',
      dateMode: 'date',
      dateStart: new Date('2027-08-08T12:00:00Z'),
    });

    const d1 = await addDrawing(listing.id, owner.id, {
      assetId: 'asset-1',
      spaceName: 'Sala mare',
      realWidthM: 20,
      realHeightM: 12,
    });
    // V7: uncalibrated drawing cannot drive a space model
    await expect(attachSpaceModel(occasion.id, planner.id, d1.id)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });

    await calibrateDrawing(d1.id, owner.id, { x: 0, y: 0 }, { x: 200, y: 0 }, 10); // 20 px/m
    const attached = await prisma.drawing.findUniqueOrThrow({ where: { id: d1.id } });
    expect(attached.pixelsPerMeter).toBeCloseTo(20);
    const v1 = await attachSpaceModel(occasion.id, planner.id, d1.id);
    expect(v1.version).toBe(1);

    // V4: a newer drawing arrives as a pending What-if preview; the plan is untouched until confirmed
    const d2 = await addDrawing(listing.id, owner.id, {
      assetId: 'asset-2',
      spaceName: 'Sala mare renovata',
    });
    await calibrateDrawing(d2.id, owner.id, { x: 0, y: 0 }, { x: 100, y: 0 }, 10);
    const preview = await proposeDrawingUpdate(occasion.id, d2.id);
    expect(preview.state).toBe('pending');
    const stillV1 = await prisma.spaceModelVersion.findFirstOrThrow({
      where: { occasionId: occasion.id },
      orderBy: { version: 'desc' },
    });
    expect(stillV1.version).toBe(1);
    expect(stillV1.drawingId).toBe(d1.id);

    await confirmSpaceModelUpdate(preview.id, planner.id);
    const v2 = await prisma.spaceModelVersion.findFirstOrThrow({
      where: { occasionId: occasion.id },
      orderBy: { version: 'desc' },
    });
    expect(v2.version).toBe(2);
    expect(v2.drawingId).toBe(d2.id);
  });
});
