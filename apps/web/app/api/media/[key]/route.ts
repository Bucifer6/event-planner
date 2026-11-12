import { prisma } from '@eventdesk/db';
import { getObject, MEDIA_HEADERS } from '@eventdesk/storage';

// SEC4: untrusted PDFs (quotes, drawings) are served from the media domain with
// Content-Disposition: attachment and noinline + sandboxed CSP, so they can never
// execute in the app's origin. In production media.eventdesk.ro is a separate
// origin (INF1); the same headers are applied here.
export async function GET(_request: Request, ctx: { params: Promise<{ key: string }> }) {
  const { key } = await ctx.params;
  const decoded = decodeURIComponent(key);
  const asset = await prisma.asset.findFirst({
    where: { storageKey: decoded, scanStatus: 'clean', kind: 'pdf' },
  });
  if (!asset) return new Response('not found', { status: 404 });
  const [bucket, ...rest] = decoded.split('/');
  const objectKey = rest.join('/');
  const body = await getObject(bucket!, objectKey);
  return new Response(new Uint8Array(body), {
    headers: {
      ...MEDIA_HEADERS,
      'Content-Type': 'application/pdf',
      'Content-Length': String(body.length),
    },
  });
}
