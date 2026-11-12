import { requireUser } from '../../../../lib/session';
import { listOfflineQueue, queueOfflineItem, reconcileOfflineQueue } from '@eventdesk/core';
import { isAppError } from '@eventdesk/shared';

// E-03: the offline device (PWA) queues arrivals and own checklist ticks here while
// offline; the queue is keyed by clientKey (Q4 idempotent) and reconciled once on
// reconnect. Conflicts are returned, never silently merged.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  try {
    const items = await listOfflineQueue(id, user.accountId);
    return Response.json({ items });
  } catch (e) {
    if (isAppError(e)) return Response.json({ error: e.code }, { status: 400 });
    console.error(e);
    return Response.json({ error: 'INTERNAL' }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  try {
    const body = (await request.json()) as {
      clientKey?: string;
      kind?: string;
      payload?: unknown;
      reconcile?: boolean;
    };
    if (body.reconcile) {
      const result = await reconcileOfflineQueue(id, user.accountId);
      return Response.json({ reconciled: result });
    }
    if (!body.clientKey || !body.kind) {
      return Response.json({ error: 'INVALID_INPUT' }, { status: 400 });
    }
    const item = await queueOfflineItem(id, user.accountId, {
      clientKey: body.clientKey,
      kind: body.kind,
      payload: body.payload ?? {},
    });
    return Response.json({ item }, { status: 201 });
  } catch (e) {
    if (isAppError(e)) return Response.json({ error: e.code }, { status: 400 });
    console.error(e);
    return Response.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
