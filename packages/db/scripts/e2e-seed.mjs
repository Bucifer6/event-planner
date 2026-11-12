// E2E seed: creates an account + session (raw token returned once, hash stored — SEC8/SEC12),
// an occasion with owner member, a household with guests + invitation (hashed token, scoped
// qrId — SEC2), a programme item and a task with a checklist item. Writes /tmp/e2e-data.json.
// Lives in packages/db so @prisma/client resolves; invoked by scripts/e2e.mjs.
import { PrismaClient } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const prisma = new PrismaClient();
const sha = (s) => createHash('sha256').update(s).digest('hex');
const rand = () => randomBytes(32).toString('base64url');

const account = await prisma.account.create({
  data: { kind: 'email', email: 'e2e@example.com', emailVerifiedAt: new Date() },
});
const sessionToken = rand();
await prisma.session.create({
  data: {
    id: sha(sessionToken),
    accountId: account.id,
    deviceType: 'e2e',
    lastSeenAt: new Date(),
    expiresAt: new Date(Date.now() + 30 * 86_400_000),
  },
});
const occasion = await prisma.occasion.create({
  data: {
    ownerId: account.id,
    title: 'E2E Nunta',
    kind: 'nunta',
    dateMode: 'date',
    dateStart: new Date('2027-06-15T15:00:00Z'),
    dateEnd: new Date('2027-06-16T02:00:00Z'),
    publicSlug: 'e2e-nunta',
    publicPageOn: true,
  },
});
await prisma.occasionMember.create({
  data: {
    occasionId: occasion.id,
    accountId: account.id,
    role: 'owner',
    finance: true,
    privateRequests: true,
  },
});
const household = await prisma.household.create({
  data: {
    occasionId: occasion.id,
    name: 'E2E Familia',
    guests: { create: [{ name: 'Ana' }, { name: 'Ion' }] },
  },
});
const invToken = rand();
const invitation = await prisma.invitation.create({
  data: {
    occasionId: occasion.id,
    householdId: household.id,
    tokenHash: sha(invToken),
    locale: 'ro',
    expiryMode: 'never',
  },
});
await prisma.programmeItem.create({
  data: {
    occasionId: occasion.id,
    title: 'Cununie civila',
    startsAt: new Date('2027-06-15T15:00:00Z'),
    durationMin: 45,
  },
});
const task = await prisma.task.create({
  data: {
    occasionId: occasion.id,
    title: 'E2E task',
    status: 'todo',
    createdById: account.id,
    checkItems: { create: [{ label: 'E2E check', sortOrder: 0 }] },
  },
});
const checkItem = await prisma.taskCheckItem.findFirstOrThrow({ where: { taskId: task.id } });

writeFileSync(
  '/tmp/e2e-data.json',
  JSON.stringify({
    sessionToken,
    occasionId: occasion.id,
    householdId: household.id,
    invitationToken: invToken,
    qrId: invitation.qrId,
    publicSlug: 'e2e-nunta',
    taskId: task.id,
    checkItemId: checkItem.id,
  })
);
console.log('seeded', occasion.id);
await prisma.$disconnect();
