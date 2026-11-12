import { prisma, type Invitation } from '@eventdesk/db';
import { AppError, hashToken, now } from '@eventdesk/shared';
import { getGuestSeat } from './seating';
import { assertHuman } from '@eventdesk/auth';
import { audit } from './audit';
import { looksLikeChildData } from './childcheck';

// A6/A8/SEC2: scoped guest link — only its own household's view, >=128-bit hashed token,
// individually revocable, optional expiry, per-link rate limit, atomic capacity.

export class GuestLinkError extends AppError {}

export async function resolveInvitation(token: string) {
  const invitation = await prisma.invitation.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { household: { include: { guests: true } }, occasion: true },
  });
  if (!invitation) throw new GuestLinkError('NOT_FOUND', 'Link invalid.');
  if (invitation.revokedAt) throw new GuestLinkError('LINK_REVOKED', 'This link was revoked.');
  if (invitation.expiresAt && invitation.expiresAt < now()) {
    throw new GuestLinkError('LINK_EXPIRED', 'This link has expired.');
  }
  return invitation;
}

// The guest view: household, its members, RSVP questions one at a time, poll state,
// and the "changed since your last visit" marker (INF5).
// C-09: printed-invitation QR resolves through the scoped qrId (the raw token stays
// hashed, SEC2). The QR id grants exactly the same single-household view as the link.
export async function resolveInvitationByQr(qrId: string) {
  const invitation = await prisma.invitation.findUnique({
    where: { qrId },
    include: { household: { include: { guests: true } }, occasion: true },
  });
  if (
    !invitation ||
    invitation.revokedAt ||
    (invitation.expiresAt && invitation.expiresAt < now())
  ) {
    throw new AppError('NOT_FOUND', 'Invitation not valid.');
  }
  return invitation;
}

export async function getGuestViewByQr(qrId: string) {
  const invitation = await resolveInvitationByQr(qrId);
  return getGuestViewByInvitation(invitation);
}

export async function getGuestView(token: string) {
  const invitation = await resolveInvitation(token);
  return getGuestViewByInvitation(invitation);
}

async function getGuestViewByInvitation(invitation: Awaited<ReturnType<typeof resolveInvitation>>) {
  const questions = await prisma.rsvpQuestion.findMany({
    where: { occasionId: invitation.occasionId },
    orderBy: { sortOrder: 'asc' },
  });
  const polls = await prisma.datePoll.findMany({
    where: { occasionId: invitation.occasionId },
    include: { votes: { where: { invitationId: invitation.id } } },
  });
  const lastResponse = await prisma.rsvpResponse.findFirst({
    where: { invitationId: invitation.id },
    orderBy: { submittedAt: 'desc' },
  });
  const changedSinceLastVisit =
    !!lastResponse && invitation.occasion.revision > lastResponse.lastSeenRevision;
  // C-08: the guest's own table/seat appears only when the seating plan is published;
  // unpublished seating is never visible to guests.
  const seat = await getGuestSeat(invitation.occasionId, invitation.householdId);
  return {
    invitation,
    household: invitation.household,
    occasion: invitation.occasion,
    questions,
    polls,
    lastResponse,
    changedSinceLastVisit,
    seat,
  };
}

export async function markGuestSeen(token: string): Promise<void> {
  const invitation = await resolveInvitation(token);
  await prisma.rsvpResponse.updateMany({
    where: { invitationId: invitation.id },
    data: { lastSeenRevision: invitation.occasion.revision },
  });
}

export interface RsvpSubmission {
  token: string;
  adults: number;
  childrenCount: number; // count only — never child details (A6)
  attendance: Record<string, boolean>; // guestId -> attending (per session, A6)
  answers: { questionId: string; value: string }[];
  leadEmail?: string; // captured at RSVP for change notifications (INF5)
  ip: string;
  honeypot?: string | null;
  formShownAt?: number;
}

export async function submitRsvp(input: RsvpSubmission) {
  // SEC11: bot protection on the public form — per-IP + per-link limits, honeypot,
  // time-to-submit floor; throttled clients get a retry time, never a silent failure.
  await assertHuman({
    ip: input.ip,
    linkKey: hashToken(input.token),
    honeypot: input.honeypot,
    formShownAt: input.formShownAt,
  });

  const invitation = await resolveInvitation(input.token);
  const occasionId = invitation.occasionId;

  const seats = Math.max(0, input.adults) + Math.max(0, input.childrenCount);
  if (seats <= 0) throw new AppError('INVALID_INPUT', 'At least one person must attend.');

  // A8: one capacity count shared by invited and public guests; two people cannot take
  // the last place — conditional UPDATE, rowCount 0 means "taken".
  const claimed = await prisma.$executeRaw`
    UPDATE "Occasion"
    SET "seatsTaken" = "seatsTaken" + ${seats},
        "revision" = "revision" + 1
    WHERE id = ${occasionId}
      AND ("capacityTotal" IS NULL OR "seatsTaken" + ${seats} <= "capacityTotal")
  `;
  if (claimed === 0) {
    throw new AppError('CAPACITY_TAKEN', 'The last place was just taken by someone else.');
  }

  const flaggedAnswers = input.answers.map((a) => ({
    ...a,
    childDataFlagged: looksLikeChildData(a.value),
  }));

  const response = await prisma.$transaction(async (tx) => {
    const r = await tx.rsvpResponse.create({
      data: {
        invitationId: invitation.id,
        householdId: invitation.householdId,
        adults: Math.max(0, input.adults),
        childrenCount: Math.max(0, input.childrenCount),
        lastSeenRevision: invitation.occasion.revision,
      },
    });
    for (const [guestId, attending] of Object.entries(input.attendance)) {
      const guest = await tx.guest.findFirst({
        where: { id: guestId, householdId: invitation.householdId },
      });
      if (guest) {
        await tx.rsvpPersonAttendance.upsert({
          where: { responseId_guestId: { responseId: r.id, guestId } },
          update: { attending },
          create: { responseId: r.id, guestId, attending },
        });
      }
    }
    for (const a of flaggedAnswers) {
      await tx.rsvpAnswer.create({
        data: {
          responseId: r.id,
          questionId: a.questionId,
          value: a.value,
          childDataFlagged: a.childDataFlagged,
        },
      });
    }
    if (input.leadEmail) {
      await tx.household.update({
        where: { id: invitation.householdId },
        data: { leadEmail: input.leadEmail.trim().toLowerCase() },
      });
    }
    await tx.auditLog.create({
      data: {
        actorId: null,
        actorKind: 'system',
        action: 'rsvp_submitted',
        objectType: 'Invitation',
        objectId: invitation.id,
        after: { adults: r.adults, childrenCount: r.childrenCount, answers: flaggedAnswers.length },
      },
    });
    return r;
  });
  return {
    response,
    childDataWarnings: flaggedAnswers.filter((a) => a.childDataFlagged).map((a) => a.questionId),
  };
}
