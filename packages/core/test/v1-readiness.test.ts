import { describe, expect, it } from 'vitest';
import { prisma } from '@eventdesk/db';
import { assertBootEnv, missingEnv } from '@eventdesk/shared';
import {
  COOKIE_NAMES,
  COOKIE_SET_SIGNATURE,
  createIncident,
  fileContentReport,
  getActiveIncident,
  getPlatformSetting,
  listIncidents,
  recordAccessibilityStatement,
  updateIncident,
  type StaffRole,
} from '../src/index';

async function makeAccount(email?: string) {
  return prisma.account.create({
    data: {
      kind: 'email',
      email: email ?? `v1-${Math.random().toString(36).slice(2)}@example.com`,
      emailVerifiedAt: new Date(),
    },
  });
}

async function makeStaff(accountId: string, roles: StaffRole[]) {
  await prisma.staffMember.create({ data: { accountId, roles } });
  await prisma.totpSecret.create({
    data: { accountId, secret: 'JBSWY3DPEHPK3PXP', confirmedAt: new Date() },
  });
}

describe('R0-02/SEC13: boot env validation names missing vars, never values', () => {
  it('throws in production listing names only; passes in dev', () => {
    const secretValue = 'super-secret-value';
    const env = { DATABASE_URL: secretValue, APP_URL: 'https://app.eventdesk.ro' };
    expect(missingEnv(env, ['DATABASE_URL', 'APP_URL', 'SECRET_STORE_ARN'])).toEqual([
      'SECRET_STORE_ARN',
    ]);
    expect(() =>
      assertBootEnv({ DATABASE_URL: secretValue }, ['DATABASE_URL', 'APP_URL'], {
        production: true,
      })
    ).toThrow(/APP_URL/);
    try {
      assertBootEnv({ DATABASE_URL: secretValue }, ['DATABASE_URL', 'APP_URL'], {
        production: true,
      });
    } catch (e) {
      expect((e as Error).message).not.toContain(secretValue); // SEC13: never leak values
    }
    // dev/test boots without the full set
    assertBootEnv({}, ['DATABASE_URL'], { production: false });
  });
});

describe('LAU1: cookie-set signature covers exactly the three disclosed cookies', () => {
  it('is stable and lists session + device + language only', () => {
    expect([...COOKIE_NAMES]).toEqual(['ed_session', 'ed_device', 'ed_lang']);
    expect(COOKIE_SET_SIGNATURE).toBe('lau1-v1:ed_session|ed_device|ed_lang');
  });
});

describe('LAU5: incident log — staff-only management, public active read', () => {
  it('creates/updates/resolves with audit; non-staff forbidden; active only is public', async () => {
    const admin = await makeAccount();
    await makeStaff(admin.id, ['security_administrator']);
    const plain = await makeAccount();

    await expect(createIncident(plain.id, { title: 'x', impact: 'y' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });

    const inc = await createIncident(admin.id, {
      title: 'Degradare API',
      impact: 'Unele pagini răspund mai lent. / Some pages respond slower.',
    });
    expect(inc.status).toBe('investigating');
    expect(await prisma.auditLog.count({ where: { action: 'incident_opened' } })).toBe(1);

    // public read (no account) sees the active incident
    const active = await getActiveIncident();
    expect(active?.id).toBe(inc.id);
    expect(active?.impact).toContain('mai lent');

    await updateIncident(admin.id, inc.id, { status: 'monitoring' });
    await updateIncident(admin.id, inc.id, { status: 'resolved' });
    expect(await getActiveIncident()).toBeNull(); // resolved incidents not shown
    expect((await listIncidents(admin.id)).length).toBe(1);
    await expect(listIncidents(plain.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('LAU8: notice-and-action report intake hashes the reporter contact (SEC8)', () => {
  it('stores only the hash + audits receipt', async () => {
    const report = await fileContentReport({
      reporterContact: 'Citizen Example <citizen@example.com>',
      kind: 'unlawful_listing',
      detail: 'Listing X promotes an unlawful service.',
    });
    const row = await prisma.contentReport.findUniqueOrThrow({ where: { id: report.id } });
    expect(row.reporterContactHash).not.toContain('citizen@example.com');
    expect(row.state).toBe('open');
    expect(await prisma.auditLog.count({ where: { action: 'content_report_received' } })).toBe(1);
  });
});

describe('LAU9: accessibility statement recorded in console settings (staff-only)', () => {
  it('records date + evaluation method and reads back staff-only', async () => {
    const admin = await makeAccount();
    await makeStaff(admin.id, ['privacy_owner']);
    const plain = await makeAccount();

    await expect(
      recordAccessibilityStatement(plain.id, {
        statementDate: '2026-11-12',
        evaluationMethod: 'audit',
      })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const setting = await recordAccessibilityStatement(admin.id, {
      statementDate: '2026-11-12',
      evaluationMethod: 'Manual WCAG 2.2 AA audit + automated checks in CI',
    });
    expect(setting.key).toBe('accessibility_statement');
    expect(setting.value).toMatchObject({
      statementDate: '2026-11-12',
      standard: 'WCAG 2.2 AA (Q2)',
    });
    const readBack = await getPlatformSetting(admin.id, 'accessibility_statement');
    expect(readBack?.value).toMatchObject({ evaluationMethod: expect.stringContaining('WCAG') });
    await expect(getPlatformSetting(plain.id, 'accessibility_statement')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});
