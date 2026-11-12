import { prisma } from '@eventdesk/db';
import { AppError, now } from '@eventdesk/shared';
import { audit } from './audit';
import { requireMember, requireRole } from './access';
import { resolveInvitationByQr } from './rsvp';

// Release E — rehearse and operate complex occasions.
// E-01 rehearsal simulation is read-only (principle 3): conflicts are flagged, nothing
// is persisted. E-02 QR check-in marks arrival via an audited correction (principle 4)
// and estimates guest flow from aggregates only (Q5). E-03 limited offline capture —
// arrivals and own checklist ticks only — reconciled once on reconnect (Q4); conflicts
// are surfaced, never silently merged. E-04 sustainability goals tracked against
// measured quantities; unknown stays unknown (principle 5).

// ---------- E-01 rehearsal simulation (read-only, principle 3) ----------

export interface SimStep {
  atUtc: Date;
  endUtc: Date | null;
  kind: 'programme' | 'itinerary' | 'transport' | 'activity' | 'task_due';
  refId: string;
  title: string;
}

export interface SimConflict {
  type: 'overlap' | 'task_due_during' | 'room_over_capacity';
  message: string;
  refs: string[];
}

// Step through the day as it is recorded: programme items, itinerary legs, transport
// legs, optional activities and task due times merged into one UTC timeline. Overlaps
// and tasks falling inside a block are flagged. This function only reads — nothing is
// persisted (principle 3).
export async function simulateDay(
  occasionId: string,
  accountId: string
): Promise<{ steps: SimStep[]; conflicts: SimConflict[] }> {
  await requireMember(occasionId, accountId);
  const [programme, legs, transports, activities, tasks, rooms] = await Promise.all([
    prisma.programmeItem.findMany({ where: { occasionId } }),
    prisma.itineraryLeg.findMany({ where: { occasionId } }),
    prisma.transportLeg.findMany({ where: { occasionId } }),
    prisma.activity.findMany({ where: { occasionId } }),
    prisma.task.findMany({ where: { occasionId, dueAt: { not: null } } }),
    prisma.room.findMany({ where: { occasionId }, include: { assignments: true } }),
  ]);

  const steps: SimStep[] = [];
  for (const p of programme) {
    if (!p.startsAt) continue;
    const end = p.durationMin ? new Date(p.startsAt.getTime() + p.durationMin * 60000) : null;
    steps.push({
      atUtc: p.startsAt,
      endUtc: end,
      kind: 'programme',
      refId: p.id,
      title: p.title,
    });
  }
  for (const l of legs) {
    steps.push({
      atUtc: l.startsAtUtc,
      endUtc: l.endsAtUtc,
      kind: 'itinerary',
      refId: l.id,
      title: l.title,
    });
  }
  for (const t of transports) {
    steps.push({
      atUtc: t.departsAtUtc,
      endUtc: null,
      kind: 'transport',
      refId: t.id,
      title: `${t.label}: ${t.fromPlace} → ${t.toPlace}`,
    });
  }
  for (const a of activities) {
    steps.push({
      atUtc: a.startsAtUtc,
      endUtc: null,
      kind: 'activity',
      refId: a.id,
      title: a.title,
    });
  }
  for (const t of tasks) {
    if (!t.dueAt) continue;
    steps.push({
      atUtc: t.dueAt,
      endUtc: null,
      kind: 'task_due',
      refId: t.id,
      title: t.title,
    });
  }
  steps.sort((a, b) => a.atUtc.getTime() - b.atUtc.getTime());

  const conflicts: SimConflict[] = [];
  const timed = steps.filter((s) => s.endUtc !== null);
  for (let i = 0; i < timed.length; i++) {
    for (let j = i + 1; j < timed.length; j++) {
      const a = timed[i]!;
      const b = timed[j]!;
      if (b.atUtc.getTime() >= a.endUtc!.getTime()) break; // sorted; no further overlap with a
      if (a.atUtc.getTime() < b.endUtc!.getTime()) {
        conflicts.push({
          type: 'overlap',
          message: `"${a.title}" overlaps "${b.title}"`,
          refs: [a.refId, b.refId],
        });
      }
    }
  }
  const blocks = timed;
  for (const t of steps.filter((s) => s.kind === 'task_due')) {
    const inside = blocks.find(
      (b) => b.refId !== t.refId && t.atUtc >= b.atUtc && t.atUtc < b.endUtc!
    );
    if (inside) {
      conflicts.push({
        type: 'task_due_during',
        message: `Task "${t.title}" is due during "${inside.title}"`,
        refs: [t.refId, inside.refId],
      });
    }
  }
  for (const r of rooms) {
    if (r.occupants > r.capacity) {
      conflicts.push({
        type: 'room_over_capacity',
        message: `Room "${r.name}" has ${r.occupants} occupants over capacity ${r.capacity}`,
        refs: [r.id],
      });
    }
  }
  return { steps, conflicts };
}

// ---------- E-02 QR check-in (audited correction, principle 4) + flow estimates (Q5) ----------

// The qrId from a printed invitation (C-09) is the scoped credential. Scanning marks
// the household's arrival via a Correction row + AuditLog (principle 4). Idempotent
// per household (Q4): a double scan returns the existing arrival.
export async function checkInByQr(qrId: string, accountId: string) {
  const invitation = await resolveInvitationByQr(qrId); // NOT_FOUND if revoked/expired
  await requireMember(invitation.occasionId, accountId);
  const occasionId = invitation.occasionId;
  const householdId = invitation.householdId;
  return prisma.$transaction(async (tx) => {
    const existing = await tx.checkIn.findUnique({
      where: { occasionId_householdId: { occasionId, householdId } },
    });
    if (existing) return { checkIn: existing, alreadyCheckedIn: true };
    const correction = await tx.correction.create({
      data: {
        targetType: 'Household',
        targetId: householdId,
        field: 'arrival',
        before: { checkedIn: false },
        after: { checkedIn: true, qrId },
        actorId: accountId,
        reason: 'QR check-in (E-02)',
      },
    });
    const checkIn = await tx.checkIn.create({
      data: {
        occasionId,
        householdId,
        qrId,
        actorId: accountId,
        via: 'qr',
        correctionId: correction.id,
      },
    });
    await tx.auditLog.create({
      data: {
        actorId: accountId,
        actorKind: 'account',
        action: 'guest_checked_in',
        objectType: 'CheckIn',
        objectId: checkIn.id,
        before: { checkedIn: false },
        after: { householdId, via: 'qr' },
      },
    });
    return { checkIn, alreadyCheckedIn: false };
  });
}

export async function listArrivals(occasionId: string, accountId: string) {
  await requireMember(occasionId, accountId);
  return prisma.checkIn.findMany({
    where: { occasionId },
    include: { household: { select: { name: true } } },
    orderBy: { checkedInAt: 'asc' },
  });
}

// Q5: guest-flow estimates from aggregates only — counts and time buckets, never
// individual-level data beyond the household the caller already manages.
export async function guestFlowEstimates(occasionId: string, accountId: string) {
  await requireMember(occasionId, accountId);
  const occasion = await prisma.occasion.findUniqueOrThrow({ where: { id: occasionId } });
  const expectedAttending = await prisma.rsvpPersonAttendance.count({
    where: { attending: true, response: { household: { occasionId } } },
  });
  const checkIns = await prisma.checkIn.findMany({
    where: { occasionId },
    select: { checkedInAt: true },
    orderBy: { checkedInAt: 'asc' },
  });
  const checkedIn = checkIns.length;
  const BUCKET_MS = 30 * 60 * 1000;
  const buckets: { atUtc: Date; count: number; cumulative: number }[] = [];
  if (checkIns.length > 0) {
    const first = checkIns[0]!.checkedInAt.getTime();
    const map = new Map<number, number>();
    for (const c of checkIns) {
      const k = first + Math.floor((c.checkedInAt.getTime() - first) / BUCKET_MS) * BUCKET_MS;
      map.set(k, (map.get(k) ?? 0) + 1);
    }
    let cumulative = 0;
    for (const [k, count] of [...map.entries()].sort((a, b) => a[0] - b[0])) {
      cumulative += count;
      buckets.push({ atUtc: new Date(k), count, cumulative });
    }
  }
  // simple projection: arrivals so far spread at the observed rate over the remaining
  // time until the occasion end, capped at the RSVP-expected attending count
  let projectedTotal: number | null = null;
  if (checkIns.length > 0 && occasion.dateEnd && occasion.dateEnd > now()) {
    const first = checkIns[0]!.checkedInAt.getTime();
    const spanHours = Math.max((now().getTime() - first) / 3_600_000, 1 / 60);
    const ratePerHour = checkedIn / spanHours;
    const remainingHours = (occasion.dateEnd.getTime() - now().getTime()) / 3_600_000;
    projectedTotal = Math.min(
      Math.round(checkedIn + ratePerHour * remainingHours),
      Math.max(expectedAttending, checkedIn)
    );
  }
  return {
    expectedAttending,
    checkedIn,
    notArrived: Math.max(expectedAttending - checkedIn, 0),
    buckets,
    projectedTotal,
  };
}

// ---------- E-03 limited offline capture, reconciled once on reconnect (Q4) ----------

const OFFLINE_KINDS = ['arrival', 'checklist_tick'] as const;
type OfflineKind = (typeof OFFLINE_KINDS)[number];

async function validateOfflinePayload(
  occasionId: string,
  accountId: string,
  kind: string,
  payload: unknown
): Promise<void> {
  if (!OFFLINE_KINDS.includes(kind as OfflineKind)) {
    throw new AppError('INVALID_INPUT', 'Offline kind must be arrival or checklist_tick.');
  }
  const p = payload as Record<string, unknown>;
  if (kind === 'arrival') {
    if (typeof p?.qrId !== 'string' || !p.qrId) {
      throw new AppError('INVALID_INPUT', 'arrival payload needs qrId.');
    }
    const invitation = await prisma.invitation.findUnique({ where: { qrId: p.qrId } });
    if (!invitation || invitation.occasionId !== occasionId) {
      throw new AppError('INVALID_INPUT', 'qrId does not belong to this occasion.');
    }
    return;
  }
  // checklist_tick: own checklist ticks only — the task must be on this occasion and
  // owned by this account's occasion member row
  if (typeof p?.checkItemId !== 'string' || typeof p?.done !== 'boolean') {
    throw new AppError('INVALID_INPUT', 'checklist_tick payload needs checkItemId and done.');
  }
  const item = await prisma.taskCheckItem.findUnique({
    where: { id: p.checkItemId },
    include: { task: { include: { owner: true } } },
  });
  if (!item || item.task.occasionId !== occasionId) {
    throw new AppError('NOT_FOUND', 'Checklist item not on this occasion.');
  }
  if (!item.task.owner || item.task.owner.accountId !== accountId) {
    throw new AppError('FORBIDDEN', 'Offline ticks allowed only on your own checklist items.');
  }
}

// Queue an offline capture. The (occasionId, clientKey) unique key makes a replayed
// queue entry idempotent (Q4) — the same clientKey returns the existing row.
export async function queueOfflineItem(
  occasionId: string,
  accountId: string,
  input: { clientKey: string; kind: string; payload: unknown }
) {
  await requireMember(occasionId, accountId);
  if (!input.clientKey.trim()) throw new AppError('INVALID_INPUT', 'clientKey required.');
  await validateOfflinePayload(occasionId, accountId, input.kind, input.payload);
  const existing = await prisma.offlineSyncItem.findUnique({
    where: { occasionId_clientKey: { occasionId, clientKey: input.clientKey } },
  });
  if (existing) return existing;
  return prisma.offlineSyncItem.create({
    data: {
      occasionId,
      clientKey: input.clientKey,
      kind: input.kind,
      payload: input.payload as object,
      actorId: accountId,
    },
  });
}

export async function listOfflineQueue(occasionId: string, accountId: string) {
  await requireMember(occasionId, accountId);
  return prisma.offlineSyncItem.findMany({
    where: { occasionId },
    orderBy: { createdAtUtc: 'asc' },
  });
}

// Reconcile the offline queue once on reconnect (Q4). Each pending item transitions
// pending -> applied|conflict exactly once inside a transaction; a second run finds no
// pending rows and changes nothing. Conflicts are surfaced in `result` and never
// silently merged.
export async function reconcileOfflineQueue(occasionId: string, accountId: string) {
  await requireMember(occasionId, accountId);
  const pending = await prisma.offlineSyncItem.findMany({
    where: { occasionId, state: 'pending' },
    orderBy: { createdAtUtc: 'asc' },
  });
  const applied: string[] = [];
  const conflicts: { id: string; reason: string }[] = [];
  for (const item of pending) {
    const outcome = await prisma.$transaction(async (tx) => {
      const row = await tx.offlineSyncItem.findUnique({ where: { id: item.id } });
      if (!row || row.state !== 'pending') return null; // reconciled already (Q4)
      const payload = row.payload as Record<string, unknown>;
      if (row.kind === 'arrival') {
        const invitation = await tx.invitation.findUnique({
          where: { qrId: String(payload.qrId) },
        });
        if (!invitation || invitation.occasionId !== occasionId || invitation.revokedAt) {
          return { state: 'conflict', result: { reason: 'qr_invalid_or_revoked' } };
        }
        const existing = await tx.checkIn.findUnique({
          where: {
            occasionId_householdId: {
              occasionId,
              householdId: invitation.householdId,
            },
          },
        });
        if (existing) {
          // same fact already recorded (e.g. scanned directly meanwhile) — idempotent
          return { state: 'applied', result: { alreadyCheckedIn: true, checkInId: existing.id } };
        }
        const correction = await tx.correction.create({
          data: {
            targetType: 'Household',
            targetId: invitation.householdId,
            field: 'arrival',
            before: { checkedIn: false },
            after: { checkedIn: true, qrId: String(payload.qrId) },
            actorId: row.actorId,
            reason: 'Offline arrival reconciled (E-03)',
          },
        });
        const checkIn = await tx.checkIn.create({
          data: {
            occasionId,
            householdId: invitation.householdId,
            qrId: String(payload.qrId),
            actorId: row.actorId,
            via: 'offline_reconciled',
            correctionId: correction.id,
          },
        });
        await tx.auditLog.create({
          data: {
            actorId: row.actorId,
            actorKind: 'account',
            action: 'guest_checked_in',
            objectType: 'CheckIn',
            objectId: checkIn.id,
            before: { checkedIn: false },
            after: { householdId: invitation.householdId, via: 'offline_reconciled' },
          },
        });
        return { state: 'applied', result: { checkInId: checkIn.id } };
      }
      // checklist_tick: apply only if the task has not been touched server-side since
      // the offline capture; otherwise surface the divergence instead of merging.
      const checkItem = await tx.taskCheckItem.findUnique({
        where: { id: String(payload.checkItemId) },
        include: { task: true },
      });
      if (!checkItem || checkItem.task.occasionId !== occasionId) {
        return { state: 'conflict', result: { reason: 'check_item_gone' } };
      }
      const done = Boolean(payload.done);
      if (checkItem.done === done) {
        return { state: 'applied', result: { already: true } };
      }
      if (checkItem.task.updatedAt > row.createdAtUtc) {
        return {
          state: 'conflict',
          result: {
            reason: 'changed_since_capture',
            captured: done,
            server: checkItem.done,
          },
        };
      }
      await tx.taskCheckItem.update({ where: { id: checkItem.id }, data: { done } });
      await tx.auditLog.create({
        data: {
          actorId: row.actorId,
          actorKind: 'account',
          action: 'check_item_toggled',
          objectType: 'TaskCheckItem',
          objectId: checkItem.id,
          before: { done: checkItem.done },
          after: { done, via: 'offline_reconciled' },
        },
      });
      return { state: 'applied', result: { done } };
    });
    if (!outcome) continue;
    await prisma.offlineSyncItem.update({
      where: { id: item.id },
      data: { state: outcome.state, result: outcome.result as object },
    });
    if (outcome.state === 'applied') applied.push(item.id);
    else conflicts.push({ id: item.id, reason: (outcome.result as { reason: string }).reason });
  }
  return { applied, conflicts };
}

// ---------- E-04 sustainability goals vs measured quantities (principle 5) ----------

// Metrics are lower-is-better quantities (waste, km, single-use items).
export async function setSustainabilityGoal(
  occasionId: string,
  accountId: string,
  input: { metric: string; unit: string; target?: number | null }
) {
  await requireRole(occasionId, accountId, ['owner', 'project_manager', 'workstream_lead']);
  const metric = input.metric.trim();
  const unit = input.unit.trim();
  if (!metric || !unit) throw new AppError('INVALID_INPUT', 'metric and unit required.');
  if (input.target !== undefined && input.target !== null && !(input.target >= 0)) {
    throw new AppError('INVALID_INPUT', 'target must be a non-negative number or null.');
  }
  const goal = await prisma.sustainabilityGoal.upsert({
    where: { occasionId_metric: { occasionId, metric } },
    create: {
      occasionId,
      metric,
      unit,
      target: input.target ?? null,
    },
    update: { unit, target: input.target ?? null },
  });
  await audit({
    actorId: accountId,
    actorKind: 'account',
    action: 'sustainability_goal_set',
    objectType: 'SustainabilityGoal',
    objectId: goal.id,
    after: { metric, unit, target: goal.target },
  });
  return goal;
}

// Record a measured quantity. value = null records "unknown" — unknown stays unknown
// (principle 5) and is never treated as zero or as meeting the target.
export async function recordMeasurement(
  occasionId: string,
  accountId: string,
  input: { metric: string; value: number | null }
) {
  await requireMember(occasionId, accountId);
  const goal = await prisma.sustainabilityGoal.findUnique({
    where: { occasionId_metric: { occasionId, metric: input.metric.trim() } },
  });
  if (!goal) throw new AppError('NOT_FOUND', 'No sustainability goal for this metric yet.');
  if (input.value !== null && !(input.value >= 0)) {
    throw new AppError('INVALID_INPUT', 'measured must be a non-negative number or null.');
  }
  const updated = await prisma.sustainabilityGoal.update({
    where: { id: goal.id },
    data: { measured: input.value },
  });
  await audit({
    actorId: accountId,
    actorKind: 'account',
    action: 'sustainability_measured',
    objectType: 'SustainabilityGoal',
    objectId: goal.id,
    after: { metric: goal.metric, measured: input.value },
  });
  return updated;
}

export async function listSustainability(occasionId: string, accountId: string) {
  await requireMember(occasionId, accountId);
  const goals = await prisma.sustainabilityGoal.findMany({
    where: { occasionId },
    orderBy: { createdAt: 'asc' },
  });
  return goals.map((g) => ({
    ...g,
    // principle 5: unknown is its own status, never counted as fitting the goal
    status:
      g.measured === null
        ? ('unknown' as const)
        : g.target === null
          ? ('measured' as const)
          : g.measured <= g.target
            ? ('on_track' as const)
            : ('behind' as const),
  }));
}
