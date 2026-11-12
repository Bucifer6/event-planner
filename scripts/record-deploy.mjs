// DEP6: every deploy is recorded in the Deploy table (read by the console W10 screen)
// with tag, commit hash, actors, CI status, result and duration. Values come from env;
// no secret is ever logged.
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const [phase] = process.argv.slice(2);
const tag = process.env.TAG ?? 'unknown';
const commitHash = process.env.GITHUB_SHA ?? 'unknown';
const actor = process.env.GITHUB_ACTOR ?? 'unknown';
const approver = process.env.GITHUB_APPROVER ?? null;
const ciStatus = process.env.CI_STATUS ?? 'not_run';
const emergency = process.env.EMERGENCY === 'true';

try {
  if (phase === 'start') {
    await prisma.deploy.create({
      data: {
        tag,
        commitHash,
        requesterId: actor,
        approverId: approver,
        ciStatus,
        emergency,
        result: 'running',
        startedAt: new Date(),
      },
    });
  } else if (phase === 'done' || phase === 'rolled_back' || phase === 'failed') {
    const row = await prisma.deploy.findFirst({ where: { tag }, orderBy: { startedAt: 'desc' } });
    if (row) {
      await prisma.deploy.update({
        where: { id: row.id },
        data: {
          result: phase === 'done' ? 'done' : phase,
          finishedAt: new Date(),
          rolledBackAt: phase === 'rolled_back' ? new Date() : row.rolledBackAt,
        },
      });
    }
  }
} finally {
  await prisma.$disconnect();
}
