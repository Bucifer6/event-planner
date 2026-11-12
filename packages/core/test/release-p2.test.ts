import { createHmac } from 'node:crypto';
import { describe, expect, it, afterEach } from 'vitest';
import { prisma } from '@eventdesk/db';
import { now } from '@eventdesk/shared';
import {
  acceptQuote,
  addBusinessMember,
  addDrawing,
  addLibraryItem,
  attachSpaceModel,
  calibrateDrawing,
  canEnableMonetization,
  createBusiness,
  createBusinessOccasion,
  createEnquiry,
  createListing,
  decideRevision,
  expectedFeaturedShare,
  exportOccasionCsv,
  getFeaturedFor,
  getMember,
  getSpaceModel,
  handleProcessorWebhook,
  handoverOccasion,
  issueInvoice,
  last30DaysSearches,
  listLibrary,
  markQuote,
  recordBillingAcceptance,
  recordDirectorySearch,
  requestMonetizationEnable,
  applyMonetizationEnable,
  searchDirectoryWithFeatured,
  setBranding,
  setHideDirectoryLinks,
  setPlanLapsed,
  verifyWebhookSignature,
  businessDashboard,
  recordAssetUsage,
  createComplianceAccessRequest,
  approveComplianceAccess,
  createDirectoryCategory,
  retireDirectoryCategory,
  type StaffRole,
} from '../src/index';

async function makeAccount(withEmail = true) {
  if (withEmail) {
    return prisma.account.create({
      data: {
        kind: 'email',
        email: `q-${Math.random().toString(36).slice(2)}@example.com`,
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

async function makeLiveListing(ownerId: string, name: string, moderatorId: string) {
  const business =
    (await prisma.business.findUnique({ where: { accountId: ownerId } })) ??
    (await createBusiness(ownerId, { name: `${name} SRL` }));
  const category = await prisma.category.findUniqueOrThrow({ where: { slug: 'floristi' } });
  const county = await prisma.county.findUniqueOrThrow({ where: { code: 'B' } });
  const locality = await prisma.locality.findFirstOrThrow({ where: { countyId: county.id } });
  const listing = await createListing(business.id, ownerId, {
    name,
    categoryIds: [category.id],
    countyIds: [county.id],
    localityIds: [locality.id],
  });
  const rev = await prisma.listingRevision.findFirstOrThrow({
    where: { listingId: listing.id, state: 'pending' },
  });
  await decideRevision(rev.id, moderatorId, 'approved');
  return {
    business,
    listing: await prisma.listing.findUniqueOrThrow({ where: { id: listing.id } }),
  };
}

async function setMon(state: 'OFF' | 'ON') {
  await prisma.monetizationSwitch.update({ where: { id: 'main' }, data: { state } });
}

afterEach(async () => {
  await setMon('OFF');
});

describe('P-08 (P17/P18/P22/P23): business occasions, handover, lapse', () => {
  it('any active member creates a business occasion; business team has access until handover', async () => {
    const owner = await makeAccount();
    const member = await makeAccount();
    const business = await createBusiness(owner.id, { name: 'Echipa SRL' });
    await addBusinessMember(business.id, owner.id, { accountId: member.id, role: 'staff' });

    // P18: an admin cannot create or remove other admins
    const admin = await makeAccount();
    await addBusinessMember(business.id, owner.id, { accountId: admin.id, role: 'admin' });
    const admin2 = await makeAccount();
    await expect(
      addBusinessMember(business.id, admin.id, { accountId: admin2.id, role: 'admin' })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const occ = await createBusinessOccasion(business.id, member.id, {
      ownerId: member.id,
      title: 'Nunta clientului',
      kind: 'nunta',
      dateMode: 'date',
      dateStart: new Date('2027-09-09T12:00:00Z'),
    });
    expect(occ.businessId).toBe(business.id);
    // P17: team access via business membership (synthetic grant)
    expect(await getMember(occ.id, owner.id)).not.toBeNull();

    // P22: handover ends business-side access, keeps history
    const client = await makeAccount();
    await handoverOccasion(occ.id, owner.id, client.id);
    expect(await getMember(occ.id, owner.id)).toBeNull(); // business member loses access
    expect((await getMember(occ.id, client.id))?.role).toBe('owner'); // client takes over
    const reloaded = await prisma.occasion.findUniqueOrThrow({ where: { id: occ.id } });
    expect(reloaded.handedOverAt).not.toBeNull();
    // MCP7: a business member's token path (getMember) no longer grants the occasion
    expect(await getMember(occ.id, member.id)).toBeNull();
  });

  it('P23: on plan lapse new business occasions/branding/library stop; existing occasions stay usable', async () => {
    const owner = await makeAccount();
    const business = await createBusiness(owner.id, { name: 'Lapse SRL' });
    const occ = await createBusinessOccasion(business.id, owner.id, {
      ownerId: owner.id,
      title: 'Eveniment existent',
      kind: 'aniversare',
      dateMode: 'date',
    });
    // a live listing created BEFORE the lapse (drawings/catalogues in live plans stay readable, P23)
    const moderator = await makeAccount();
    await makeStaff(moderator.id, ['listing_moderator']);
    const { listing } = await makeLiveListing(
      owner.id,
      `Sala Lapse ${Math.random().toString(36).slice(2)}`,
      moderator.id
    );

    await setPlanLapsed(business.id, true);

    await expect(
      createBusinessOccasion(business.id, owner.id, {
        ownerId: owner.id,
        title: 'Nou',
        kind: 'custom',
        dateMode: 'date',
      })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      setBranding(business.id, owner.id, { accentColor: '#aabbcc' })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      addLibraryItem(business.id, owner.id, { kind: 'checklist', title: 'x', payload: {} })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      createListing(business.id, owner.id, {
        name: 'Listare noua',
        categoryIds: [
          await prisma.category
            .findFirstOrThrow({ where: { published: true, retiredAt: null } })
            .then((c) => c.id),
        ],
        countyIds: [
          await prisma.county.findUniqueOrThrow({ where: { code: 'B' } }).then((c) => c.id),
        ],
        localityIds: [
          await prisma.locality
            .findFirstOrThrow({ where: { county: { code: 'B' } } })
            .then((l) => l.id),
        ],
      })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    // existing occasion stays fully usable (reads + space model unaffected)
    expect(await getMember(occ.id, owner.id)).not.toBeNull();
    const d = await addDrawing(listing.id, owner.id, { assetId: 'a1', spaceName: 'Sala' });
    await calibrateDrawing(d.id, owner.id, { x: 0, y: 0 }, { x: 100, y: 0 }, 10);
    const model = await attachSpaceModel(occ.id, owner.id, d.id); // drawing stays usable in live plans
    expect(model.version).toBe(1);
    expect(await getSpaceModel(occ.id, owner.id)).not.toBeNull();
  });

  it('P19/P21: shared library + dashboard with daily asset-usage totals (no visitor ids)', async () => {
    const owner = await makeAccount();
    const business = await createBusiness(owner.id, { name: 'Lib SRL' });
    const item = await addLibraryItem(business.id, owner.id, {
      kind: 'supplier_contact',
      title: 'Furnizor tort',
      payload: { name: 'Dulce SRL', phone: '0700' },
    });
    expect((await listLibrary(business.id, owner.id)).map((i) => i.id)).toContain(item.id);

    const moderator = await makeAccount();
    await makeStaff(moderator.id, ['listing_moderator']);
    const { listing } = await makeLiveListing(
      owner.id,
      `Lib Listing ${Math.random().toString(36).slice(2)}`,
      moderator.id
    );
    await recordAssetUsage('drawing', 'drw-1', listing.id);
    await recordAssetUsage('drawing', 'drw-1', listing.id);
    const dash = await businessDashboard(business.id, owner.id);
    const usage = dash.assetUsageDaily.find((u) => u.assetId === 'drw-1');
    expect(usage?.uses).toBe(2);
    expect(dash.listings.map((l) => l.id)).toContain(listing.id);
  });

  it('P7: directory task link switchable per account and per occasion member', async () => {
    const user = await makeAccount();
    await setHideDirectoryLinks(user.id, {}, true);
    expect(
      (await prisma.account.findUniqueOrThrow({ where: { id: user.id } })).hideDirectoryLinks
    ).toBe(true);
    const occ = await createBusinessOccasion(
      (await createBusiness(user.id, { name: 'P7 SRL' })).id,
      user.id,
      { ownerId: user.id, title: 'T', kind: 'custom', dateMode: 'date' }
    );
    await setHideDirectoryLinks(user.id, { occasionId: occ.id }, true);
    const member = await prisma.occasionMember.findUniqueOrThrow({
      where: { occasionId_accountId: { occasionId: occ.id, accountId: user.id } },
    });
    expect(member.hideDirectoryLinks).toBe(true);
  });
});

describe('P12: quote marking and acceptance into supplier record + budget', () => {
  it('business marks a PDF quote; planner accepts it into budget', async () => {
    const owner = await makeAccount();
    const moderator = await makeAccount();
    await makeStaff(moderator.id, ['listing_moderator']);
    const { listing } = await makeLiveListing(
      owner.id,
      `Quote ${Math.random().toString(36).slice(2)}`,
      moderator.id
    );
    const planner = await makeAccount();
    const occ = await createBusinessOccasion(
      (await createBusiness(planner.id, { name: 'Planner SRL' })).id,
      planner.id,
      { ownerId: planner.id, title: 'Nunta', kind: 'nunta', dateMode: 'date' }
    );
    const e = await createEnquiry(planner.id, {
      occasionId: occ.id,
      listingId: listing.id,
      occasionKind: 'nunta',
      message: 'Oferta?',
    });
    const booking = await prisma.booking.findFirstOrThrow({ where: { occasionId: occ.id } });
    const asset = await prisma.asset.create({
      data: {
        uploaderId: owner.id,
        kind: 'pdf',
        storageKey: `q-${Math.random().toString(36).slice(2)}.pdf`,
        fileName: 'oferta.pdf',
        mime: 'application/pdf',
        sizeBytes: 1000,
        scanStatus: 'clean',
      },
    });
    await markQuote(booking.id, owner.id, asset.id);
    const { booking: updated, expense } = await acceptQuote(occ.id, planner.id, booking.id, {
      amountBani: 500_00,
    });
    expect(updated.state).toBe('booked');
    expect(updated.acceptedQuoteAssetId).toBe(asset.id);
    expect(expense.amountBani).toBe(500_00);
    expect(expense.receiptAssetId).toBe(asset.id);
    void e;
  });
});

describe('P-13 (P13-P16) + MON4 + P24/P25 webhooks + P15', () => {
  it('while MON OFF there is no Featured anywhere; with MON ON up to 3 labelled random cards, organic untouched, exports clean', async () => {
    const owner = await makeAccount();
    const moderator = await makeAccount();
    await makeStaff(moderator.id, ['listing_moderator']);
    const l1 = await makeLiveListing(
      owner.id,
      `F1 ${Math.random().toString(36).slice(2)}`,
      moderator.id
    );
    const l2 = await makeLiveListing(
      owner.id,
      `F2 ${Math.random().toString(36).slice(2)}`,
      moderator.id
    );
    const category = await prisma.category.findUniqueOrThrow({ where: { slug: 'floristi' } });
    const county = await prisma.county.findUniqueOrThrow({ where: { code: 'B' } });

    await prisma.featuredSlot.deleteMany({ where: { categoryId: category.id } });
    await setMon('OFF');
    expect(await getFeaturedFor({ categorySlug: 'floristi', countyCode: 'B' })).toEqual([]); // MON5
    await prisma.featuredSlot.create({
      data: { listingId: l1.listing.id, categoryId: category.id, active: true },
    });
    expect(await getFeaturedFor({ categorySlug: 'floristi', countyCode: 'B' })).toEqual([]); // still OFF

    await setMon('ON');
    const res = await searchDirectoryWithFeatured({ categorySlug: 'floristi', countyCode: 'B' });
    expect(res.featured.length).toBe(1);
    expect(res.featured[0]!.featuredLabel).toBe('Promovat — plasare plătită'); // P14 verbatim
    expect(res.organic.map((r) => r.listing.id)).not.toContain(l1.listing.id); // not in organic
    expect(res.organic.map((r) => r.listing.id)).toContain(l2.listing.id);

    // P16: Featured never in exports
    const planner = await makeAccount();
    const occ = await createBusinessOccasion(
      (await createBusiness(planner.id, { name: 'Exp SRL' })).id,
      planner.id,
      { ownerId: planner.id, title: 'N', kind: 'nunta', dateMode: 'date' }
    );
    const csv = await exportOccasionCsv(occ.id, planner.id);
    expect(csv).not.toContain('Promovat');
    void l2;
  });

  it('P15: expected share min(1, 3/(n+1)) + 30-day search aggregates', async () => {
    expect(expectedFeaturedShare(2)).toBe(1);
    expect(expectedFeaturedShare(8)).toBeCloseTo(3 / 9);
    const category = await prisma.category.findUniqueOrThrow({ where: { slug: 'dj' } });
    const county = await prisma.county.findUniqueOrThrow({ where: { code: 'CJ' } });
    await recordDirectorySearch(category.id, county.id);
    await recordDirectorySearch(category.id, county.id);
    expect(await last30DaysSearches(category.id, county.id)).toBeGreaterThanOrEqual(2);
  });

  it('MON4: switch ON refused without billing acceptance; with acceptance + 2 staff it records the 60-day notice', async () => {
    await prisma.billingAcceptance.deleteMany({ where: {} });
    const a = await makeAccount();
    const b = await makeAccount();
    await makeStaff(a.id, ['platform_admin']);
    await makeStaff(b.id, ['platform_admin']);
    const req = await requestMonetizationEnable(a.id);
    await expect(applyMonetizationEnable(req.id, b.id)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(
      (await prisma.monetizationSwitch.findUniqueOrThrow({ where: { id: 'main' } })).state
    ).toBe('OFF');

    const c = await makeAccount();
    await makeStaff(c.id, ['commercial_manager']);
    await recordBillingAcceptance(c.id, 'test mode ok');
    expect((await canEnableMonetization()).ok).toBe(true);
    await applyMonetizationEnable(req.id, b.id);
    const mon = await prisma.monetizationSwitch.findUniqueOrThrow({ where: { id: 'main' } });
    expect(mon.state).toBe('ON');
    expect(mon.noticeStartedAt).not.toBeNull();
    expect(mon.noticeEndsAt!.getTime() - mon.noticeStartedAt!.getTime()).toBe(60 * 86_400_000);
    await setMon('OFF');
    await prisma.monetizationSwitch.update({
      where: { id: 'main' },
      data: { noticeStartedAt: null, noticeEndsAt: null, history: [] as never },
    });
  });

  it('P24/P25: webhook flips features only with a valid signature; failed payment grants 14d grace', async () => {
    const secret = 'whsec_testsecret';
    process.env.STRIPE_WEBHOOK_SECRET = secret;
    const body = JSON.stringify({
      type: 'invoice.payment_failed',
      data: { object: { id: 'in_1', subscription: 'sub_test_1' } },
    });
    const t = Math.floor(now().getTime() / 1000);
    const sig = `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
    expect(verifyWebhookSignature(body, sig, secret)).toBe(true);
    expect(verifyWebhookSignature(body, `t=${t},v1=${'0'.repeat(64)}`, secret)).toBe(false);
    expect(verifyWebhookSignature('tampered', sig, secret)).toBe(false);

    const owner = await makeAccount();
    const business = await createBusiness(owner.id, { name: 'Bill SRL' });
    await prisma.subscription.create({
      data: {
        businessId: business.id,
        kind: 'business_plan',
        state: 'active',
        priceBani: 199_00,
        stripeSubscriptionId: 'sub_test_1',
      },
    });
    // tampered signature: no change
    await expect(handleProcessorWebhook('tampered', sig)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    // valid signature: 14-day grace (P25)
    await handleProcessorWebhook(body, sig);
    const sub = await prisma.subscription.findFirstOrThrow({
      where: { stripeSubscriptionId: 'sub_test_1' },
    });
    expect(sub.state).toBe('past_due');
    expect(sub.graceUntil!.getTime() - now().getTime()).toBeGreaterThan(13 * 86_400_000);
    delete process.env.STRIPE_WEBHOOK_SECRET;
  });

  it('PAY3/PAY4: sandbox invoice has TVA separate, prices excl. TVA, SANDBOX fiscal ref', async () => {
    const owner = await makeAccount();
    const business = await createBusiness(owner.id, { name: 'Inv SRL' });
    const inv = await issueInvoice({
      businessId: business.id,
      amountBani: 199_00,
      description: 'Business plan monthly',
    });
    expect(inv.tvaBani).toBe(Math.round(199_00 * 0.19));
    expect(inv.amountBani).toBe(199_00); // excl. TVA
    expect(inv.fiscalRef).toMatch(/^SANDBOX-/);
  });
});

describe('W4/W8: directory management + three-person compliance access', () => {
  it('retired categories stop accepting new listings; W8 needs 3 distinct approvers', async () => {
    const editor = await makeAccount();
    await makeStaff(editor.id, ['content_editor', 'privacy_owner']);
    const cat = await createDirectoryCategory(editor.id, {
      slug: `test-${Math.random().toString(36).slice(2, 8)}`,
      nameRo: 'Test',
      nameEn: 'Test',
    });
    await retireDirectoryCategory(editor.id, cat.id, true);
    const retired = await prisma.category.findUniqueOrThrow({ where: { id: cat.id } });
    expect(retired.retiredAt).not.toBeNull();

    const owner = await makeAccount();
    const business = await createBusiness(owner.id, { name: 'W8 SRL' });
    const county = await prisma.county.findUniqueOrThrow({ where: { code: 'B' } });
    const locality = await prisma.locality.findFirstOrThrow({ where: { countyId: county.id } });
    await expect(
      createListing(business.id, owner.id, {
        name: 'X',
        categoryIds: [cat.id],
        countyIds: [county.id],
        localityIds: [locality.id],
      })
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });

    // W8: three-person rule
    const req = await createComplianceAccessRequest(editor.id, 'DPIA review');
    const p1 = await makeAccount();
    const p2 = await makeAccount();
    const p3 = await makeAccount();
    for (const role of ['privacy_owner'] as StaffRole[]) {
      await makeStaff(p1.id, [role]);
      await makeStaff(p2.id, [role]);
      await makeStaff(p3.id, [role]);
    }
    await expect(approveComplianceAccess(req.id, editor.id)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    }); // requester cannot self-approve
    await approveComplianceAccess(req.id, p1.id);
    await approveComplianceAccess(req.id, p2.id);
    expect(
      (await prisma.complianceAccessRequest.findUniqueOrThrow({ where: { id: req.id } })).state
    ).toBe('pending');
    await approveComplianceAccess(req.id, p3.id);
    expect(
      (await prisma.complianceAccessRequest.findUniqueOrThrow({ where: { id: req.id } })).state
    ).toBe('approved');
  });
});
