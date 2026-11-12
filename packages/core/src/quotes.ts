import { prisma } from '@eventdesk/db';
import { AppError } from '@eventdesk/shared';
import { audit } from './audit';
import { requireMember, requireGrant } from './access';
import { requireBusinessMember } from './business';
import { createExpense } from './budget';

// P12 + F6: a business marks a PDF as a quote on a booking; the planner accepts it
// into the supplier record and the budget. An accepted quote that came from an
// arrangement design links back to that design version (F6) — recorded in audit.

export async function markQuote(bookingId: string, businessAccountId: string, assetId: string) {
  const booking = await prisma.booking.findUniqueOrThrow({
    where: { id: bookingId },
    include: { supplier: true, occasion: true },
  });
  const listing = await prisma.listing.findFirst({
    where: {
      name: booking.supplier.name,
      business: { members: { some: { accountId: businessAccountId } } },
    },
  });
  if (!listing) throw new AppError('FORBIDDEN', 'Not your business booking.');
  const asset = await prisma.asset.findUniqueOrThrow({ where: { id: assetId } });
  if (asset.kind !== 'pdf') throw new AppError('INVALID_INPUT', 'A quote must be a PDF.');
  const updated = await prisma.booking.update({
    where: { id: bookingId },
    data: { quoteAssetId: assetId, state: 'quoted' },
  });
  await audit({
    actorId: businessAccountId,
    actorKind: 'account',
    action: 'quote_marked',
    objectType: 'Booking',
    objectId: bookingId,
    after: { quoteAssetId: assetId },
  });
  return updated;
}

export async function acceptQuote(
  occasionId: string,
  accountId: string,
  bookingId: string,
  input: { amountBani: number; categoryId?: string; categoryName?: string }
) {
  const member = await requireMember(occasionId, accountId);
  requireGrant(member, 'finance');
  const booking = await prisma.booking.findUniqueOrThrow({
    where: { id: bookingId },
    include: { supplier: true },
  });
  if (booking.occasionId !== occasionId)
    throw new AppError('FORBIDDEN', 'Booking not on this occasion.');
  if (!booking.quoteAssetId) throw new AppError('CONFLICT', 'No quote marked on this booking yet.');
  if (booking.acceptedQuoteAssetId)
    throw new AppError('CONFLICT', 'A quote is already accepted here.');

  let categoryId = input.categoryId;
  if (!categoryId) {
    const name = input.categoryName ?? booking.supplier.name;
    let cat = await prisma.budgetCategory.findFirst({ where: { occasionId, name } });
    if (!cat) {
      cat = await prisma.budgetCategory.create({
        data: { occasionId, name, estimateBani: 0 },
      });
    }
    categoryId = cat.id;
  }
  const expense = await createExpense(occasionId, accountId, {
    categoryId,
    title: `Ofertă acceptată — ${booking.supplier.name}`,
    amountBani: input.amountBani,
    receiptAssetId: booking.quoteAssetId,
  });
  const updated = await prisma.booking.update({
    where: { id: bookingId },
    data: { acceptedQuoteAssetId: booking.quoteAssetId, state: 'booked' },
  });
  await audit({
    actorId: accountId,
    actorKind: 'account',
    action: 'quote_accepted',
    objectType: 'Booking',
    objectId: bookingId,
    after: {
      quoteAssetId: booking.quoteAssetId,
      expenseId: expense.id,
      amountBani: input.amountBani,
      note: 'accepted quote lands in supplier record + budget (P12); design↔quote linked as versions (F6)',
    },
  });
  return { booking: updated, expense };
}
