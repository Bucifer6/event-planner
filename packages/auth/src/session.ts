import { prisma } from '@eventdesk/db';
import { addDays, hashToken, newToken, now } from '@eventdesk/shared';

export const SESSION_COOKIE = process.env.SESSION_COOKIE ?? 'ed_session';
export const DEVICE_COOKIE = 'ed_device'; // plain, disclosed rate-limit cookie (SEC16), not a tracker
const SESSION_TTL_DAYS = 30; // S3
const IDLE_TTL_DAYS = 14; // S3

// SEC12: the cookie carries a random token; only its hash is stored. Cookies are set
// Secure, HttpOnly, SameSite=Lax by the caller (apps/web).
export async function createSession(accountId: string, deviceType?: string): Promise<string> {
  const token = newToken();
  await prisma.session.create({
    data: {
      id: hashToken(token),
      accountId,
      deviceType,
      lastSeenAt: now(),
      expiresAt: addDays(now(), SESSION_TTL_DAYS),
    },
  });
  return token;
}

export interface SessionInfo {
  accountId: string;
  sessionId: string;
  deviceType: string | null;
  lastSeenAt: Date;
}

// Returns null for revoked/expired/idle-expired sessions.
export async function validateSession(token: string): Promise<SessionInfo | null> {
  const id = hashToken(token);
  const session = await prisma.session.findUnique({ where: { id } });
  const current = now();
  if (!session || session.revokedAt || session.expiresAt < current) return null;
  if (current.getTime() - session.lastSeenAt.getTime() > IDLE_TTL_DAYS * 86_400_000) {
    await prisma.session.update({ where: { id }, data: { revokedAt: current } });
    return null;
  }
  await prisma.session.update({ where: { id }, data: { lastSeenAt: current } });
  return {
    accountId: session.accountId,
    sessionId: session.id,
    deviceType: session.deviceType,
    lastSeenAt: session.lastSeenAt,
  };
}

export async function listSessions(accountId: string): Promise<SessionInfo[]> {
  const rows = await prisma.session.findMany({
    where: { accountId, revokedAt: null, expiresAt: { gt: now() } },
    orderBy: { lastSeenAt: 'desc' },
  });
  return rows.map((s) => ({
    accountId: s.accountId,
    sessionId: s.id,
    deviceType: s.deviceType,
    lastSeenAt: s.lastSeenAt,
  }));
}

// SEC3: one-tap "sign out everywhere" invalidates all sessions and all MCP tokens.
export async function revokeAllSessions(accountId: string): Promise<void> {
  const current = now();
  await prisma.session.updateMany({
    where: { accountId, revokedAt: null },
    data: { revokedAt: current },
  });
  await prisma.mcpToken.updateMany({
    where: { accountId, revokedAt: null },
    data: { revokedAt: current },
  });
}

export async function revokeSession(token: string): Promise<void> {
  await prisma.session.updateMany({
    where: { id: hashToken(token), revokedAt: null },
    data: { revokedAt: now() },
  });
}
