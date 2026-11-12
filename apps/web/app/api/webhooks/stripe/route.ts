import { handleProcessorWebhook } from '@eventdesk/core';
import { isAppError } from '@eventdesk/shared';

// P24: feature grants flip ONLY from a verified processor webhook — never from a
// browser redirect. The raw body and signature header are verified server-side
// (HMAC-SHA256, 5-minute tolerance) before anything is applied.
export async function POST(request: Request) {
  const rawBody = await request.text();
  const sig = request.headers.get('stripe-signature') ?? '';
  try {
    await handleProcessorWebhook(rawBody, sig);
    return Response.json({ received: true });
  } catch (e) {
    if (isAppError(e) && e.code === 'UNAUTHENTICATED') {
      return Response.json({ error: 'invalid signature' }, { status: 401 });
    }
    console.error('stripe webhook error', e);
    return Response.json({ error: 'webhook failed' }, { status: 400 });
  }
}
