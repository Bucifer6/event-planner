import { prisma } from '@eventdesk/db';
import { audit } from './audit';

// C-11: gift estimator (calculator dar) — a PRIVATE per-planner range suggestion from
// a few questions (relationship, distance, venue type). Labelled a cultural guide; no
// data shared across planners, no guest sees another's amount, free forever, not part
// of any paid tier. The heuristic is intentionally simple and transparent.

const RELATIONSHIP_FACTOR: Record<string, number> = {
  family_close: 1.6,
  family: 1.3,
  friend_close: 1.2,
  friend: 1.0,
  colleague: 0.7,
  acquaintance: 0.5,
};
const DISTANCE_FACTOR: Record<string, number> = {
  local: 0.8,
  national: 1.0,
  international: 1.4,
};
const VENUE_FACTOR: Record<string, number> = {
  restaurant: 1.2,
  venue_hall: 1.5,
  home: 0.7,
  other: 1.0,
};
const BASE_BANI = 250_00; // 250 RON reference point

export async function estimateGift(
  accountId: string,
  input: { relationship: string; distance: string; venueType: string; guestCount: number }
) {
  const factor =
    (RELATIONSHIP_FACTOR[input.relationship] ?? 1.0) *
    (DISTANCE_FACTOR[input.distance] ?? 1.0) *
    (VENUE_FACTOR[input.venueType] ?? 1.0);
  const perGuest = Math.round(BASE_BANI * factor);
  const guests = Math.max(1, input.guestCount || 1);
  const rangeMinBani = perGuest * guests;
  const rangeMaxBani = Math.round(rangeMinBani * 1.4);
  const est = await prisma.giftEstimate.create({
    data: {
      accountId,
      inputs: input as object,
      rangeMinBani,
      rangeMaxBani,
    },
  });
  await audit({
    actorId: accountId,
    actorKind: 'account',
    action: 'gift_estimate_created',
    objectType: 'GiftEstimate',
    objectId: est.id,
    after: { note: 'private per-planner cultural guide; not shared (C-11)' },
  });
  return est;
}

// Private to the planner: only their own estimates are ever listed.
export async function listGiftEstimates(accountId: string) {
  return prisma.giftEstimate.findMany({
    where: { accountId },
    orderBy: { createdAt: 'desc' },
  });
}
