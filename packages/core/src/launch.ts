import { prisma } from '@eventdesk/db';
import { AppError } from '@eventdesk/shared';
import { audit } from './audit';
import { requireStaff } from './staff';

// v1.0.0 production readiness:
// LAU5 incident log (console-managed; active incidents surface as a plain-language
// message on guest-facing pages), LAU9 accessibility-statement record in the console
// (PlatformSetting), and the LAU1 cookie-set signature the in-app notice is keyed on.

// LAU1: the in-app cookie notice lists exactly these three cookies (session, device
// rate-limit per SEC16, language preference) — none used for tracking (D1). The notice
// is acknowledged in localStorage keyed by this signature, so it is re-shown only when
// the cookie set changes.
export const COOKIE_NAMES = ['ed_session', 'ed_device', 'ed_lang'] as const;
export const COOKIE_SET_SIGNATURE = 'lau1-v1:' + COOKIE_NAMES.join('|');

// ---------- LAU5 incidents ----------

// Public, no auth: guest-facing pages show at most one active incident banner.
export async function getActiveIncident() {
  return prisma.incident.findFirst({
    where: { status: { not: 'resolved' } },
    orderBy: { startedAt: 'desc' },
  });
}

export async function listIncidents(accountId: string) {
  await requireStaff(accountId);
  return prisma.incident.findMany({ orderBy: { startedAt: 'desc' } });
}

export async function createIncident(accountId: string, input: { title: string; impact: string }) {
  await requireStaff(accountId, 'security_administrator');
  if (!input.title.trim() || !input.impact.trim()) {
    throw new AppError('INVALID_INPUT', 'Title and plain-language impact required.');
  }
  const incident = await prisma.incident.create({
    data: {
      title: input.title.trim(),
      impact: input.impact.trim(),
      createdById: accountId,
    },
  });
  await audit({
    actorId: accountId,
    actorKind: 'account',
    action: 'incident_opened',
    objectType: 'Incident',
    objectId: incident.id,
    after: { title: incident.title, status: incident.status },
  });
  return incident;
}

export async function updateIncident(
  accountId: string,
  incidentId: string,
  input: { status?: 'investigating' | 'monitoring' | 'resolved'; impact?: string }
) {
  await requireStaff(accountId, 'security_administrator');
  const before = await prisma.incident.findUniqueOrThrow({ where: { id: incidentId } });
  const status = input.status ?? before.status;
  const incident = await prisma.incident.update({
    where: { id: incidentId },
    data: {
      status,
      impact: input.impact?.trim() || before.impact,
      resolvedAt: status === 'resolved' ? new Date() : before.resolvedAt,
    },
  });
  await audit({
    actorId: accountId,
    actorKind: 'account',
    action: 'incident_updated',
    objectType: 'Incident',
    objectId: incident.id,
    before: { status: before.status },
    after: { status: incident.status },
  });
  return incident;
}

// ---------- LAU9 console records (PlatformSetting) ----------

export async function setPlatformSetting(accountId: string, key: string, value: unknown) {
  await requireStaff(accountId);
  if (!key.trim()) throw new AppError('INVALID_INPUT', 'Key required.');
  const setting = await prisma.platformSetting.upsert({
    where: { key },
    create: { key, value: value as object, updatedBy: accountId },
    update: { value: value as object, updatedBy: accountId },
  });
  await audit({
    actorId: accountId,
    actorKind: 'account',
    action: 'platform_setting_set',
    objectType: 'PlatformSetting',
    objectId: key,
    after: { value },
  });
  return setting;
}

export async function getPlatformSetting(accountId: string, key: string) {
  await requireStaff(accountId);
  return prisma.platformSetting.findUnique({ where: { key } });
}

// LAU9: the accessibility statement's date and evaluation method, recorded in the console.
export async function recordAccessibilityStatement(
  accountId: string,
  input: { statementDate: string; evaluationMethod: string }
) {
  if (!input.statementDate || !input.evaluationMethod.trim()) {
    throw new AppError('INVALID_INPUT', 'Statement date and evaluation method required.');
  }
  return setPlatformSetting(accountId, 'accessibility_statement', {
    statementDate: input.statementDate,
    evaluationMethod: input.evaluationMethod.trim(),
    standard: 'WCAG 2.2 AA (Q2)',
  });
}
