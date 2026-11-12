import { prisma } from '@eventdesk/db';
import { assertHuman } from '@eventdesk/auth';
import { registerPublic } from '@eventdesk/core';
import { isAppError, hashToken } from '@eventdesk/shared';

// C-06 + SEC11: public registration endpoint. Bot protection BEFORE any write:
// honeypot + time-to-submit floor + per-IP/per-link rate limits (botguard), then the
// atomic capacity claim (A8) inside registerPublic.
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const form = await request.formData();
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  try {
    await assertHuman({
      ip,
      linkKey: hashToken(slug),
      honeypot: form.get('website') ? String(form.get('website')) : null, // honeypot field
      formShownAt: form.get('formShownAt') ? Number(form.get('formShownAt')) : undefined,
    });
    const occ = await prisma.occasion.findFirstOrThrow({
      where: { publicSlug: slug, publicPageOn: true },
    });
    const answers: Record<string, string> = {};
    for (const [k, v] of form.entries()) {
      if (k.startsWith('q_')) answers[k.slice(2)] = String(v);
    }
    const reg = await registerPublic({
      occasionId: occ.id,
      name: String(form.get('name') ?? ''),
      contact: String(form.get('contact') ?? ''),
      answers,
    });
    return Response.json({ ok: true, state: reg.state });
  } catch (e) {
    if (isAppError(e)) {
      const status =
        e.code === 'RATE_LIMITED'
          ? 429
          : e.code === 'CONFLICT'
            ? 409
            : e.code === 'NOT_FOUND'
              ? 404
              : 400;
      return Response.json({ error: e.code, message: e.message }, { status });
    }
    console.error('public registration error', e);
    return Response.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
