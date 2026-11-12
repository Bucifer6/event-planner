import { prisma } from '@eventdesk/db';
import { AppError, hashIdentifier, now, startOfUtcDay } from '@eventdesk/shared';
import { sendMail, templates } from '@eventdesk/email';
import { audit } from './audit';
import { requireMember } from './access';

// P8-P11/P33/F5 + P29/P32: enquiries planner -> business. Free, pre-filled fields;
// nothing else shared; planner email only if ticked (P9). Limits: 10 per occasion
// and 30 per account per day (P11) — flower quote requests count against both.
// Unclaimed listings cannot receive enquiries (P29). State machine:
// sent -> awaiting -> answered -> closed, unanswered shows "sent <date>" (P33);
// re-send once after 7 days reuses the thread (P33). Business notified on arrival
// in the listing language (P32/L4) + one 48h nudge.

export const ENQUIRIES_PER_OCCASION = 10; // P11
export const ENQUIRIES_PER_ACCOUNT_PER_DAY = 30; // P11

export interface EnquiryInput {
  occasionId?: string;
  listingId: string;
  kind?: 'enquiry' | 'quote_request';
  occasionKind: string;
  date?: string;
  approxGuests?: number;
  countyCode?: string;
  locality?: string;
  budgetBand?: string;
  message: string;
  shareEmail?: boolean;
  arrangement?: unknown; // F5: arrangement design or uploaded image + notes
}

export async function createEnquiry(accountId: string, input: EnquiryInput) {
  const listing = await prisma.listing.findUniqueOrThrow({
    where: { id: input.listingId },
    include: { business: { include: { members: true } } },
  });
  if (listing.status !== 'live') throw new AppError('NOT_FOUND', 'Listing not live.');
  if (!listing.claimed) {
    // P29: unclaimed listings cannot receive enquiries, quote requests, Featured or uploads
    throw new AppError(
      'FORBIDDEN',
      "This listing isn't claimed yet — it carries no platform-mediated contact."
    );
  }

  // P11 limits, enforced server-side; quote requests count against both (F5/P11)
  if (input.occasionId) {
    const perOccasion = await prisma.enquiry.count({ where: { occasionId: input.occasionId } });
    if (perOccasion >= ENQUIRIES_PER_OCCASION) {
      throw new AppError(
        'RATE_LIMITED',
        `Limit of ${ENQUIRIES_PER_OCCASION} enquiries per occasion reached (P11).`
      );
    }
    await requireMember(input.occasionId, accountId);
  }
  const day = startOfUtcDay(now());
  const perDay = await prisma.enquiry.count({
    where: { plannerAccountId: accountId, sentAt: { gte: day } },
  });
  if (perDay >= ENQUIRIES_PER_ACCOUNT_PER_DAY) {
    throw new AppError(
      'RATE_LIMITED',
      `Limit of ${ENQUIRIES_PER_ACCOUNT_PER_DAY} enquiries per account per day reached (P11).`
    );
  }

  const payload = {
    occasionKind: input.occasionKind,
    date: input.date ?? null,
    approxGuests: input.approxGuests ?? null,
    countyCode: input.countyCode ?? null,
    locality: input.locality ?? null,
    budgetBand: input.budgetBand ?? null,
    message: input.message,
    arrangement: input.arrangement ?? null, // F5: only arrangement + date + guests + message
  };

  const enquiry = await prisma.$transaction(async (tx) => {
    const e = await tx.enquiry.create({
      data: {
        listingId: listing.id,
        occasionId: input.occasionId ?? null,
        plannerAccountId: accountId,
        kind: input.kind ?? 'enquiry',
        payload: payload as object,
        shareEmail: input.shareEmail ?? false,
        state: 'sent',
      },
    });
    // P10: the enquiry creates or reuses the supplier record and booking, so the
    // thread sits in the plan
    if (input.occasionId) {
      let supplier = await tx.supplier.findFirst({
        where: { occasionId: input.occasionId, name: listing.name },
      });
      if (!supplier) {
        supplier = await tx.supplier.create({
          data: {
            occasionId: input.occasionId,
            name: listing.name,
            contactEmail: null,
            createdById: accountId,
          },
        });
      }
      await tx.booking.create({
        data: {
          supplierId: supplier.id,
          occasionId: input.occasionId,
          title: listing.name,
          state: 'enquired',
          createdById: accountId,
        },
      });
      await tx.enquiry.update({ where: { id: e.id }, data: { supplierId: supplier.id } });
    }
    await tx.auditLog.create({
      data: {
        actorId: accountId,
        actorKind: 'account',
        action: 'enquiry_sent',
        objectType: 'Enquiry',
        objectId: e.id,
        after: { listingId: listing.id, kind: e.kind, shareEmail: e.shareEmail },
      },
    });
    return e;
  });

  // P32: notify the business on arrival by email, in the language of its listing (L4)
  const businessEmails =
    listing.business?.members
      ?.map((m) => m.accountId)
      .map((id) => prisma.account.findUnique({ where: { id }, select: { email: true } })) ?? [];
  const accounts = await Promise.all(businessEmails);
  const planner = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
  for (const acc of accounts) {
    if (acc?.email) {
      const mail = templates.digestEmail({
        occasionTitle: listing.name,
        sections: [
          {
            ro: `Ai primit o cerere nouă de la ${input.shareEmail ? planner.email : 'un planificator'}.`,
            en: `You received a new enquiry from ${input.shareEmail ? planner.email : 'a planner'}.`,
          },
        ],
      });
      await sendMail({
        to: acc.email,
        subject: `Cerere nouă pentru ${listing.name} / New enquiry for ${listing.name}`,
        text: mail.text + `\n\n${input.message}`,
        template: 'enquiry-arrival',
        occasionId: input.occasionId ?? undefined,
      }).catch(() => {});
    }
  }
  return enquiry;
}

export async function answerEnquiry(
  enquiryId: string,
  businessAccountId: string,
  body: string,
  quoteAssetId?: string
) {
  const enquiry = await prisma.enquiry.findUniqueOrThrow({
    where: { id: enquiryId },
    include: { listing: { include: { business: { include: { members: true } } } } },
  });
  const isMember = enquiry.listing.business?.members.some((m) => m.accountId === businessAccountId);
  if (!isMember) throw new AppError('FORBIDDEN', 'Not a member of this business.');
  return prisma.$transaction(async (tx) => {
    await tx.enquiryMessage.create({
      data: { enquiryId, fromBusiness: true, body, quoteAssetId: quoteAssetId ?? null },
    });
    const updated = await tx.enquiry.update({
      where: { id: enquiryId },
      data: { state: 'answered', answeredAt: now() },
    });
    await tx.auditLog.create({
      data: {
        actorId: businessAccountId,
        actorKind: 'account',
        action: 'enquiry_answered',
        objectType: 'Enquiry',
        objectId: enquiryId,
      },
    });
    return updated;
  });
}

export async function setEnquiryState(
  enquiryId: string,
  accountId: string,
  state: 'closed' | 'awaiting'
) {
  const enquiry = await prisma.enquiry.findUniqueOrThrow({ where: { id: enquiryId } });
  const isPlanner = enquiry.plannerAccountId === accountId;
  const listing = await prisma.listing.findUniqueOrThrow({
    where: { id: enquiry.listingId },
    include: { business: { include: { members: true } } },
  });
  const isBusiness = (listing.business?.members ?? []).some((m) => m.accountId === accountId);
  if (!isPlanner && !isBusiness) throw new AppError('FORBIDDEN', 'No access to this enquiry.');
  return prisma.enquiry.update({
    where: { id: enquiryId },
    data: { state, closedAt: state === 'closed' ? now() : null },
  });
}

// P33: the planner can close or re-send the enquiry once after 7 days without
// creating a duplicate thread.
export async function resendEnquiry(enquiryId: string, accountId: string) {
  const enquiry = await prisma.enquiry.findUniqueOrThrow({ where: { id: enquiryId } });
  if (enquiry.plannerAccountId !== accountId) throw new AppError('FORBIDDEN', 'Not your enquiry.');
  if (enquiry.resendCount >= 1) throw new AppError('CONFLICT', 'Re-send already used (P33).');
  const sevenDaysAgo = new Date(now().getTime() - 7 * 86_400_000);
  if (enquiry.sentAt > sevenDaysAgo && enquiry.lastResendAt === null) {
    throw new AppError('CONFLICT', 'Re-send available only after 7 days (P33).');
  }
  return prisma.enquiry.update({
    where: { id: enquiryId },
    data: { resendCount: { increment: 1 }, lastResendAt: now(), state: 'sent' },
  });
}

export async function listEnquiriesForBusiness(businessId: string, accountId: string) {
  const { requireBusinessMember } = await import('./business');
  await requireBusinessMember(businessId, accountId);
  const listings = await prisma.listing.findMany({ where: { businessId }, select: { id: true } });
  const ids = listings.map((l) => l.id);
  return prisma.enquiry.findMany({
    where: { listingId: { in: ids } },
    include: { messages: { orderBy: { createdAt: 'asc' } }, listing: true },
    orderBy: { sentAt: 'desc' },
  });
}

export async function listEnquiriesForOccasion(occasionId: string, accountId: string) {
  await requireMember(occasionId, accountId);
  return prisma.enquiry.findMany({
    where: { occasionId },
    include: { messages: true, listing: true },
    orderBy: { sentAt: 'desc' },
  });
}

export { hashIdentifier };
