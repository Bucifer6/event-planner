import { prisma, type Household, type Invitation } from '@eventdesk/db';
import { AppError, hashToken, newToken } from '@eventdesk/shared';
import * as XLSX from 'xlsx';
import { audit } from './audit';
import { requireMember, requireRole } from './access';

// A6/S6/SEC2: household invitations with scoped, revocable guest links. The token is
// >=128-bit random, stored hashed (SEC8), and a link exposes only its own household.

export async function createHousehold(
  occasionId: string,
  accountId: string,
  input: { name: string; leadEmail?: string; guests: string[] }
) {
  await requireRole(occasionId, accountId, ['owner', 'project_manager', 'workstream_lead']);
  if (!input.name.trim()) throw new AppError('INVALID_INPUT', 'Household name is required.');
  return prisma.$transaction(async (tx) => {
    const household = await tx.household.create({
      data: {
        occasionId,
        name: input.name.trim(),
        leadEmail: input.leadEmail?.trim().toLowerCase() || null,
        guests: {
          create: input.guests
            .map((g) => g.trim())
            .filter(Boolean)
            .map((name) => ({ name })),
        },
      },
      include: { guests: true },
    });
    await tx.auditLog.create({
      data: {
        actorId: accountId,
        actorKind: 'account',
        action: 'household_created',
        objectType: 'Household',
        objectId: household.id,
        after: { name: household.name, guests: household.guests.length },
      },
    });
    return household;
  });
}

export async function listHouseholds(occasionId: string, accountId: string) {
  await requireMember(occasionId, accountId);
  return prisma.household.findMany({
    where: { occasionId },
    include: { guests: true, invitations: { orderBy: { createdAt: 'desc' } } },
    orderBy: { createdAt: 'asc' },
  });
}

export interface CreatedInvitation {
  invitation: Invitation;
  token: string; // raw token, shown once; only its hash is stored
}

export async function createInvitation(
  occasionId: string,
  accountId: string,
  householdId: string,
  locale: 'ro' | 'en' = 'ro'
): Promise<CreatedInvitation> {
  await requireRole(occasionId, accountId, ['owner', 'project_manager', 'workstream_lead']);
  const household = await prisma.household.findFirst({ where: { id: householdId, occasionId } });
  if (!household) throw new AppError('NOT_FOUND', 'Household not found.');
  const token = newToken();
  const invitation = await prisma.invitation.create({
    data: {
      occasionId,
      householdId,
      tokenHash: hashToken(token),
      locale,
      expiryMode: 'never',
    },
  });
  await audit({
    actorId: accountId,
    actorKind: 'account',
    action: 'invitation_created',
    objectType: 'Invitation',
    objectId: invitation.id,
    after: { householdId, locale, last4: token.slice(-4) },
  });
  return { invitation, token };
}

export async function revokeInvitation(
  occasionId: string,
  accountId: string,
  invitationId: string
) {
  await requireRole(occasionId, accountId, ['owner', 'project_manager', 'workstream_lead']);
  const invitation = await prisma.invitation.findFirst({ where: { id: invitationId, occasionId } });
  if (!invitation) throw new AppError('NOT_FOUND', 'Invitation not found.');
  const updated = await prisma.invitation.update({
    where: { id: invitationId },
    data: { revokedAt: new Date() },
  });
  await audit({
    actorId: accountId,
    actorKind: 'account',
    action: 'invitation_revoked',
    objectType: 'Invitation',
    objectId: invitationId,
  });
  return updated;
}

export async function addRsvpQuestion(
  occasionId: string,
  accountId: string,
  input: { kind: string; promptKey: string; required?: boolean }
) {
  await requireRole(occasionId, accountId, ['owner', 'project_manager', 'workstream_lead']);
  const count = await prisma.rsvpQuestion.count({ where: { occasionId } });
  return prisma.rsvpQuestion.create({
    data: {
      occasionId,
      kind: input.kind as never,
      promptKey: input.promptKey,
      required: input.required ?? false,
      sortOrder: count,
    },
  });
}

export async function listRsvpQuestions(occasionId: string, accountId: string) {
  await requireMember(occasionId, accountId);
  return prisma.rsvpQuestion.findMany({ where: { occasionId }, orderBy: { sortOrder: 'asc' } });
}

// A13: guest list import from CSV or XLSX — column-mapping preview, duplicate detection
// by name + household, and a create/change/skip diff applied only after confirmation.

export interface ImportRow {
  name: string;
  household: string;
}

export function parseGuestFile(
  fileName: string,
  data: Buffer
): { headers: string[]; rows: Record<string, string>[] } {
  if (/\.xlsx?$/i.test(fileName)) {
    const wb = XLSX.read(data, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]!]!;
    const rows = XLSX.utils.sheet_to_json<Record<string, string>>(ws, { defval: '' });
    const headers = rows.length ? Object.keys(rows[0]!) : [];
    return { headers, rows };
  }
  const text = data.toString('utf8');
  const { headers, rows } = parseCsv(text);
  return { headers, rows };
}

export function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') {
      record.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      record.push(field);
      field = '';
      if (record.length > 1 || record[0] !== '') records.push(record);
      record = [];
    } else field += c;
  }
  if (field !== '' || record.length) {
    record.push(field);
    records.push(record);
  }
  const headers = (records[0] ?? []).map((h) => h.trim());
  const rows = records.slice(1).map((r) => {
    const row: Record<string, string> = {};
    headers.forEach((h, i) => (row[h] = (r[i] ?? '').trim()));
    return row;
  });
  return { headers, rows };
}

export interface GuestImportDiff {
  create: ImportRow[];
  skip: { name: string; household: string; reason: string }[];
}

export function computeImportDiff(
  existing: { households: { id: string; name: string; guests: { name: string }[] }[] },
  rows: Record<string, string>[],
  mapping: { name: string; household: string }
): GuestImportDiff {
  const diff: GuestImportDiff = { create: [], skip: [] };
  const seen = new Set<string>();
  for (const row of rows) {
    const name = (row[mapping.name] ?? '').trim();
    const household = (row[mapping.household] ?? '').trim() || name;
    if (!name) {
      continue;
    }
    const key = `${household.toLowerCase()}|${name.toLowerCase()}`;
    const existingHousehold = existing.households.find(
      (h) => h.name.toLowerCase() === household.toLowerCase()
    );
    const duplicate =
      seen.has(key) ||
      existingHousehold?.guests.some((g) => g.name.toLowerCase() === name.toLowerCase());
    if (duplicate) {
      diff.skip.push({ name, household, reason: 'duplicate' });
    } else {
      seen.add(key);
      diff.create.push({ name, household });
    }
  }
  return diff;
}

export async function applyGuestImport(
  occasionId: string,
  accountId: string,
  diff: GuestImportDiff
): Promise<{ households: number; guests: number }> {
  await requireRole(occasionId, accountId, ['owner', 'project_manager', 'workstream_lead']);
  return prisma.$transaction(async (tx) => {
    let householdsCreated = 0;
    let guestsCreated = 0;
    const householdCache = new Map<string, string>();
    const existing = await tx.household.findMany({
      where: { occasionId },
      include: { guests: true },
    });
    for (const h of existing) householdCache.set(h.name.toLowerCase(), h.id);
    for (const row of diff.create) {
      let householdId = householdCache.get(row.household.toLowerCase());
      if (!householdId) {
        const h = await tx.household.create({ data: { occasionId, name: row.household } });
        householdId = h.id;
        householdCache.set(row.household.toLowerCase(), h.id);
        householdsCreated++;
      }
      await tx.guest.create({ data: { householdId, name: row.name } });
      guestsCreated++;
    }
    await tx.auditLog.create({
      data: {
        actorId: accountId,
        actorKind: 'account',
        action: 'guests_imported',
        objectType: 'Occasion',
        objectId: occasionId,
        after: { householdsCreated, guestsCreated, skipped: diff.skip.length },
      },
    });
    return { households: householdsCreated, guests: guestsCreated };
  });
}
