import { prisma, type Booking, type Supplier } from '@eventdesk/db';
import { AppError } from '@eventdesk/shared';
import { audit } from './audit';
import { requireGrant, requireMember, requireRole } from './access';

// B4: supplier records with quotes, booking states and versioned briefings the
// supplier acknowledges. B5: final-order snapshots immutable, later guest changes
// produce delta rows. B12: payment deadlines (advance/instalment/final).

const BOOKING_STATES = ['enquired', 'quoted', 'booked', 'completed', 'cancelled'] as const;
type BookingState = (typeof BOOKING_STATES)[number];

export async function createSupplier(
  occasionId: string,
  accountId: string,
  input: { name: string; contactEmail?: string; phone?: string; notes?: string }
): Promise<Supplier> {
  await requireRole(occasionId, accountId, ['owner', 'project_manager', 'workstream_lead']);
  if (!input.name.trim()) throw new AppError('INVALID_INPUT', 'Supplier name is required.');
  return prisma.supplier.create({
    data: {
      occasionId,
      name: input.name.trim(),
      contactEmail: input.contactEmail?.trim().toLowerCase() || null,
      phone: input.phone?.trim() || null,
      notes: input.notes?.trim() || null,
      createdById: accountId,
    },
  });
}

export async function listSuppliers(occasionId: string, accountId: string) {
  await requireMember(occasionId, accountId);
  return prisma.supplier.findMany({
    where: { occasionId },
    include: {
      bookings: {
        include: { briefings: { orderBy: { version: 'desc' } }, snapshots: true, deadlines: true },
      },
    },
    orderBy: { createdAt: 'asc' },
  });
}

export async function createBooking(
  occasionId: string,
  accountId: string,
  supplierId: string,
  title: string
): Promise<Booking> {
  await requireRole(occasionId, accountId, ['owner', 'project_manager', 'workstream_lead']);
  const supplier = await prisma.supplier.findFirst({ where: { id: supplierId, occasionId } });
  if (!supplier) throw new AppError('NOT_FOUND', 'Supplier not found.');
  const booking = await prisma.booking.create({
    data: { supplierId, occasionId, title: title.trim() || supplier.name, createdById: accountId },
  });
  await audit({
    actorId: accountId,
    actorKind: 'account',
    action: 'booking_created',
    objectType: 'Booking',
    objectId: booking.id,
    after: { state: booking.state },
  });
  return booking;
}

export async function setBookingState(
  occasionId: string,
  accountId: string,
  bookingId: string,
  state: BookingState
): Promise<Booking> {
  await requireRole(occasionId, accountId, ['owner', 'project_manager', 'workstream_lead']);
  if (!BOOKING_STATES.includes(state))
    throw new AppError('INVALID_INPUT', 'Unknown booking state.');
  const before = await prisma.booking.findFirst({ where: { id: bookingId, occasionId } });
  if (!before) throw new AppError('NOT_FOUND', 'Booking not found.');
  const updated = await prisma.booking.update({ where: { id: bookingId }, data: { state } });
  await audit({
    actorId: accountId,
    actorKind: 'account',
    action: 'booking_state_changed',
    objectType: 'Booking',
    objectId: bookingId,
    before: { state: before.state },
    after: { state },
  });
  return updated;
}

// Briefing versions are immutable; each new version bumps the counter.
export async function addBriefingVersion(
  occasionId: string,
  accountId: string,
  bookingId: string,
  content: string
) {
  await requireRole(occasionId, accountId, ['owner', 'project_manager', 'workstream_lead']);
  const booking = await prisma.booking.findFirst({ where: { id: bookingId, occasionId } });
  if (!booking) throw new AppError('NOT_FOUND', 'Booking not found.');
  const last = await prisma.briefingVersion.findFirst({
    where: { bookingId },
    orderBy: { version: 'desc' },
  });
  const version = (last?.version ?? 0) + 1;
  const bv = await prisma.briefingVersion.create({
    data: { bookingId, version, content, createdById: accountId },
  });
  await audit({
    actorId: accountId,
    actorKind: 'account',
    action: 'briefing_version_created',
    objectType: 'BriefingVersion',
    objectId: bv.id,
    after: { version },
  });
  return bv;
}

// The supplier acknowledges a briefing through their scoped link (S6).
export async function acknowledgeBriefing(bookingId: string, version: number, by: string) {
  const bv = await prisma.briefingVersion.findUnique({
    where: { bookingId_version: { bookingId, version } },
  });
  if (!bv) throw new AppError('NOT_FOUND', 'Briefing version not found.');
  return prisma.briefingVersion.update({
    where: { id: bv.id },
    data: { acknowledgedAt: new Date(), acknowledgedBy: by },
  });
}

// B5: finalize an order snapshot (immutable once finalized); later changes are deltas.
export async function finalizeSnapshot(
  occasionId: string,
  accountId: string,
  bookingId: string,
  items: unknown
) {
  await requireRole(occasionId, accountId, ['owner', 'project_manager', 'workstream_lead']);
  const booking = await prisma.booking.findFirst({ where: { id: bookingId, occasionId } });
  if (!booking) throw new AppError('NOT_FOUND', 'Booking not found.');
  const last = await prisma.orderSnapshot.findFirst({
    where: { bookingId },
    orderBy: { version: 'desc' },
  });
  const version = (last?.version ?? 0) + 1;
  const snap = await prisma.orderSnapshot.create({
    data: { bookingId, version, items: items as object, finalizedAt: new Date() },
  });
  await audit({
    actorId: accountId,
    actorKind: 'account',
    action: 'order_snapshot_finalized',
    objectType: 'OrderSnapshot',
    objectId: snap.id,
    after: { version },
  });
  return snap;
}

// A later guest change produces a visible delta linked to the snapshot — never a
// silent change to the agreed order (B5, principle 4).
export async function addOrderDelta(
  bookingId: string,
  change: unknown,
  source: 'rsvp_change' | 'manual'
) {
  const snap = await prisma.orderSnapshot.findFirst({
    where: { bookingId, finalizedAt: { not: null } },
    orderBy: { version: 'desc' },
  });
  if (!snap) throw new AppError('CONFLICT', 'No finalized snapshot to delta against.');
  return prisma.orderDelta.create({
    data: { snapshotId: snap.id, change: change as object, source },
  });
}

// B12: advances, instalments, final balances carry due dates.
export async function addPaymentDeadline(
  occasionId: string,
  accountId: string,
  bookingId: string,
  input: {
    kind: 'advance' | 'instalment' | 'final';
    amountBani: number;
    dueAt: Date;
    currency?: string;
  }
) {
  const member = await requireMember(occasionId, accountId);
  requireGrant(member, 'finance');
  const booking = await prisma.booking.findFirst({ where: { id: bookingId, occasionId } });
  if (!booking) throw new AppError('NOT_FOUND', 'Booking not found.');
  const pd = await prisma.paymentDeadline.create({
    data: {
      bookingId,
      kind: input.kind,
      amountBani: input.amountBani,
      currency: input.currency ?? 'RON',
      dueAt: input.dueAt,
    },
  });
  await audit({
    actorId: accountId,
    actorKind: 'account',
    action: 'payment_deadline_created',
    objectType: 'PaymentDeadline',
    objectId: pd.id,
    after: { kind: pd.kind, amountBani: pd.amountBani, dueAt: pd.dueAt },
  });
  return pd;
}

export async function upcomingPayments(occasionId: string, accountId: string, financeOnly = true) {
  const member = await requireMember(occasionId, accountId);
  if (financeOnly) requireGrant(member, 'finance'); // B12: digest raises payments to finance holders only
  return prisma.paymentDeadline.findMany({
    where: { booking: { occasionId }, paidAt: null },
    include: { booking: true },
    orderBy: { dueAt: 'asc' },
  });
}
