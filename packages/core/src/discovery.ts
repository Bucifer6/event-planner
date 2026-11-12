import { prisma } from '@eventdesk/db';
import { AppError, hashCode, hashIdentifier, newNumericCode, now } from '@eventdesk/shared';
import { sendMail } from '@eventdesk/email';
import { audit } from './audit';
import { requireStaff } from './staff';

// BD1-BD7 + P29/P30: business discovery creates unclaimed draft listings from
// lawful public sources — never live, never public until a moderator approves
// (BD2/BD4). Approved unclaimed listings show the published contact route with
// the "not claimed yet" label and cannot receive enquiries (P29). Exactly one
// claim invitation is emailed, only to a publicly listed address (BD5); no
// marketing is ever sent to discovered contacts (BD6). Objections/removals are
// honoured within 30 days and recorded (3-year retention, INF6).

export async function createDraft(input: {
  sourceId: string;
  name: string;
  categoryGuess?: string;
  countyCode?: string;
  locality?: string;
  publicContactRoute?: string;
  sourceUrl: string;
  runId?: string;
}) {
  // BD3: dedup by name + public contact route against listings and other drafts;
  // suspected duplicates queue for humans, never auto-merge.
  const existingListing = await prisma.listing.findFirst({
    where: { name: { equals: input.name, mode: 'insensitive' } },
  });
  const existingDraft = await prisma.discoveryDraft.findFirst({
    where: { name: { equals: input.name, mode: 'insensitive' }, state: 'pending' },
  });
  if (existingListing || existingDraft) {
    return prisma.discoveryDraft.create({
      data: {
        sourceId: input.sourceId,
        name: input.name,
        categoryGuess: input.categoryGuess ?? null,
        countyCode: input.countyCode ?? null,
        locality: input.locality ?? null,
        publicContactRoute: input.publicContactRoute ?? null,
        sourceUrl: input.sourceUrl,
        runId: input.runId ?? null,
        state: 'duplicate_queued',
      },
    });
  }
  return prisma.discoveryDraft.create({
    data: {
      sourceId: input.sourceId,
      name: input.name,
      categoryGuess: input.categoryGuess ?? null,
      countyCode: input.countyCode ?? null,
      locality: input.locality ?? null,
      publicContactRoute: input.publicContactRoute ?? null,
      sourceUrl: input.sourceUrl,
      runId: input.runId ?? null,
      state: 'pending',
    },
  });
}

// BD4: a ListingModerator approves a draft -> live minimal factual unclaimed
// listing labelled "Adăugat de EventDesk — nefiind revendicat încă", source cited.
export async function approveDraft(draftId: string, staffAccountId: string): Promise<void> {
  await requireStaff(staffAccountId, 'listing_moderator');
  const draft = await prisma.discoveryDraft.findUniqueOrThrow({ where: { id: draftId } });
  if (draft.state !== 'pending') throw new AppError('CONFLICT', 'Draft already decided.');
  let listingId = '';
  await prisma.$transaction(async (tx) => {
    const listing = await tx.listing.create({
      data: {
        businessId: null,
        name: draft.name,
        status: 'live',
        claimed: false, // P29
        publicContactRoute: draft.publicContactRoute,
        sourceUrl: draft.sourceUrl, // source cited in the moderation record (BD4)
      },
    });
    listingId = listing.id;
    await tx.discoveryDraft.update({
      where: { id: draftId },
      data: { state: 'approved', listingId: listing.id },
    });
    await tx.auditLog.create({
      data: {
        actorId: staffAccountId,
        actorKind: 'staff',
        action: 'discovery_draft_approved',
        objectType: 'DiscoveryDraft',
        objectId: draftId,
        after: {
          listingId: listing.id,
          sourceUrl: draft.sourceUrl,
          collectedAt: draft.collectedAt,
        },
      },
    });
  });
  // BD5: a single claim invitation, only if a public email is listed
  const listing = await prisma.listing.findUniqueOrThrow({ where: { id: listingId } });
  const emailMatch = listing.publicContactRoute?.match(/[\w.+-]+@[\w-]+\.[\w.]+/);
  if (emailMatch) {
    const code = newNumericCode();
    await prisma.claimInvitation.create({
      data: { listingId: listing.id, codeHash: hashCode(code) },
    });
    await sendMail({
      to: emailMatch[0],
      subject: 'Listarea ta pe EventDesk.ro — revendic-o / Your listing on EventDesk.ro — claim it',
      text: [
        `Am adăugat firma „${listing.name}” într-un director public pe EventDesk.ro, pe baza datelor publicate de tine (${listing.sourceUrl}).`,
        `Dacă vrei să revendici listarea, folosește codul: ${code}`,
        `Poți corecta sau cere ștergerea listării oricând. Nu trimitem niciun mesaj de marketing către contactele găsite prin căutare.`,
        '--- English ---',
        `We added "${listing.name}" to a public directory on EventDesk.ro based on your published data (${listing.sourceUrl}).`,
        `To claim the listing, use this code: ${code}`,
        'You can correct or request removal of the listing at any time. We never send marketing to discovered contacts.',
      ].join('\n'),
      template: 'claim-invitation',
    });
  }
  // BD5: where the public source lists no email, no invitation is sent.
}

// P30: claiming proves ownership — a code is emailed to the business's published
// contact address; if no email is publicly available, a ListingModerator verifies
// the claimant against the public source and records the check.
export async function verifyClaimCode(listingId: string, code: string): Promise<boolean> {
  const invitation = await prisma.claimInvitation.findUnique({ where: { listingId } });
  if (!invitation?.codeHash) return false;
  const { safeEqual } = await import('@eventdesk/shared');
  return safeEqual(invitation.codeHash, hashCode(code));
}

export async function claimListing(
  listingId: string,
  accountId: string,
  code: string
): Promise<void> {
  const listing = await prisma.listing.findUniqueOrThrow({ where: { id: listingId } });
  if (listing.claimed) throw new AppError('CONFLICT', 'Already claimed.');
  if (!(await verifyClaimCode(listingId, code))) {
    throw new AppError('INVALID_CODE', 'Invalid claim code.');
  }
  const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
  if (!account.email)
    throw new AppError('INVALID_INPUT', 'Claiming requires an email account (P30).');
  await prisma.$transaction(async (tx) => {
    await tx.listing.update({
      where: { id: listingId },
      data: { claimed: true, businessId: undefined as never },
    });
    let business = await tx.business.findUnique({ where: { accountId } });
    if (!business) {
      business = await tx.business.create({ data: { accountId, name: listing.name } });
      await tx.businessMember.create({
        data: { businessId: business.id, accountId, role: 'owner' },
      });
    }
    await tx.listing.update({ where: { id: listingId }, data: { businessId: business.id } });
    await tx.auditLog.create({
      data: {
        actorId: accountId,
        actorKind: 'account',
        action: 'listing_claimed',
        objectType: 'Listing',
        objectId: listingId,
      },
    });
  });
}

// P30 fallback: no public email -> a ListingModerator verifies against the public
// source and records the check.
export async function moderatorVerifyClaim(
  listingId: string,
  staffAccountId: string,
  claimantAccountId: string,
  note: string
): Promise<void> {
  await requireStaff(staffAccountId, 'listing_moderator');
  const listing = await prisma.listing.findUniqueOrThrow({ where: { id: listingId } });
  if (listing.claimed) throw new AppError('CONFLICT', 'Already claimed.');
  if (listing.publicContactRoute && /@/.test(listing.publicContactRoute)) {
    throw new AppError('CONFLICT', 'A public email exists — the emailed-code path applies (P30).');
  }
  await prisma.$transaction(async (tx) => {
    let business = await tx.business.findUnique({ where: { accountId: claimantAccountId } });
    if (!business) {
      business = await tx.business.create({
        data: { accountId: claimantAccountId, name: listing.name },
      });
      await tx.businessMember.create({
        data: { businessId: business.id, accountId: claimantAccountId, role: 'owner' },
      });
    }
    await tx.listing.update({
      where: { id: listingId },
      data: { claimed: true, businessId: business.id },
    });
    await tx.auditLog.create({
      data: {
        actorId: staffAccountId,
        actorKind: 'staff',
        action: 'claim_verified_by_moderator',
        objectType: 'Listing',
        objectId: listingId,
        after: { claimantAccountId, note, sourceUrl: listing.sourceUrl },
      },
    });
  });
}

// BD6: removal/objection honoured within 30 days, recorded (3-year retention).
export async function recordObjection(input: {
  listingId?: string;
  contact: string;
  kind: 'removal' | 'objection' | 'correction';
  detail: string;
}): Promise<void> {
  await prisma.objectionRecord.create({
    data: {
      listingId: input.listingId ?? null,
      contactHash: hashIdentifier(input.contact),
      kind: input.kind,
      detail: input.detail,
    },
  });
  await audit({
    actorKind: 'system',
    action: 'objection_recorded',
    objectType: 'ObjectionRecord',
    after: { kind: input.kind, listingId: input.listingId ?? null },
  });
}

export async function handleObjection(objectionId: string, staffAccountId: string): Promise<void> {
  await requireStaff(staffAccountId, 'listing_moderator');
  const objection = await prisma.objectionRecord.findUniqueOrThrow({ where: { id: objectionId } });
  if (objection.handledAt) throw new AppError('CONFLICT', 'Already handled.');
  const within30d = now().getTime() - objection.receivedAt.getTime() <= 30 * 86_400_000;
  if (!within30d) throw new AppError('CONFLICT', 'Beyond the 30-day handling window (BD6).');
  await prisma.$transaction(async (tx) => {
    if (objection.listingId && objection.kind === 'removal') {
      await tx.listing.update({
        where: { id: objection.listingId },
        data: { status: 'suspended' },
      });
    }
    await tx.objectionRecord.update({
      where: { id: objectionId },
      data: { handledAt: now(), handledBy: staffAccountId },
    });
    await tx.auditLog.create({
      data: {
        actorId: staffAccountId,
        actorKind: 'staff',
        action: 'objection_handled',
        objectType: 'ObjectionRecord',
        objectId: objectionId,
        after: { kind: objection.kind },
      },
    });
  });
}

export async function listDrafts(state = 'pending') {
  return prisma.discoveryDraft.findMany({ where: { state }, orderBy: { collectedAt: 'asc' } });
}

export async function listSources() {
  return prisma.discoverySource.findMany({ orderBy: { name: 'asc' } });
}

export async function setSourceEnabled(sourceId: string, enabled: boolean, staffAccountId: string) {
  await requireStaff(staffAccountId, 'platform_admin');
  const source = await prisma.discoverySource.update({
    where: { id: sourceId },
    data: { enabled },
  });
  await audit({
    actorId: staffAccountId,
    actorKind: 'staff',
    action: enabled ? 'discovery_source_enabled' : 'discovery_source_kill_switch',
    objectType: 'DiscoverySource',
    objectId: sourceId,
  });
  return source;
}
