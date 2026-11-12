import { prisma } from '@eventdesk/db';
import { AppError, hashIdentifier, now } from '@eventdesk/shared';
import { audit } from './audit';
import { requireMember, requireRole } from './access';

// C-06: public event page with registration, waitlist and conditional questions.
// Registration is bot-protected at the route (SEC11: honeypot + time floor); the
// waitlist promotes ATOMICALLY against the one shared capacity count (A8 pattern):
// a conditional UPDATE whose rowCount decides registered vs waitlist.

export async function setPublicPage(
  occasionId: string,
  accountId: string,
  input: { slug?: string; on: boolean; questions?: unknown }
) {
  await requireRole(occasionId, accountId, ['owner', 'project_manager']);
  let slug =
    input.slug
      ?.trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-') || null;
  if (slug) {
    const taken = await prisma.occasion.findFirst({
      where: { publicSlug: slug, id: { not: occasionId } },
    });
    if (taken) throw new AppError('CONFLICT', 'Slug already used.');
  }
  const occ = await prisma.occasion.update({
    where: { id: occasionId },
    data: {
      publicSlug: slug,
      publicPageOn: input.on,
      publicQuestions: input.questions === undefined ? undefined : (input.questions as object),
    },
  });
  await audit({
    actorId: accountId,
    actorKind: 'account',
    action: input.on ? 'public_page_enabled' : 'public_page_disabled',
    objectType: 'Occasion',
    objectId: occasionId,
    after: { slug },
  });
  return occ;
}

export async function setVenue(
  occasionId: string,
  accountId: string,
  input: { address?: string; mapsUrl?: string }
) {
  await requireRole(occasionId, accountId, ['owner', 'project_manager', 'workstream_lead']);
  return prisma.occasion.update({
    where: { id: occasionId },
    data: { venueAddress: input.address ?? null, venueMapsUrl: input.mapsUrl ?? null },
  });
}

// C-06: public registration. Atomic capacity claim; over capacity -> waitlist.
export async function registerPublic(input: {
  occasionId: string;
  name: string;
  contact: string; // hashed before storage (SEC2)
  answers: unknown;
}) {
  const occ = await prisma.occasion.findUniqueOrThrow({ where: { id: input.occasionId } });
  if (!occ.publicPageOn || !occ.publicSlug)
    throw new AppError('NOT_FOUND', 'Public page not open.');
  if (!input.name.trim()) throw new AppError('INVALID_INPUT', 'Name required.');
  if (!input.contact.trim()) throw new AppError('INVALID_INPUT', 'Contact required.');

  const contactHash = hashIdentifier(input.contact.trim().toLowerCase());
  const dup = await prisma.publicRegistration.findFirst({
    where: { occasionId: occ.id, contactHash },
  });
  if (dup) throw new AppError('CONFLICT', 'Already registered.');

  // A8 pattern: one shared capacity count; conditional UPDATE decides the state
  const claimed =
    occ.capacityTotal == null
      ? 1
      : await prisma.$executeRaw`
        UPDATE "Occasion"
        SET "seatsTaken" = "seatsTaken" + 1
        WHERE id = ${occ.id}
          AND ("capacityTotal" IS NULL OR "seatsTaken" + 1 <= "capacityTotal")
      `;
  const state = claimed === 1 ? 'registered' : 'waitlist';
  const reg = await prisma.publicRegistration.create({
    data: {
      occasionId: occ.id,
      name: input.name.trim(),
      contactHash,
      answers: input.answers as object,
      state,
    },
  });
  await audit({
    actorKind: 'system',
    action: 'public_registration',
    objectType: 'PublicRegistration',
    objectId: reg.id,
    after: { state },
  });
  return reg;
}

// A8: waitlist promotes atomically when capacity frees up (called on RSVP decline).
export async function promoteWaitlist(occasionId: string, freedSeats: number): Promise<number> {
  if (freedSeats <= 0) return 0;
  const waiting = await prisma.publicRegistration.findMany({
    where: { occasionId, state: 'waitlist' },
    orderBy: { createdAt: 'asc' },
    take: freedSeats,
  });
  for (const w of waiting) {
    const claimed = await prisma.$executeRaw`
      UPDATE "Occasion"
      SET "seatsTaken" = "seatsTaken" + 1
      WHERE id = ${occasionId}
        AND ("capacityTotal" IS NULL OR "seatsTaken" + 1 <= "capacityTotal")
    `;
    if (claimed === 1) {
      await prisma.publicRegistration.update({
        where: { id: w.id },
        data: { state: 'registered' },
      });
    }
  }
  return waiting.length;
}

export async function listPublicRegistrations(occasionId: string, accountId: string) {
  await requireMember(occasionId, accountId);
  return prisma.publicRegistration.findMany({
    where: { occasionId },
    orderBy: { createdAt: 'asc' },
  });
}

// C-10: public event page data (no guest identities, no unpublished seating).
export async function getPublicEventPage(slug: string) {
  const occ = await prisma.occasion.findUnique({
    where: { publicSlug: slug },
  });
  if (!occ || !occ.publicPageOn) throw new AppError('NOT_FOUND', 'Event page not found.');
  const [programme, menus, model] = await Promise.all([
    prisma.programmeItem.findMany({
      where: { occasionId: occ.id },
      include: { cues: true },
      orderBy: { startsAt: 'asc' },
    }),
    prisma.menu.findMany({ where: { occasionId: occ.id }, include: { items: true } }),
    prisma.spaceModelVersion.findFirst({
      where: { occasionId: occ.id },
      orderBy: { version: 'desc' },
      include: { drawing: { include: { pois: true, parking: true } } },
    }),
  ]);
  const registrations = await prisma.publicRegistration.count({
    where: { occasionId: occ.id, state: 'registered' },
  });
  void now;
  return {
    occasion: {
      id: occ.id,
      title: occ.title,
      kind: occ.kind,
      dateStart: occ.dateStart,
      dateEnd: occ.dateEnd,
      venueAddress: occ.venueAddress,
      venueMapsUrl: occ.venueMapsUrl, // rendered with rel="noopener noreferrer" (SEC7)
      capacityTotal: occ.capacityTotal,
      seatsTaken: occ.seatsTaken,
      registeredCount: registrations,
      programmeRevision: occ.programmeRevision,
    },
    programme,
    menus,
    spaceView: model
      ? { pois: model.drawing.pois, parking: model.drawing.parking } // V9/V10, read-only for guests
      : null,
  };
}
