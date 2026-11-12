import { requireUser } from '../../lib/session';
import { storeUpload } from '@eventdesk/storage';
import { assertSameOrigin } from '../../lib/csrf';
import { isAppError } from '@eventdesk/shared';

// INF3/SEC4: uploads enter through the web service, which enforces fair-use limits
// and runs the re-encode + malware-scan pipeline before the file becomes visible.
export async function POST(request: Request) {
  assertSameOrigin(request);
  const user = await requireUser();
  const form = await request.formData();
  const file = form.get('file');
  const occasionId = form.get('occasionId') ? String(form.get('occasionId')) : undefined;
  if (!(file instanceof File)) {
    return Response.json({ error: 'file required' }, { status: 400 });
  }
  try {
    const asset = await storeUpload({
      occasionId,
      uploaderId: user.accountId,
      fileName: file.name,
      mime: file.type || 'application/octet-stream',
      data: Buffer.from(await file.arrayBuffer()),
    });
    return Response.json({ asset });
  } catch (e) {
    if (isAppError(e)) {
      return Response.json(
        { error: e.code, message: e.message },
        { status: e.code === 'RATE_LIMITED' ? 429 : 400 }
      );
    }
    throw e;
  }
}
