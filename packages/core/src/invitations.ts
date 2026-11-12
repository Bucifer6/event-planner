import { prisma } from '@eventdesk/db';
import { AppError, now } from '@eventdesk/shared';
import { audit } from './audit';
import { requireMember, requireRole } from './access';

// C-04: invitation/stationery designer — versioned designs, a proof step before
// send (proofApprovedAt), and a print-ready PDF asset attached per approved version
// (the PDF itself is rendered in the web layer from the same records).

export async function createInvitationDesign(
  occasionId: string,
  accountId: string,
  content: unknown
) {
  await requireRole(occasionId, accountId, ['owner', 'project_manager', 'workstream_lead']);
  const last = await prisma.invitationDesign.findFirst({
    where: { occasionId },
    orderBy: { version: 'desc' },
  });
  const design = await prisma.invitationDesign.create({
    data: {
      occasionId,
      version: (last?.version ?? 0) + 1,
      content: content as object,
      createdById: accountId,
    },
  });
  await audit({
    actorId: accountId,
    actorKind: 'account',
    action: 'invitation_design_created',
    objectType: 'InvitationDesign',
    objectId: design.id,
    after: { version: design.version },
  });
  return design;
}

// C-04: proof step before send — only a proof-approved version may get a print PDF.
export async function approveInvitationProof(
  designId: string,
  occasionId: string,
  accountId: string
) {
  await requireRole(occasionId, accountId, ['owner', 'project_manager']);
  const design = await prisma.invitationDesign.findUniqueOrThrow({ where: { id: designId } });
  if (design.occasionId !== occasionId) throw new AppError('FORBIDDEN', 'Not on this occasion.');
  const updated = await prisma.invitationDesign.update({
    where: { id: designId },
    data: { proofApprovedAt: now() },
  });
  await audit({
    actorId: accountId,
    actorKind: 'account',
    action: 'invitation_proof_approved',
    objectType: 'InvitationDesign',
    objectId: designId,
  });
  return updated;
}

// Attach the rendered print-ready PDF (only after proof approval).
export async function attachInvitationPdf(
  designId: string,
  occasionId: string,
  accountId: string,
  pdfAssetId: string
) {
  await requireRole(occasionId, accountId, ['owner', 'project_manager']);
  const design = await prisma.invitationDesign.findUniqueOrThrow({ where: { id: designId } });
  if (design.occasionId !== occasionId) throw new AppError('FORBIDDEN', 'Not on this occasion.');
  if (!design.proofApprovedAt) {
    throw new AppError('FORBIDDEN', 'Proof must be approved before a print PDF exists (C-04).');
  }
  return prisma.invitationDesign.update({
    where: { id: designId },
    data: { pdfAssetId },
  });
}

export async function listInvitationDesigns(occasionId: string, accountId: string) {
  await requireMember(occasionId, accountId);
  return prisma.invitationDesign.findMany({
    where: { occasionId },
    orderBy: { version: 'desc' },
  });
}
