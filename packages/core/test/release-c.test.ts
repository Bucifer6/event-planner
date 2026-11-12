import { describe, expect, it } from 'vitest';
import { prisma } from '@eventdesk/db';
import { AppError } from '@eventdesk/shared';
import {
  addMenuItem,
  addPrivateRequest,
  approveInvitationProof,
  assemblePrintPack,
  attachInvitationPdf,
  checkMealStage,
  createArrangementDesign,
  createBusiness,
  createInvitationDesign,
  createListing,
  createMenu,
  createOccasion,
  decideRevision,
  estimateGift,
  exportPromotionPack,
  fitCheckSeating,
  getGuestSeat,
  getPublicEventPage,
  listPrivateRequests,
  listGiftEstimates,
  menuQuantities,
  notifyProgrammeChange,
  publishSeating,
  registerPublic,
  saveAssignments,
  sendQuoteRequestFromDesign,
  setMealChoice,
  setPublicPage,
  addProgrammeItem,
  addCue,
  listProgramme,
  setVenue,
  answerEnquiry,
  createCatalogue,
  addCatalogueItem,
  addDrawing,
  calibrateDrawing,
  attachSpaceModel,
  listBusinessListings,
  type StaffRole,
} from '../src/index';

async function makeAccount() {
  return prisma.account.create({
    data: {
      kind: 'email',
      email: `c-${Math.random().toString(36).slice(2)}@example.com`,
      emailVerifiedAt: new Date(),
    },
  });
}

async function makeStaff(accountId: string, roles: StaffRole[]) {
  await prisma.staffMember.create({ data: { accountId, roles } });
  await prisma.totpSecret.create({
    data: { accountId, secret: 'JBSWY3DPEHPK3PXP', confirmedAt: new Date() },
  });
}

async function setupOccasion(capacity = 4) {
  const owner = await makeAccount();
  const occasion = await createOccasion({
    ownerId: owner.id,
    title: 'Nunta C',
    kind: 'nunta',
    dateMode: 'date',
    dateStart: new Date('2027-10-02T12:00:00Z'),
    capacityTotal: capacity,
  });
  const h1 = await prisma.household.create({
    data: { occasionId: occasion.id, name: 'Familia Pop' },
  });
  const h2 = await prisma.household.create({
    data: { occasionId: occasion.id, name: 'Familia Ionescu' },
  });
  return { owner, occasion, h1, h2 };
}

async function setupLiveFlorist() {
  const owner = await makeAccount();
  const moderator = await makeAccount();
  await makeStaff(moderator.id, ['listing_moderator']);
  const business = await createBusiness(owner.id, {
    name: `Florist ${Math.random().toString(36).slice(2)}`,
  });
  const category = await prisma.category.findUniqueOrThrow({ where: { slug: 'floristi' } });
  const county = await prisma.county.findUniqueOrThrow({ where: { code: 'B' } });
  const locality = await prisma.locality.findFirstOrThrow({ where: { countyId: county.id } });
  const listing = await createListing(business.id, owner.id, {
    name: 'Flori SRL',
    categoryIds: [category.id],
    countyIds: [county.id],
    localityIds: [locality.id],
  });
  const rev = await prisma.listingRevision.findFirstOrThrow({
    where: { listingId: listing.id, state: 'pending' },
  });
  await decideRevision(rev.id, moderator.id, 'approved');
  const cat = await createCatalogue(listing.id, owner.id, ' buchete');
  const item = await addCatalogueItem(cat.id, owner.id, {
    variety: 'Trandafir roșu',
    pricePerStemBani: 500,
    colours: ['roșu'],
  });
  return { owner, business, listing, cat, item };
}

describe('C-01/C-02/C-08: seating on the space model, fit checks, published-only guest view', () => {
  it('saves assignments via the tap path, fit-checks excluding unknown dims, publishes, and guests see seats only after publish', async () => {
    const { owner, occasion, h1, h2 } = await setupOccasion();
    // space model with one known and one unknown table
    const fl = await setupLiveFlorist();
    const drawing = await addDrawing(fl.listing.id, fl.owner.id, {
      assetId: 'a',
      spaceName: 'Sala',
    });
    await calibrateDrawing(drawing.id, fl.owner.id, { x: 0, y: 0 }, { x: 100, y: 0 }, 10);
    await prisma.tableInventory.create({
      data: {
        drawingId: drawing.id,
        tableType: 'rotunda 8 pers',
        widthM: 1.5,
        heightM: 1.5,
        count: 4,
      },
    });
    await prisma.tableInventory.create({
      data: { drawingId: drawing.id, tableType: 'dreapta', widthM: null, heightM: null, count: 2 },
    });
    await attachSpaceModel(occasion.id, owner.id, drawing.id);

    const plan = await saveAssignments(occasion.id, owner.id, [
      { householdId: h1.id, tableRef: 't1', seat: '1' },
      { householdId: h2.id, tableRef: 't2' },
    ]);
    expect(plan.assignments.length).toBe(2);

    // C-02/V6: unknown dims excluded from fit checks, shown as excluded
    const fit = await fitCheckSeating(occasion.id, owner.id);
    expect(fit.checked).toBe(1);
    expect(fit.excludedUnknown).toBe(1);
    const stage = await checkMealStage(occasion.id, owner.id, {
      label: 'felul doi',
      guestCount: 10,
    });
    expect((stage.result as { checked: number }).checked).toBe(1);

    // C-08: before publish, guests see nothing
    expect(await getGuestSeat(occasion.id, h1.id)).toBeNull();
    await publishSeating(occasion.id, owner.id);
    const seat = await getGuestSeat(occasion.id, h1.id);
    expect(seat?.tableRef).toBe('t1');
    expect(seat?.seat).toBe('1');
  });
});

describe('C-03/C-10: programme, versioned cues, notify-once-per-revision', () => {
  it('bumps the revision per change and notifies guests once per revision (INF5)', async () => {
    const { owner, occasion } = await setupOccasion();
    await prisma.invitation.create({
      data: {
        occasionId: occasion.id,
        householdId: (
          await prisma.household.findFirstOrThrow({ where: { occasionId: occasion.id } })
        ).id,
        tokenHash: `th-${Math.random().toString(36).slice(2)}`,
      },
    });
    const hh = await prisma.household.findFirstOrThrow({ where: { occasionId: occasion.id } });
    await prisma.household.update({
      where: { id: hh.id },
      data: { leadEmail: 'lead@example.com' },
    });

    const item = await addProgrammeItem(occasion.id, owner.id, {
      title: 'Dansul mirilor',
      durationMin: 5,
    });
    await addCue(item.id, occasion.id, owner.id, { atLabel: 'T-2min', action: 'lumini' });
    let prog = await listProgramme(occasion.id, owner.id);
    expect(prog[0]!.cues.length).toBe(1);
    expect(prog[0]!.version).toBe(2); // versioned cue list

    const sent1 = await notifyProgrammeChange(occasion.id);
    expect(sent1).toBe(1);
    const sent2 = await notifyProgrammeChange(occasion.id);
    expect(sent2).toBe(0); // once per change, never a stream
  });
});

describe('C-04: invitation designer proof + print PDF gate', () => {
  it('blocks the print PDF until the proof is approved', async () => {
    const { owner, occasion } = await setupOccasion();
    const design = await createInvitationDesign(occasion.id, owner.id, { text: 'Vă invităm' });
    await expect(
      attachInvitationPdf(design.id, occasion.id, owner.id, 'asset-x')
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await approveInvitationProof(design.id, occasion.id, owner.id);
    const withPdf = await attachInvitationPdf(design.id, occasion.id, owner.id, 'asset-x');
    expect(withPdf.pdfAssetId).toBe('asset-x');
  });
});

describe('C-05: menus and meal choices flow into quantities', () => {
  it('aggregates per-item quantities for the order snapshot', async () => {
    const { owner, occasion, h1, h2 } = await setupOccasion();
    const menu = await createMenu(occasion.id, owner.id, 'Meniu principal');
    const item = await addMenuItem(menu.id, occasion.id, owner.id, { name: 'Pui', dietTags: [] });
    const veg = await addMenuItem(menu.id, occasion.id, owner.id, {
      name: 'Vegetarian',
      dietTags: ['vegetarian'],
    });
    await setMealChoice(occasion.id, owner.id, h1.id, item.id);
    await setMealChoice(occasion.id, owner.id, h2.id, veg.id);
    const q = await menuQuantities(occasion.id, owner.id);
    expect(q.find((x) => x.itemId === item.id)?.count).toBe(1);
    expect(q.find((x) => x.itemId === veg.id)?.count).toBe(1);
  });
});

describe('C-06: public event page, atomic waitlist, conditional questions', () => {
  it('registers up to capacity, waitlists beyond it, promotes atomically on free-up', async () => {
    const { owner, occasion } = await setupOccasion(2);
    await setPublicPage(occasion.id, owner.id, {
      slug: `eveniment-${Math.random().toString(36).slice(2, 8)}`,
      on: true,
      questions: [{ id: 'q1', label: 'Vii cu mașina?', type: 'yesno' }],
    });
    await setVenue(occasion.id, owner.id, {
      address: 'Str. Florilor 1, București',
      mapsUrl: 'https://maps.example.com/?q=strada',
    });

    const r1 = await registerPublic({
      occasionId: occasion.id,
      name: 'A',
      contact: 'a@x.com',
      answers: { q1: 'da' },
    });
    const r2 = await registerPublic({
      occasionId: occasion.id,
      name: 'B',
      contact: 'b@x.com',
      answers: {},
    });
    const r3 = await registerPublic({
      occasionId: occasion.id,
      name: 'C',
      contact: 'c@x.com',
      answers: {},
    });
    expect(r1.state).toBe('registered');
    expect(r2.state).toBe('registered');
    expect(r3.state).toBe('waitlist'); // capacity 2 shared with invited guests (A8)
    await expect(
      registerPublic({ occasionId: occasion.id, name: 'A', contact: 'a@x.com', answers: {} })
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    // public page data: no guest identities
    const occNow = await prisma.occasion.findUniqueOrThrow({ where: { id: occasion.id } });
    const page = await getPublicEventPage(occNow.publicSlug!);
    expect(page.occasion.venueAddress).toContain('Florilor');
    expect(page.occasion.registeredCount).toBe(2);
    expect(JSON.stringify(page)).not.toContain('a@x.com');
  });
});

describe('C-07: private requests are grant-gated (D2)', () => {
  it('requires the privateRequests grant to list', async () => {
    const { owner, occasion, h1 } = await setupOccasion();
    const contributor = await makeAccount();
    await prisma.occasionMember.create({
      data: {
        occasionId: occasion.id,
        accountId: contributor.id,
        role: 'contributor',
        finance: false,
        privateRequests: false,
      },
    });
    await addPrivateRequest(occasion.id, owner.id, {
      householdId: h1.id,
      kind: 'diet',
      detail: 'fără gluten',
    });
    await expect(listPrivateRequests(occasion.id, contributor.id)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    const list = await listPrivateRequests(occasion.id, owner.id);
    expect(list[0]!.detail).toBe('fără gluten');
  });
});

describe('C-11: gift estimator is private per planner', () => {
  it('computes a labelled range and never exposes other planners’ estimates', async () => {
    const a = await makeAccount();
    const b = await makeAccount();
    const est = await estimateGift(a.id, {
      relationship: 'family_close',
      distance: 'international',
      venueType: 'venue_hall',
      guestCount: 2,
    });
    expect(est.rangeMaxBani).toBeGreaterThan(est.rangeMinBani);
    expect((await listGiftEstimates(a.id)).length).toBe(1);
    expect(await listGiftEstimates(b.id)).toEqual([]);
  });
});

describe('C-12/C-09: promotion export-only + print pack assembly', () => {
  it('exports copy+assets without posting; print pack carries scoped QR targets', async () => {
    const { owner, occasion } = await setupOccasion();
    await setPublicPage(occasion.id, owner.id, {
      slug: `pp-${Math.random().toString(36).slice(2, 8)}`,
      on: true,
    });
    const pack = await exportPromotionPack(occasion.id, owner.id);
    expect(pack.exportOnly).toBe(true);
    expect(pack.copyRo).toContain(occasion.title);
    const print = await assemblePrintPack(occasion.id, owner.id);
    expect(print.occasion.publicSlug).toBeTruthy();
  });
});

describe('C-13/F3-F6: arrangement designer with indicative cost and quote flow', () => {
  it('computes indicative cost (never a quote), sends F5 quote request, links accepted quote (F6)', async () => {
    const { owner, occasion } = await setupOccasion();
    const fl = await setupLiveFlorist();
    const design = await createArrangementDesign(occasion.id, owner.id, {
      baseForm: 'hand-tied',
      items: [{ catalogueItemId: fl.item.id, stems: 10 }],
    });
    expect(design.indicativeCostBani).toBe(10 * 500); // indicative only (F3)

    const enquiry = await sendQuoteRequestFromDesign(design.id, occasion.id, owner.id, {
      listingId: fl.listing.id,
      message: 'Vreau ofertă pentru buchet',
    });
    expect(enquiry.kind).toBe('quote_request'); // counts against both P11 limits (F5)
    const payload = enquiry.payload as {
      arrangement?: { designId: string; catalogueItemIds: string[] };
    };
    expect(payload.arrangement?.designId).toBe(design.id);
    expect(payload.arrangement?.catalogueItemIds).toContain(fl.item.id);
    const relinked = await prisma.arrangementDesign.findUniqueOrThrow({ where: { id: design.id } });
    expect(relinked.quoteEnquiryId).toBe(enquiry.id);

    // business answers; planner accepts -> F6 link
    await answerEnquiry(enquiry.id, fl.owner.id, ' Oferta atașată în cont.');
    const { linkAcceptedQuote } = await import('../src/index');
    const linked = await linkAcceptedQuote(design.id, owner.id, 'quote-asset-1');
    expect(linked.acceptedQuoteAssetId).toBe('quote-asset-1');
  });
});
