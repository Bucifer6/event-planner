import { prisma } from '@eventdesk/db';
import { AppError, now } from '@eventdesk/shared';
import { audit } from './audit';
import { createApprovalRequest, requireStaff } from './staff';

// W10 + R0-14 + DEP1-DEP7: deployments from the console, from ONE private GitHub
// repository via a GitHub App (installation-scoped; credentials server-side only,
// never in the browser). A release is deployed by TAG, never a bare branch head
// (DEP2); production deploys need a second person (DEP3, W9 queue) except an
// emergency security fix by one SecurityAdministrator, audit-marked; DEP7: the tag
// must have green CI on that exact commit, else refused (emergency path records the
// bypass). The actual deploy runs as a worker job (DEP4: backup first, migrations,
// health checks, auto-rollback) and only when DEPLOY_ENABLED=1 with operator creds.

const GITHUB_API = 'https://api.github.com';

function githubConfig(): {
  appId: string;
  privateKey: string;
  installationId: string;
  repo: string;
} | null {
  const appId = process.env.GITHUB_APP_ID ?? '';
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY ?? '';
  const installationId = process.env.GITHUB_APP_INSTALLATION_ID ?? '';
  const repo = process.env.DEPLOY_REPO ?? ''; // "owner/repo" — exactly one private repo (DEP1)
  if (!appId || !privateKey || !installationId || !repo) return null;
  return { appId, privateKey, installationId, repo };
}

// Server-side only: mint a short-lived installation token (JWT signed with the app
// private key). Never exposed to the browser (DEP1).
async function installationToken(): Promise<string | null> {
  const cfg = githubConfig();
  if (!cfg) return null;
  const { createSign } = await import('node:crypto');
  const nowSec = Math.floor(now().getTime() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({ iat: nowSec - 60, exp: nowSec + 600, iss: cfg.appId })
  ).toString('base64url');
  const sign = createSign('RSA-SHA256');
  sign.update(`${header}.${payload}`);
  const jwt = `${header}.${payload}.${sign.sign(cfg.privateKey.replace(/\\n/g, '\n')).toString('base64url')}`;
  const res = await fetch(`${GITHUB_API}/app/installations/${cfg.installationId}/access_tokens`, {
    method: 'POST',
    headers: { authorization: `Bearer ${jwt}`, accept: 'application/vnd.github+json' },
  });
  if (!res.ok) return null;
  return String((await res.json()).token ?? '');
}

export async function listGithubReleases() {
  const cfg = githubConfig();
  const token = await installationToken();
  if (!cfg || !token) return { configured: false, releases: [] as unknown[] };
  const res = await fetch(`${GITHUB_API}/repos/${cfg.repo}/releases`, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' },
  });
  if (!res.ok) return { configured: true, releases: [] as unknown[] };
  return { configured: true, releases: await res.json() };
}

export async function listCommitsBetween(base: string, head: string) {
  const cfg = githubConfig();
  const token = await installationToken();
  if (!cfg || !token) return { configured: false, commits: [] as unknown[] };
  const res = await fetch(`${GITHUB_API}/repos/${cfg.repo}/compare/${base}...${head}`, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' },
  });
  if (!res.ok) return { configured: true, commits: [] as unknown[] };
  const j = (await res.json()) as { commits: unknown[] };
  return { configured: true, commits: j.commits };
}

// DEP7: a tag is deployable only with green CI on that exact commit.
export async function requestDeploy(
  tag: string,
  commitHash: string,
  ciStatus: string | null,
  requesterId: string,
  opts: { emergency?: boolean; reason?: string } = {}
) {
  if (!/^v\d+\.\d+\.\d+$/.test(tag))
    throw new AppError('INVALID_INPUT', 'Deploy by release tag only, never a branch head (DEP2).');
  if (opts.emergency) {
    await requireStaff(requesterId, 'security_administrator'); // DEP3 emergency path
  } else {
    await requireStaff(requesterId, 'platform_admin');
    if (ciStatus !== 'green') {
      throw new AppError(
        'FORBIDDEN',
        'CI must be green on the tag commit before deploy (DEP7). Emergency path requires SecurityAdministrator.'
      );
    }
  }
  const req = await createApprovalRequest(
    'deploy',
    { tag, commitHash, ciStatus, emergency: !!opts.emergency, reason: opts.reason ?? null },
    requesterId
  );
  await audit({
    actorId: requesterId,
    actorKind: 'staff',
    action: opts.emergency ? 'emergency_deploy_requested' : 'deploy_requested',
    objectType: 'Deploy',
    after: {
      tag,
      commitHash,
      ciStatus,
      emergency: !!opts.emergency,
      reason: opts.reason ?? null,
      approvalRequestId: req.id,
    },
  });
  return req;
}

export async function applyDeploy(requestId: string, approverId: string) {
  const request = await prisma.approvalRequest.findUniqueOrThrow({ where: { id: requestId } });
  if (request.action !== 'deploy') throw new AppError('NOT_FOUND', 'Not a deploy request.');
  await requireStaff(
    approverId,
    request.payload && (request.payload as { emergency?: boolean }).emergency
      ? 'security_administrator'
      : 'platform_admin'
  );
  if (
    request.requesterId === approverId &&
    !(request.payload as { emergency?: boolean }).emergency
  ) {
    throw new AppError('FORBIDDEN', 'Deploy needs a second person (DEP3/W9).');
  }
  const p = request.payload as {
    tag: string;
    commitHash: string;
    ciStatus: string | null;
    emergency?: boolean;
  };
  const deploy = await prisma.deploy.create({
    data: {
      tag: p.tag,
      commitHash: p.commitHash,
      requesterId: request.requesterId,
      approverId,
      ciStatus: p.ciStatus,
      emergency: !!p.emergency,
      reason: (request.payload as { reason?: string }).reason ?? null,
      result: 'queued',
      startedAt: now(),
    },
  });
  await prisma.approvalRequest.update({
    where: { id: requestId },
    data: { state: 'approved', decidedAt: now(), approverId },
  });
  await audit({
    actorId: approverId,
    actorKind: 'staff',
    action: p.emergency ? 'emergency_deploy_approved' : 'deploy_approved',
    objectType: 'Deploy',
    objectId: deploy.id,
    after: { tag: p.tag, commitHash: p.commitHash, ciStatus: p.ciStatus, emergency: !!p.emergency },
  });
  return deploy;
}

export async function listDeploys(limit = 50) {
  return prisma.deploy.findMany({ orderBy: { createdAt: 'desc' }, take: limit });
}
