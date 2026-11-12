import { prisma } from '@eventdesk/db';

// SEC10: every state change writes an append-only AuditLog row (the DB trigger blocks
// UPDATE/DELETE for every role, including PlatformAdmin).
export async function audit(input: {
  actorId?: string;
  actorKind: 'account' | 'staff' | 'system' | 'mcp_token';
  action: string;
  objectType: string;
  objectId?: string;
  before?: unknown;
  after?: unknown;
}): Promise<void> {
  await prisma.auditLog.create({
    data: {
      actorId: input.actorId ?? null,
      actorKind: input.actorKind,
      action: input.action,
      objectType: input.objectType,
      objectId: input.objectId ?? null,
      before: input.before === undefined ? undefined : (input.before as object),
      after: input.after === undefined ? undefined : (input.after as object),
    },
  });
}
