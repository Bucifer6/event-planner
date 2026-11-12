import { prisma } from '@eventdesk/db';
import { requireMember } from './access';
import { audit } from './audit';

// C-12: promotion pack — generated copy and asset list to EXPORT only. Nothing is
// posted anywhere and nothing is spent automatically; no posting integration exists.

export async function exportPromotionPack(occasionId: string, accountId: string) {
  await requireMember(occasionId, accountId);
  const occ = await prisma.occasion.findUniqueOrThrow({ where: { id: occasionId } });
  const assets = await prisma.asset.findMany({
    where: { occasionId },
    select: { id: true, fileName: true, kind: true },
  });
  const date = occ.dateStart ? occ.dateStart.toISOString().slice(0, 10) : 'data în curând';
  const copyRo = [
    `${occ.title} — ${date}`,
    occ.venueAddress ? `Locație: ${occ.venueAddress}` : 'Locație: de confirmat',
    'Detalii și răspunsuri prin linkul invitației.',
  ].join('\n');
  const copyEn = [
    `${occ.title} — ${date}`,
    occ.venueAddress ? `Venue: ${occ.venueAddress}` : 'Venue: to be confirmed',
    'Details and RSVPs via your invitation link.',
  ].join('\n');
  await audit({
    actorId: accountId,
    actorKind: 'account',
    action: 'promotion_pack_exported',
    objectType: 'Occasion',
    objectId: occasionId,
    after: { assets: assets.length, exportOnly: true },
  });
  return {
    exportOnly: true, // C-12: nothing posted or spent automatically
    copyRo,
    copyEn,
    assets,
  };
}

// C-09: print pack data assembly — QR targets resolve to scoped views only:
// invitation QRs -> the guest's own invitation link; table-card QRs -> the guest
// event page. The PDF is rendered in the web layer from these records.
export async function assemblePrintPack(occasionId: string, accountId: string) {
  await requireMember(occasionId, accountId);
  const occ = await prisma.occasion.findUniqueOrThrow({ where: { id: occasionId } });
  const invitations = await prisma.invitation.findMany({
    where: { occasionId, revokedAt: null },
    include: { household: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'asc' },
  });
  const plan = await prisma.seatingPlan.findFirst({
    where: { occasionId, published: true },
    orderBy: { version: 'desc' },
    include: { assignments: true },
  });
  const model = await prisma.spaceModelVersion.findFirst({
    where: { occasionId },
    orderBy: { version: 'desc' },
    include: {
      drawing: { include: { tables: true, fixtures: true, parking: true } },
      customTables: true,
    },
  });
  return {
    occasion: { id: occ.id, title: occ.title, publicSlug: occ.publicSlug },
    invitations: invitations.map((i) => ({
      invitationId: i.id,
      qrId: i.qrId,
      household: i.household.name,
    })),
    tableCards: (plan?.assignments ?? []).map((a) => ({
      householdId: a.householdId,
      tableRef: a.tableRef,
    })),
    roomPlan: model
      ? {
          pixelsPerMeter: model.drawing.pixelsPerMeter,
          tables: model.drawing.tables.map((t) => ({
            tableType: t.tableType,
            count: t.count,
            widthM: t.widthM,
            heightM: t.heightM,
          })),
          customTables: model.customTables.map((t) => ({
            name: t.name,
            widthM: t.widthM,
            heightM: t.heightM,
          })),
          fixtures: model.drawing.fixtures.map((f) => ({
            kind: f.kind,
            widthM: f.widthM,
            heightM: f.heightM,
          })),
          parking: model.drawing.parking,
        }
      : null,
  };
}
